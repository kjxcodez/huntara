import { OpenAPIHono } from '@hono/zod-openapi';
import { SuppressionRepository } from '../repositories/suppression/suppression.repository.js';
import { createSuppressionDtoSchema, SuppressionTargetType, SuppressionReason } from '@leadforge/schema';
import { successResponse } from '../utils/index.js';
import { getWorkspaceId, getUserId } from './common.js';
import { BadRequestError } from '../errors/index.js';

export const suppressionsRouter = new OpenAPIHono();

// 1. List workspace suppressions
suppressionsRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const repo = new SuppressionRepository(wsId);
  const targetType = c.req.query('targetType') as SuppressionTargetType | undefined;
  const reason = c.req.query('reason');
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : 50;
  const skip = c.req.query('skip') ? parseInt(c.req.query('skip')!, 10) : 0;

  const result = await repo.listSuppressions({ targetType, reason, limit, skip });
  return c.json(successResponse(result));
});

// 2. Check if an email, company, or domain is suppressed
suppressionsRouter.get('/check', async (c) => {
  const wsId = getWorkspaceId(c);
  const email = c.req.query('email');
  const companyId = c.req.query('companyId');
  const domain = c.req.query('domain');

  if (!email && !companyId && !domain) {
    throw new BadRequestError('At least one of "email", "companyId", or "domain" query param is required.');
  }

  const repo = new SuppressionRepository(wsId);

  // Exact backward compatibility for single-email query contracts
  if (email && !companyId && !domain) {
    const suppression = await repo.getSuppression(email);
    return c.json(
      successResponse({
        email,
        suppressed: Boolean(suppression),
        suppression: suppression || null
      })
    );
  }

  // Multi-target evaluation
  const effective = await repo.evaluateEffectiveSuppression({
    email: email || '',
    companyId: companyId || null
  });

  return c.json(
    successResponse({
      email: email || null,
      companyId: companyId || null,
      domain: domain || null,
      suppressed: effective.suppressed,
      isRecipientSuppressed: effective.isRecipientSuppressed,
      isCompanySuppressed: effective.isCompanySuppressed,
      isDomainSuppressed: effective.isDomainSuppressed,
      reasons: effective.reasons,
      primaryReason: effective.primaryReason || null,
      message: effective.message
    })
  );
});

// 3. Record a suppression (recipient, company, or domain)
suppressionsRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json().catch(() => ({}));
  const validated = createSuppressionDtoSchema.parse(body);

  let userId: string | null = null;
  try {
    userId = getUserId(c);
  } catch {
    userId = null;
  }

  const repo = new SuppressionRepository(wsId);
  const targetType = validated.targetType || SuppressionTargetType.RECIPIENT;

  if (targetType === SuppressionTargetType.COMPANY) {
    const compId = (validated.companyId || validated.targetId || '').trim();
    if (!compId) throw new BadRequestError('companyId is required for company suppression.');
    const record = await repo.suppressCompany(
      compId,
      validated.reason || SuppressionReason.COMPANY_DNC,
      validated.source || 'manual',
      validated.evidence || null,
      userId,
      validated.notes || null
    );
    return c.json(successResponse(record), 201);
  } else if (targetType === SuppressionTargetType.DOMAIN) {
    const dom = (validated.domain || validated.targetId || '').trim();
    if (!dom) throw new BadRequestError('domain is required for domain suppression.');
    const record = await repo.suppressDomain(
      dom,
      validated.reason || SuppressionReason.DOMAIN_SUPPRESSION,
      validated.source || 'manual',
      validated.evidence || null,
      userId,
      validated.notes || null
    );
    return c.json(successResponse(record), 201);
  } else {
    const targetEmail = (validated.email || validated.targetId || '').trim();
    if (!targetEmail) throw new BadRequestError('email is required for recipient suppression.');
    const record = await repo.suppress(
      targetEmail,
      validated.reason || SuppressionReason.MANUAL_SUPPRESSION,
      validated.source || 'manual',
      validated.evidence || null,
      userId,
      validated.notes || null
    );
    return c.json(successResponse(record), 201);
  }
});

// 4. Remove company DNC suppression
suppressionsRouter.delete('/company/:companyId', async (c) => {
  const wsId = getWorkspaceId(c);
  const companyId = decodeURIComponent(c.req.param('companyId'));
  const repo = new SuppressionRepository(wsId);
  const result = await repo.unsuppressCompany(companyId);
  return c.json(successResponse(result));
});

// 5. Remove domain suppression
suppressionsRouter.delete('/domain/:domain', async (c) => {
  const wsId = getWorkspaceId(c);
  const domain = decodeURIComponent(c.req.param('domain'));
  const repo = new SuppressionRepository(wsId);
  const result = await repo.unsuppressDomain(domain);
  return c.json(successResponse(result));
});

// 6. Remove recipient suppression (unsuppress)
suppressionsRouter.delete('/:email', async (c) => {
  const wsId = getWorkspaceId(c);
  const email = decodeURIComponent(c.req.param('email'));

  let userId: string | null = null;
  try {
    userId = getUserId(c);
  } catch {
    userId = 'user';
  }

  const repo = new SuppressionRepository(wsId);
  const result = await repo.unsuppress(email, userId || 'user');
  const responseData = typeof result === 'boolean'
    ? { email, unsuppressed: result }
    : {
        email: result?.email || email,
        unsuppressed: typeof result?.unsuppressed === 'boolean' ? result.unsuppressed : Boolean((result as any)?.success ?? true),
        restoredContactIds: result?.restoredContactIds || []
      };

  return c.json(successResponse(responseData));
});
