import type { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { getAuthService } from '../services/auth';
import { authMiddleware } from '../middleware/auth';
import { log } from '../utils/log';

// Validation schemas
const SendVerificationSchema = z.object({
  phoneNumber: z.string().min(10).max(20)
});

const VerifyCodeSchema = z.object({
  phoneNumber: z.string().min(10).max(20),
  code: z.string().length(6)
});

export function registerAuthRoutes(app: Hono) {
  const authService = getAuthService();

  // Send verification code
  app.post('/api/auth/send-verification', async (c) => {
    try {
      const body = await c.req.json();
      const parsed = SendVerificationSchema.safeParse(body);
      
      if (!parsed.success) {
        return c.json({ 
          error: 'ValidationError', 
          message: 'Invalid phone number format' 
        }, 400);
      }
      
      const result = await authService.sendVerificationCode(parsed.data.phoneNumber);
      
      if (!result.success) {
        return c.json({ 
          error: 'VerificationError', 
          message: result.message 
        }, 400);
      }
      
      log.info('[auth] Verification code sent', { phoneNumber: parsed.data.phoneNumber });
      
      return c.json({ 
        success: true, 
        message: result.message 
      });
    } catch (error) {
      log.error('[auth] Error sending verification', { error });
      return c.json({ 
        error: 'InternalError', 
        message: 'Failed to send verification code' 
        }, 500);
    }
  });

  // Verify code and create session
  app.post('/api/auth/verify', async (c) => {
    try {
      const body = await c.req.json();
      const parsed = VerifyCodeSchema.safeParse(body);
      
      if (!parsed.success) {
        return c.json({ 
          error: 'ValidationError', 
          message: 'Invalid phone number or code format' 
        }, 400);
      }
      
      const result = await authService.verifyCode(
        parsed.data.phoneNumber, 
        parsed.data.code
      );
      
      if (!result.success) {
        return c.json({ 
          error: 'VerificationError', 
          message: result.message 
        }, 400);
      }
      
      // Set cookie for browser-based auth
      setCookie(c, 'auth_token', result.token!, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 7 * 24 * 60 * 60 // 7 days
      });
      
      log.info('[auth] User authenticated', { 
        phoneNumber: parsed.data.phoneNumber,
        sessionId: result.sessionId 
      });
      
      return c.json({ 
        success: true, 
        message: result.message,
        token: result.token,
        sessionId: result.sessionId
      });
    } catch (error) {
      log.error('[auth] Error verifying code', { error });
      return c.json({ 
        error: 'InternalError', 
        message: 'Verification failed' 
      }, 500);
    }
  });

  // Get current session
  app.get('/api/auth/session', authMiddleware, async (c) => {
    const user = c.get('user');
    
    return c.json({
      authenticated: true,
      phoneNumber: user.phoneNumber,
      sessionId: user.sessionId
    });
  });

  // Logout
  app.post('/api/auth/logout', authMiddleware, async (c) => {
    try {
      const user = c.get('user');
      await authService.deleteSession(user.sessionId);
      
      // Clear cookie
      setCookie(c, 'auth_token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 0
      });
      
      log.info('[auth] User logged out', { 
        phoneNumber: user.phoneNumber,
        sessionId: user.sessionId 
      });
      
      return c.json({ 
        success: true, 
        message: 'Logged out successfully' 
      });
    } catch (error) {
      log.error('[auth] Error logging out', { error });
      return c.json({ 
        error: 'InternalError', 
        message: 'Logout failed' 
      }, 500);
    }
  });

  // Health check endpoint
  app.get('/api/auth/health', (c) => {
    return c.json({ 
      status: 'ok', 
      service: 'auth',
      timestamp: new Date().toISOString()
    });
  });
}