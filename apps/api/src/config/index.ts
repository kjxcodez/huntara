import { env } from './env.js';
import { logger } from '@huntara/logger';
import { auth } from './auth.js';

export { env, logger, auth };

/**
 * CORS configurations central module.
 */
export const corsConfig = {
  origin: env.CORS_ORIGIN,
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-request-id'],
  exposeHeaders: ['Content-Length', 'X-Koa-Response-Time', 'x-request-id'],
  maxAge: 600
};

/**
 * Security headers configurations central module.
 */
export const securityConfig = {
  contentSecurityPolicy: env.NODE_ENV === 'production',
  dnsPrefetchControl: true,
  frameguard: { action: 'deny' as const },
  hidePoweredBy: true,
  hsts:
    env.NODE_ENV === 'production'
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: 'no-referrer' as const },
  xssFilter: true
};

/**
 * Centralized Database Config module.
 */
export const dbConfig = {
  uri: env.MONGODB_URI,
  options: {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4
  }
};

/**
 * Centralized Auth configurations module.
 */
export const authConfig = {
  url: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  tokenExpiration: '7d'
};
