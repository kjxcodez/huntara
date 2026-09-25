import { env } from './env.js';
import { logger } from '@huntara/logger';
import { auth } from './auth.js';

export { env, logger, auth };

/**
 * Resolves allowed CORS origin dynamically based on environment and allowlists.
 * Strictly prevents wildcard '*' reflection when credentials: true.
 */
export function resolveCorsOrigin(origin: string | undefined): string | null {
  if (!origin) return null;

  // Local development / desktop client origins
  const isLocalOrigin =
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
    origin === 'null' ||
    origin.startsWith('leadforge://') ||
    origin.startsWith('huntara://') ||
    origin.startsWith('app://');

  if (env.NODE_ENV !== 'production') {
    if (isLocalOrigin) return origin;
    if (env.CORS_ORIGIN && env.CORS_ORIGIN !== '*') {
      const allowed = env.CORS_ORIGIN.split(',').map((o) => o.trim());
      if (allowed.includes(origin)) return origin;
    }
    return isLocalOrigin ? origin : null;
  }

  // Production: strictly match explicitly configured origins or desktop app scheme
  if (env.CORS_ORIGIN && env.CORS_ORIGIN !== '*') {
    const allowed = env.CORS_ORIGIN.split(',').map((o) => o.trim());
    if (allowed.includes(origin)) return origin;
  }

  if (origin.startsWith('huntara://') || origin.startsWith('leadforge://') || origin.startsWith('app://')) {
    return origin;
  }

  return null;
}

/**
 * CORS configurations central module.
 */
export const corsConfig = {
  origin: (origin: string) => resolveCorsOrigin(origin) || '',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-request-id', 'x-workspace-id'],
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
