import twilio from 'twilio';
import { nanoid } from 'nanoid';
import { getEnv } from '../config/env';
import { getDatabase } from '../db/database';
import { generateToken, getTokenExpiry } from '../utils/jwt';
import { log } from '../utils/log';

interface VerificationResult {
  success: boolean;
  message: string;
  sessionId?: string;
  token?: string;
}

interface RateLimitResult {
  allowed: boolean;
  remainingAttempts?: number;
  blockedUntil?: number;
}

class AuthService {
  private twilioClient: twilio.Twilio | null = null;
  private verifyServiceSid: string | undefined;
  private db = getDatabase();

  constructor() {
    const env = getEnv();
    
    // Initialize Twilio client if credentials are provided
    if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
      this.verifyServiceSid = env.TWILIO_VERIFY_SERVICE_SID;
      
      if (!this.verifyServiceSid) {
        log.warn('[auth] Twilio Verify Service SID not configured. Using fallback mode.');
      }
    } else {
      log.warn('[auth] Twilio credentials not configured. Using development mode.');
    }
  }

  async sendVerificationCode(phoneNumber: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check rate limiting
      const rateLimit = await this.checkRateLimit(phoneNumber);
      if (!rateLimit.allowed) {
        const blockedMinutes = rateLimit.blockedUntil 
          ? Math.ceil((rateLimit.blockedUntil - Date.now()) / 60000)
          : 5;
        return {
          success: false,
          message: `Too many attempts. Please try again in ${blockedMinutes} minutes.`
        };
      }

      // Ensure phone number is in E.164 format
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      // In development mode or without Verify service, use a mock code
      if (!this.twilioClient || !this.verifyServiceSid) {
        log.info('[auth] Development mode: Mock verification code sent', { 
          phoneNumber: formattedPhone,
          code: '123456' // In dev, always use this code
        });
        return {
          success: true,
          message: 'Verification code sent (dev mode: use 123456)'
        };
      }

      // Send real verification via Twilio Verify
      const verification = await this.twilioClient.verify.v2
        .services(this.verifyServiceSid)
        .verifications.create({
          to: formattedPhone,
          channel: 'sms'
        });

      log.info('[auth] Verification code sent', { 
        phoneNumber: formattedPhone,
        status: verification.status 
      });

      // Record attempt
      await this.recordVerificationAttempt(phoneNumber);

      return {
        success: true,
        message: 'Verification code sent to your phone'
      };
    } catch (error) {
      log.error('[auth] Error sending verification code', { error, phoneNumber });
      return {
        success: false,
        message: 'Failed to send verification code. Please try again.'
      };
    }
  }

  async verifyCode(phoneNumber: string, code: string): Promise<VerificationResult> {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      // In development mode, accept mock code
      if (!this.twilioClient || !this.verifyServiceSid) {
        if (code === '123456') {
          return await this.createSession(formattedPhone);
        }
        return {
          success: false,
          message: 'Invalid verification code'
        };
      }

      // Verify with Twilio
      const verificationCheck = await this.twilioClient.verify.v2
        .services(this.verifyServiceSid)
        .verificationChecks.create({
          to: formattedPhone,
          code: code
        });

      if (verificationCheck.status === 'approved') {
        // Clear rate limit on successful verification
        await this.clearRateLimit(phoneNumber);
        return await this.createSession(formattedPhone);
      }

      return {
        success: false,
        message: 'Invalid or expired verification code'
      };
    } catch (error) {
      log.error('[auth] Error verifying code', { error, phoneNumber });
      return {
        success: false,
        message: 'Verification failed. Please try again.'
      };
    }
  }

  private async createSession(phoneNumber: string): Promise<VerificationResult> {
    const sessionId = nanoid();
    const token = generateToken({ phoneNumber, sessionId });
    const expiresAt = getTokenExpiry(getEnv().JWT_EXPIRES_IN);

    try {
      // Ensure caller exists in database
      await this.db.upsertCaller(phoneNumber, null);
      
      // Store session in database
      await this.db.createSession({
        id: sessionId,
        phone_number: phoneNumber,
        token,
        expires_at: expiresAt
      });

      log.info('[auth] Session created', { phoneNumber, sessionId });

      return {
        success: true,
        message: 'Successfully authenticated',
        sessionId,
        token
      };
    } catch (error) {
      log.error('[auth] Error creating session', { error, phoneNumber });
      return {
        success: false,
        message: 'Failed to create session'
      };
    }
  }

  async getSession(token: string): Promise<{ phoneNumber: string; sessionId: string } | null> {
    try {
      const session = await this.db.getSessionByToken(token);
      
      if (!session) {
        return null;
      }

      // Check if session is expired
      if (session.expires_at < Math.floor(Date.now() / 1000)) {
        await this.db.deleteSession(session.id);
        return null;
      }

      // Update last used timestamp
      await this.db.updateSessionLastUsed(session.id);

      return {
        phoneNumber: session.phone_number,
        sessionId: session.id
      };
    } catch (error) {
      log.error('[auth] Error getting session', { error });
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      await this.db.deleteSession(sessionId);
      log.info('[auth] Session deleted', { sessionId });
      return true;
    } catch (error) {
      log.error('[auth] Error deleting session', { error, sessionId });
      return false;
    }
  }

  private formatPhoneNumber(phoneNumber: string): string {
    // Remove all non-numeric characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Add country code if not present (assuming US)
    if (cleaned.length === 10) {
      return `+1${cleaned}`;
    }
    
    // Ensure it starts with +
    if (!phoneNumber.startsWith('+')) {
      return `+${cleaned}`;
    }
    
    return phoneNumber;
  }

  private async checkRateLimit(phoneNumber: string): Promise<RateLimitResult> {
    const attempts = await this.db.getVerificationAttempts(phoneNumber);
    
    if (!attempts) {
      return { allowed: true, remainingAttempts: 5 };
    }

    // If blocked, check if block period has expired
    if (attempts.blocked_until && attempts.blocked_until > Date.now()) {
      return { 
        allowed: false, 
        blockedUntil: attempts.blocked_until 
      };
    }

    // Reset attempts if last attempt was more than 1 hour ago
    const oneHourAgo = Date.now() - 3600000;
    if (attempts.last_attempt_at < oneHourAgo) {
      await this.db.resetVerificationAttempts(phoneNumber);
      return { allowed: true, remainingAttempts: 5 };
    }

    // Allow up to 5 attempts per hour
    if (attempts.attempt_count >= 5) {
      // Block for 5 minutes
      const blockedUntil = Date.now() + 300000;
      await this.db.blockVerificationAttempts(phoneNumber, blockedUntil);
      return { 
        allowed: false, 
        blockedUntil 
      };
    }

    return { 
      allowed: true, 
      remainingAttempts: 5 - attempts.attempt_count 
    };
  }

  private async recordVerificationAttempt(phoneNumber: string): Promise<void> {
    await this.db.incrementVerificationAttempts(phoneNumber);
  }

  private async clearRateLimit(phoneNumber: string): Promise<void> {
    await this.db.resetVerificationAttempts(phoneNumber);
  }
}

// Export singleton instance
let authService: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authService) {
    authService = new AuthService();
  }
  return authService;
}