import { OpenAPIHono } from '@hono/zod-openapi';
import {
  CompanyIntelligenceRepository,
  WebsiteIntelligenceRepository,
  ContactIntelligenceRepository,
  OpportunityScoreRepository,
  PageCrawlRepository,
  IntelligenceSourceRepository,
  IntelligenceEvidenceRepository,
  IntelligenceClaimRepository,
  IntelligenceInferenceRepository
} from '../repositories/intelligence/index.js';
import {
  createCompanyIntelligenceDtoSchema,
  bulkCompanyIntelligenceDtoSchema,
  createWebsiteIntelligenceDtoSchema,
  createContactIntelligenceDtoSchema,
  createOpportunityScoreDtoSchema,
  createPageCrawlDtoSchema,
  createIntelligenceSourceDtoSchema,
  createIntelligenceEvidenceDtoSchema,
  bulkIntelligenceEvidenceDtoSchema,
  createIntelligenceClaimDtoSchema,
  createIntelligenceInferenceDtoSchema
} from '@huntara/schema';
import { successResponse } from '../utils/index.js';
import { getWorkspaceId } from './common.js';
import { NotFoundError } from '../errors/index.js';

export const intelligenceRouter = new OpenAPIHono();

// ── 1. Company Intelligence ──────────────────────────────────────────────────
intelligenceRouter.get('/company/:companyId', async (c) => {
  const wsId = getWorkspaceId(c);
  const companyId = c.req.param('companyId');
  const repo = new CompanyIntelligenceRepository(wsId);
  const intel = await repo.findByCompanyId(companyId);
  return c.json(successResponse(intel));
});

intelligenceRouter.post('/company', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createCompanyIntelligenceDtoSchema.parse(body);
  const repo = new CompanyIntelligenceRepository(wsId);
  const intel = await repo.create(validated);
  return c.json(successResponse(intel), 201);
});

intelligenceRouter.post('/company/bulk', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = bulkCompanyIntelligenceDtoSchema.parse(body);
  const repo = new CompanyIntelligenceRepository(wsId);
  const result = await repo.bulkUpsert(validated.items, ['companyId']);
  return c.json(successResponse(result), result.failed > 0 && result.inserted === 0 ? 400 : 201);
});

// ── 2. Website Intelligence ──────────────────────────────────────────────────
intelligenceRouter.get('/website/:companyId', async (c) => {
  const wsId = getWorkspaceId(c);
  const companyId = c.req.param('companyId');
  const repo = new WebsiteIntelligenceRepository(wsId);
  const intel = await repo.findByCompanyId(companyId);
  return c.json(successResponse(intel));
});

intelligenceRouter.post('/website', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createWebsiteIntelligenceDtoSchema.parse(body);
  const repo = new WebsiteIntelligenceRepository(wsId);
  const intel = await repo.create(validated);
  return c.json(successResponse(intel), 201);
});

// ── 3. Contact Intelligence ──────────────────────────────────────────────────
intelligenceRouter.get('/contact/:contactId', async (c) => {
  const wsId = getWorkspaceId(c);
  const contactId = c.req.param('contactId');
  const repo = new ContactIntelligenceRepository(wsId);
  const intel = await repo.findByContactId(contactId);
  return c.json(successResponse(intel));
});

intelligenceRouter.post('/contact', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createContactIntelligenceDtoSchema.parse(body);
  const repo = new ContactIntelligenceRepository(wsId);
  const intel = await repo.upsertByContactId(validated);
  return c.json(successResponse(intel), 201);
});

// ── 4. Opportunity Scores ────────────────────────────────────────────────────
intelligenceRouter.get('/opportunity-score/:companyId', async (c) => {
  const wsId = getWorkspaceId(c);
  const companyId = c.req.param('companyId');
  const repo = new OpportunityScoreRepository(wsId);
  const score = await repo.findByCompanyId(companyId);
  return c.json(successResponse(score));
});

intelligenceRouter.post('/opportunity-score', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createOpportunityScoreDtoSchema.parse(body);
  const repo = new OpportunityScoreRepository(wsId);
  const score = await repo.create(validated);
  return c.json(successResponse(score), 201);
});

// ── 5. Page Crawls ───────────────────────────────────────────────────────────
intelligenceRouter.get('/page-crawls/:companyId', async (c) => {
  const wsId = getWorkspaceId(c);
  const companyId = c.req.param('companyId');
  const repo = new PageCrawlRepository(wsId);
  const crawls = await repo.listByCompany(companyId);
  return c.json(successResponse(crawls));
});

intelligenceRouter.post('/page-crawls', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createPageCrawlDtoSchema.parse(body);
  const repo = new PageCrawlRepository(wsId);
  const crawl = await repo.create(validated);
  return c.json(successResponse(crawl), 201);
});

// ── 6. Intelligence Sources ──────────────────────────────────────────────────
intelligenceRouter.get('/sources/:companyId', async (c) => {
  const wsId = getWorkspaceId(c);
  const companyId = c.req.param('companyId');
  const repo = new IntelligenceSourceRepository(wsId);
  const sources = await repo.listByCompany(companyId);
  return c.json(successResponse(sources));
});

intelligenceRouter.post('/sources', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createIntelligenceSourceDtoSchema.parse(body);
  const repo = new IntelligenceSourceRepository(wsId);
  const source = await repo.create(validated);
  return c.json(successResponse(source), 201);
});

// ── 7. Intelligence Evidence ─────────────────────────────────────────────────
intelligenceRouter.get('/evidence/:companyId', async (c) => {
  const wsId = getWorkspaceId(c);
  const companyId = c.req.param('companyId');
  const repo = new IntelligenceEvidenceRepository(wsId);
  const evidence = await repo.listByCompany(companyId);
  return c.json(successResponse(evidence));
});

intelligenceRouter.post('/evidence', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createIntelligenceEvidenceDtoSchema.parse(body);
  const repo = new IntelligenceEvidenceRepository(wsId);
  const item = await repo.create(validated);
  return c.json(successResponse(item), 201);
});

intelligenceRouter.post('/evidence/bulk', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = bulkIntelligenceEvidenceDtoSchema.parse(body);
  const repo = new IntelligenceEvidenceRepository(wsId);
  const result = await repo.bulkInsert(validated.evidence);
  return c.json(successResponse(result), result.failed > 0 && result.inserted === 0 ? 400 : 201);
});

// ── 8. Intelligence Claims ───────────────────────────────────────────────────
intelligenceRouter.get('/claims/:companyId', async (c) => {
  const wsId = getWorkspaceId(c);
  const companyId = c.req.param('companyId');
  const repo = new IntelligenceClaimRepository(wsId);
  const claims = await repo.listByCompany(companyId);
  return c.json(successResponse(claims));
});

intelligenceRouter.post('/claims', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createIntelligenceClaimDtoSchema.parse(body);
  const repo = new IntelligenceClaimRepository(wsId);
  const claim = await repo.create(validated);
  return c.json(successResponse(claim), 201);
});

// ── 9. Intelligence Inferences ───────────────────────────────────────────────
intelligenceRouter.get('/inferences/:companyId', async (c) => {
  const wsId = getWorkspaceId(c);
  const companyId = c.req.param('companyId');
  const repo = new IntelligenceInferenceRepository(wsId);
  const inferences = await repo.listByCompany(companyId);
  return c.json(successResponse(inferences));
});

intelligenceRouter.post('/inferences', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const validated = createIntelligenceInferenceDtoSchema.parse(body);
  const repo = new IntelligenceInferenceRepository(wsId);
  const inference = await repo.create(validated);
  return c.json(successResponse(inference), 201);
});
