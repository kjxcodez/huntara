import { createMiddleware } from 'hono/factory';
import { errorResponse } from '@huntara/core';
import { ErrorCode, HttpStatus } from '@huntara/schema';

export function createAuthMiddleware(authInstance: any) {
  return createMiddleware(async (c, next) => {
    const session = await authInstance.api.getSession({
      headers: c.req.raw.headers
    });
    if (!session) {
      return c.json(
        errorResponse('Unauthorized access. Please log in.', ErrorCode.UNAUTHORIZED),
        HttpStatus.UNAUTHORIZED
      );
    }
    c.set('session', session.session);
    c.set('user', session.user);
    return next();
  });
}
