import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { successResponse } from '../../utils/index.js';
import { db } from '../../db/index.js';
import { createSuccessResponseSchema } from '../../openapi/index.js';

const apiInfoSchema = z
  .object({
    name: z.string().openapi({ example: 'HUNTARA API' }),
    version: z.string().openapi({ example: '1.0.0' }),
    description: z
      .string()
      .openapi({ example: 'HUNTARA authenticated production CRUD API backend.' }),
    status: z.string().openapi({ example: 'online' })
  })
  .openapi('ApiInfo');

const healthStatusSchema = z
  .object({
    status: z.string().openapi({ example: 'OK' }),
    uptime: z.number().openapi({ example: 120.45 }),
    database: z.object({
      status: z.string().openapi({ example: 'connected' }),
      readyState: z.number().openapi({ example: 1 })
    }),
    version: z.string().openapi({ example: '1.0.0' }),
    environment: z.string().openapi({ example: 'development' })
  })
  .openapi('HealthStatus');

const versionInfoSchema = z
  .object({
    version: z.string().openapi({ example: '1.0.0' }),
    nodeVersion: z.string().openapi({ example: 'v22.14.0' }),
    env: z.string().openapi({ example: 'development' })
  })
  .openapi('VersionInfo');

const infoRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'Get API Information',
  description: 'Returns general identification details about the running HUNTARA service.',
  tags: ['System'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: createSuccessResponseSchema(apiInfoSchema, 'ApiInfoResponse')
        }
      },
      description: 'API information retrieved successfully'
    }
  }
});

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  summary: 'Check API Health Status',
  description:
    'Verifies connectivity and service parameters including Database connection and system uptime.',
  tags: ['System'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: createSuccessResponseSchema(healthStatusSchema, 'HealthStatusResponse')
        }
      },
      description: 'Service is fully operational'
    },
    500: {
      content: {
        'application/json': {
          schema: createSuccessResponseSchema(healthStatusSchema, 'HealthStatusErrorResponse')
        }
      },
      description: 'Service is unhealthy or database is disconnected'
    }
  }
});

const versionRoute = createRoute({
  method: 'get',
  path: '/version',
  summary: 'Get Application Version Details',
  description: 'Fetches structural application and runtime compiler specifications.',
  tags: ['System'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: createSuccessResponseSchema(versionInfoSchema, 'VersionInfoResponse')
        }
      },
      description: 'Version metrics retrieved successfully'
    }
  }
});

const router = new OpenAPIHono();

router.openapi(infoRoute, (c) => {
  return c.json(
    successResponse({
      name: 'HUNTARA API',
      version: '1.0.0',
      description: 'HUNTARA authenticated production CRUD API backend.',
      status: 'online'
    })
  );
});

router.openapi(healthRoute, async (c) => {
  const dbHealth = await db.checkHealth();
  const uptime = process.uptime();
  const environment = process.env.NODE_ENV || 'development';

  const payload = {
    status: dbHealth.isHealthy ? 'OK' : 'DEGRADED',
    uptime,
    database: {
      status: dbHealth.isHealthy ? 'connected' : 'disconnected',
      readyState: dbHealth.readyState
    },
    version: '1.0.0',
    environment
  };

  const statusCode = dbHealth.isHealthy ? 200 : 500;
  return c.json(successResponse(payload), statusCode as any);
});

router.openapi(versionRoute, (c) => {
  return c.json(
    successResponse({
      version: '1.0.0',
      nodeVersion: process.version,
      env: process.env.NODE_ENV || 'development'
    })
  );
});

export { router };
