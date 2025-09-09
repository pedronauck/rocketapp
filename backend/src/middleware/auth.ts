import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { getAuthService } from '../services/auth';
import { log } from '../utils/log';

export async function authMiddleware(c: Context, next: Next) {
  try {
    // Get token from Authorization header or cookie
    const authHeader = c.req.header('Authorization');
    const cookieToken = getCookie(c, 'auth_token');
    
    let token: string | undefined;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (cookieToken) {
      token = cookieToken;
    }
    
    if (!token) {
      return c.json({ error: 'Unauthorized', message: 'No authentication token provided' }, 401);
    }
    
    // Verify token and get session
    const authService = getAuthService();
    const session = await authService.getSession(token);
    
    if (!session) {
      return c.json({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401);
    }
    
    // Add user info to context
    c.set('user', {
      phoneNumber: session.phoneNumber,
      sessionId: session.sessionId
    });
    
    await next();
  } catch (error) {
    log.error('[auth-middleware] Error', { error });
    return c.json({ error: 'Unauthorized', message: 'Authentication failed' }, 401);
  }
}

export async function optionalAuthMiddleware(c: Context, next: Next) {
  try {
    // Get token from Authorization header or cookie
    const authHeader = c.req.header('Authorization');
    const cookieToken = getCookie(c, 'auth_token');
    
    let token: string | undefined;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (cookieToken) {
      token = cookieToken;
    }
    
    if (token) {
      // Verify token and get session
      const authService = getAuthService();
      const session = await authService.getSession(token);
      
      if (session) {
        // Add user info to context
        c.set('user', {
          phoneNumber: session.phoneNumber,
          sessionId: session.sessionId
        });
      }
    }
    
    await next();
  } catch (error) {
    log.error('[optional-auth-middleware] Error', { error });
    // Continue without auth
    await next();
  }
}

