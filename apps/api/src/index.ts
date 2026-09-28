import { serve } from '@hono/node-server';
import { app } from './app.js';
import { env, logger } from './config/index.js';
import { db } from './db/index.js';

/**
 * Node Server instance listener.
 */
const port = env.PORT;

const server = serve({
  fetch: app.fetch,
  port
});

logger.info(`> HUNTARA API Server is running on port ${port} in ${env.NODE_ENV} mode.`);
logger.info(`> OpenAPI specifications available at: http://localhost:${port}/openapi.json`);
logger.info(`> Interactive API reference UI available at: http://localhost:${port}/reference`);

/**
 * Handles graceful system shutdown on process signals.
 */
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Starting graceful shutdown procedure...`);

  // Close the server listener
  server.close();
  logger.info('HTTP Server listener closed.');

  // Disconnect Database connection
  try {
    await db.disconnect();
  } catch (err) {
    logger.error({ err }, 'Error disconnecting database during shutdown.');
  }

  logger.info('Graceful shutdown completed. Exiting process.');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
