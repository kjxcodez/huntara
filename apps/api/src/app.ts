import { Hono } from 'hono';
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { apiReference } from '@scalar/hono-api-reference';
import compression from 'compression';
import { cors } from 'hono/cors';

import { env, logger, corsConfig } from './config/index.js';
import { db } from './db/index.js';
import { errorHandler, loggerMiddleware, requestIdMiddleware } from './middleware/index.js';
import { apiRouter } from './routes/index.js';
import { API_PREFIX } from './constants/index.js';

const app = new OpenAPIHono();

// Connect to database
db.connect().catch((err) => {
  logger.fatal({ err }, 'Database connection failed during bootstrap.');
});

// Ensure database connection is active for every request (crucial for serverless lifecycle)
app.use('*', async (c, next) => {
  await db.connect();
  await next();
});

// Setup compression if running in production node environment.
// Standard Node/Hono compression integration: Hono does not natively bundle node compression middleware.
// We execute custom middleware wrapping standard compress modules or skip it for dev.
// In Hono, we can write a middleware wrapper for compression, or use native runtime.
// Let's implement Hono custom handler or rely on gateway, since Honos built-in compress uses native compression streams.
// Let's import Hono's native compress.
import { compress } from 'hono/compress';
app.use('*', compress());

// Apply global middlewares
app.use('*', cors(corsConfig));
app.use('*', requestIdMiddleware);
app.use('*', loggerMiddleware);

// Setup Security Headers
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'no-referrer');
  if (env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  await next();
});

import { trackingRouter } from './routes/tracking.js';

// Register routes
app.route('/t', trackingRouter);
app.route(API_PREFIX, apiRouter);

// Global Error Handler
app.onError(errorHandler);

// Root path redirects to OpenAPI reference docs
app.get('/', (c) => {
  return c.redirect('/reference');
});

// Setup OpenAPI Documentation specs
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'HUNTARA API Reference',
    version: '1.0.0',
    description: 'Production API reference catalog details for HUNTARA tenant modules.'
  }
});

// Serve Scalar API reference document UI
app.get(
  '/reference',
  apiReference({
    spec: {
      url: '/openapi.json'
    }
  })
);

// Serve Swagger UI
app.get('/swagger', swaggerUI({ url: '/openapi.json' }));

export default app;
export { app };
