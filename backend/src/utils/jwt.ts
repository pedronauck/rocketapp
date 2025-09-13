import jwt from 'jsonwebtoken';
import { getEnv } from '../config/env';
import { log } from './log';

export interface JWTPayload {
  phoneNumber: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  const env = getEnv();
  
  try {
    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    });
    
    log.debug('[jwt] Token generated', { phoneNumber: payload.phoneNumber });
    return token;
  } catch (error) {
    log.error('[jwt] Error generating token', { error });
    throw new Error('Failed to generate authentication token');
  }
}

export function verifyToken(token: string): JWTPayload | null {
  const env = getEnv();
  
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JWTPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      log.debug('[jwt] Token expired');
    } else if (error instanceof jwt.JsonWebTokenError) {
      log.debug('[jwt] Invalid token');
    } else {
      log.error('[jwt] Error verifying token', { error });
    }
    return null;
  }
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    return decoded;
  } catch (error) {
    log.error('[jwt] Error decoding token', { error });
    return null;
  }
}

export function getTokenExpiry(expiresIn: string = '7d'): number {
  const now = Math.floor(Date.now() / 1000);
  const duration = parseDuration(expiresIn);
  return now + duration;
}

function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([dhms])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  switch (unit) {
    case 'd': return value * 24 * 60 * 60;
    case 'h': return value * 60 * 60;
    case 'm': return value * 60;
    case 's': return value;
    default: throw new Error(`Invalid duration unit: ${unit}`);
  }
}