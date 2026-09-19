import type { JobContext } from '../../shared/types/job';

/**
 * Standalone worker environment resolution.
 * Extracted into a dedicated leaf module to eliminate circular dependencies
 * between worker-host.ts and the worker plugin implementations.
 */

/**
 * Resolves the authoritative API server URL from the JobContext or environment.
 * Throws a loud, descriptive error if the URL is missing or unresolvable.
 */
export function resolveWorkerApiUrl(ctx: JobContext): string {
  const rawUrl = ctx.payload?._config?.apiUrl || process.env.API_URL;
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(
      'HUNTARA could not determine the API server URL for this environment. Please ensure the job was dispatched by the HUNTARA Scheduler.'
    );
  }
  let trimmed = rawUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}
