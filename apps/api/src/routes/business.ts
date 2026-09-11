import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  createWorkspaceDtoSchema,
  updateWorkspaceDtoSchema,
  inviteMemberDtoSchema,
  updateMemberRoleDtoSchema,
  acceptInviteDtoSchema,
  WorkspaceRole,
  createCompanyDtoSchema,
  updateCompanyDtoSchema,
  createContactDtoSchema,
  updateContactDtoSchema,
  createCampaignDtoSchema,
  updateCampaignDtoSchema
} from '@leadforge/schema';
import { WorkspaceService } from '../services/workspace/workspace.service.js';
import { CompanyService } from '../services/company/company.service.js';
import { ContactService } from '../services/contact/contact.service.js';
import { CampaignService } from '../services/campaign/campaign.service.js';
import { OutreachService } from '../services/outreach/outreach.service.js';
import { DiscoveryRunService } from '../services/discovery-run/discovery-run.service.js';
import { AudienceService } from '../services/audience/audience.service.js';
import { successResponse } from '../utils/index.js';
import { ForbiddenError } from '../errors/index.js';

export const companiesRouter = new OpenAPIHono();
export const contactsRouter = new OpenAPIHono();
export const campaignsRouter = new OpenAPIHono();
export const outreachRouter = new OpenAPIHono();
export const workspacesRouter = new OpenAPIHono();
export const discoveryRunsRouter = new OpenAPIHono();
export const companyDiscoveryRunsRouter = new OpenAPIHono();
export const audiencesRouter = new OpenAPIHono();

const workspaceService = new WorkspaceService();

// Helper to get active user ID from context
function getUserId(c: any): string {
  const user = c.get('user');
  const userId = user?.id || user?._id;
  if (!userId) throw new ForbiddenError('Authentication required.');
  return userId.toString();
}

// Helper to get active workspace ID from context
function getWorkspaceId(c: any): string {
  const wsId = c.get('workspaceId');
  if (!wsId) throw new ForbiddenError('Workspace context required.');
  return wsId.toString();
}

// ---------------------------------------------------------------------------
// 1. List User Workspaces
// ---------------------------------------------------------------------------
const listWorkspacesRoute = createRoute({
  method: 'get',
  path: '/',
  summary: 'List User Workspaces',
  tags: ['Workspace'],
  responses: {
    200: { description: 'List of workspaces retrieved successfully' }
  }
});

workspacesRouter.openapi(listWorkspacesRoute, async (c) => {
  const userId = getUserId(c);
  const workspaces = await workspaceService.listUserWorkspaces(userId);
  return c.json(successResponse(workspaces));
});

// ---------------------------------------------------------------------------
// 2. Get Workspace Details
// ---------------------------------------------------------------------------
const getWorkspaceRoute = createRoute({
  method: 'get',
  path: '/{id}',
  summary: 'Get Workspace Details',
  tags: ['Workspace'],
  request: {
    params: z.object({ id: z.string() })
  },
  responses: {
    200: { description: 'Workspace details retrieved' },
    404: { description: 'Workspace not found' }
  }
});

workspacesRouter.openapi(getWorkspaceRoute, async (c) => {
  const { id } = c.req.valid('param');
  const workspace = await workspaceService.getWorkspaceById(id);
  return c.json(successResponse(workspace));
});

// ---------------------------------------------------------------------------
// 3. Create Workspace
// ---------------------------------------------------------------------------
const createWorkspaceRoute = createRoute({
  method: 'post',
  path: '/',
  summary: 'Create Workspace',
  tags: ['Workspace'],
  request: {
    body: {
      content: {
        'application/json': { schema: createWorkspaceDtoSchema }
      }
    }
  },
  responses: {
    200: { description: 'Workspace created successfully' }
  }
});

workspacesRouter.openapi(createWorkspaceRoute, async (c) => {
  const body = c.req.valid('json');
  const userId = getUserId(c);
  const user = (c as any).get('user') as any;
  const workspace = await workspaceService.createWorkspace({
    ...body,
    ownerId: userId,
    ownerEmail: user?.email ?? ''
  });
  return c.json(successResponse(workspace));
});

// ---------------------------------------------------------------------------
// 4. Update Workspace
// ---------------------------------------------------------------------------
const updateWorkspaceRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  summary: 'Update Workspace',
  tags: ['Workspace'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': { schema: updateWorkspaceDtoSchema }
      }
    }
  },
  responses: {
    200: { description: 'Workspace updated successfully' }
  }
});

workspacesRouter.openapi(updateWorkspaceRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const userId = getUserId(c);
  const workspace = await workspaceService.updateWorkspace(id, body, userId);
  return c.json(successResponse(workspace));
});

// ---------------------------------------------------------------------------
// 4b. Update Workspace Outreach Policy (OWNER only)
// ---------------------------------------------------------------------------
const updateWorkspacePolicySchema = z.object({
  dailyLimit: z.number().int().min(1).max(2000).nullable().optional(),
  hourlyLimit: z.number().int().min(1).max(200).nullable().optional(),
  minSendIntervalMs: z.number().int().min(1000).nullable().optional()
});

workspacesRouter.patch('/:id/policy', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const validated = updateWorkspacePolicySchema.parse(body);
  const userId = getUserId(c);

  const workspace = await workspaceService.getWorkspaceById(id);
  const isOwner = workspace.ownerId === userId;
  const member = workspace.members.find((m) => m.userId === userId);
  if (!isOwner && member?.role !== 'OWNER') {
    throw new ForbiddenError('Only workspace owners can update outreach policy.');
  }

  workspace.settings = {
    ...workspace.settings,
    outreachPolicy: {
      dailyLimit: validated.dailyLimit ?? workspace.settings?.outreachPolicy?.dailyLimit ?? null,
      hourlyLimit: validated.hourlyLimit ?? workspace.settings?.outreachPolicy?.hourlyLimit ?? null,
      minSendIntervalMs: validated.minSendIntervalMs ?? workspace.settings?.outreachPolicy?.minSendIntervalMs ?? null
    }
  };

  const updated = await workspace.save();
  return c.json(successResponse(updated));
});

// ---------------------------------------------------------------------------
// 4c. Get Workspace Scheduler Concurrency Policy
// ---------------------------------------------------------------------------
workspacesRouter.get('/:id/scheduler-policy', async (c) => {
  const id = c.req.param('id');
  const wsId = (c as any).get('workspaceId');
  if (wsId && wsId !== id) {
    throw new ForbiddenError('Cross-workspace access prohibited.');
  }
  const policy = await workspaceService.getSchedulerPolicy(id);
  return c.json(successResponse(policy));
});

// ---------------------------------------------------------------------------
// 4d. Update Workspace Scheduler Concurrency Policy (OWNER / ADMIN only)
// ---------------------------------------------------------------------------
workspacesRouter.put('/:id/scheduler-policy', async (c) => {
  const id = c.req.param('id');
  const wsId = (c as any).get('workspaceId');
  if (wsId && wsId !== id) {
    throw new ForbiddenError('Cross-workspace access prohibited.');
  }
  const body = await c.req.json();
  const userId = getUserId(c);
  const updatedPolicy = await workspaceService.updateSchedulerPolicy(id, body, userId);
  return c.json(successResponse(updatedPolicy));
});

workspacesRouter.patch('/:id/scheduler-policy', async (c) => {
  const id = c.req.param('id');
  const wsId = (c as any).get('workspaceId');
  if (wsId && wsId !== id) {
    throw new ForbiddenError('Cross-workspace access prohibited.');
  }
  const body = await c.req.json();
  const userId = getUserId(c);
  const updatedPolicy = await workspaceService.updateSchedulerPolicy(id, body, userId);
  return c.json(successResponse(updatedPolicy));
});

// ---------------------------------------------------------------------------
// 5. Delete Workspace (Soft Delete)
// ---------------------------------------------------------------------------
const deleteWorkspaceRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  summary: 'Soft Delete Workspace',
  tags: ['Workspace'],
  request: {
    params: z.object({ id: z.string() })
  },
  responses: {
    200: { description: 'Workspace deleted successfully' }
  }
});

workspacesRouter.openapi(deleteWorkspaceRoute, async (c) => {
  const { id } = c.req.valid('param');
  const userId = getUserId(c);
  await workspaceService.softDeleteWorkspace(id, userId);
  return c.json(successResponse({ success: true }));
});

// ---------------------------------------------------------------------------
// 6. Invite Member
// ---------------------------------------------------------------------------
const inviteMemberRoute = createRoute({
  method: 'post',
  path: '/{id}/invite',
  summary: 'Invite Member to Workspace',
  tags: ['Workspace Members'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': { schema: inviteMemberDtoSchema }
      }
    }
  },
  responses: {
    200: { description: 'Member invited successfully' }
  }
});

workspacesRouter.openapi(inviteMemberRoute, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const userId = getUserId(c);
  const workspace = await workspaceService.inviteMember(id, body, userId);
  return c.json(successResponse(workspace));
});

// ---------------------------------------------------------------------------
// 7. List Workspace Members
// ---------------------------------------------------------------------------
const listMembersRoute = createRoute({
  method: 'get',
  path: '/{id}/members',
  summary: 'List Workspace Members',
  tags: ['Workspace Members'],
  request: {
    params: z.object({ id: z.string() })
  },
  responses: {
    200: { description: 'Workspace members listed successfully' }
  }
});

workspacesRouter.openapi(listMembersRoute, async (c) => {
  const { id } = c.req.valid('param');
  const workspace = await workspaceService.getWorkspaceById(id);
  return c.json(successResponse(workspace.members));
});

// ---------------------------------------------------------------------------
// 8. Update Member Role
// ---------------------------------------------------------------------------
const updateMemberRoleRoute = createRoute({
  method: 'patch',
  path: '/{id}/members/{memberId}/role',
  summary: 'Update Member Role',
  tags: ['Workspace Members'],
  request: {
    params: z.object({ id: z.string(), memberId: z.string() }),
    body: {
      content: {
        'application/json': { schema: updateMemberRoleDtoSchema }
      }
    }
  },
  responses: {
    200: { description: 'Role updated successfully' }
  }
});

workspacesRouter.openapi(updateMemberRoleRoute, async (c) => {
  const { id, memberId } = c.req.valid('param');
  const { role } = c.req.valid('json');
  const userId = getUserId(c);
  const workspace = await workspaceService.updateMemberRole(
    id,
    memberId,
    role as WorkspaceRole,
    userId
  );
  return c.json(successResponse(workspace));
});

// ---------------------------------------------------------------------------
// 9. Remove Member
// ---------------------------------------------------------------------------
const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/{id}/members/{memberId}',
  summary: 'Remove Member from Workspace',
  tags: ['Workspace Members'],
  request: {
    params: z.object({ id: z.string(), memberId: z.string() })
  },
  responses: {
    200: { description: 'Member removed successfully' }
  }
});

workspacesRouter.openapi(removeMemberRoute, async (c) => {
  const { id, memberId } = c.req.valid('param');
  const userId = getUserId(c);
  const workspace = await workspaceService.removeMember(id, memberId, userId);
  return c.json(successResponse(workspace));
});

// ---------------------------------------------------------------------------
// 10. Leave Workspace
// ---------------------------------------------------------------------------
const leaveWorkspaceRoute = createRoute({
  method: 'post',
  path: '/{id}/leave',
  summary: 'Leave Workspace',
  tags: ['Workspace Members'],
  request: {
    params: z.object({ id: z.string() })
  },
  responses: {
    200: { description: 'Left workspace successfully' }
  }
});

workspacesRouter.openapi(leaveWorkspaceRoute, async (c) => {
  const { id } = c.req.valid('param');
  const userId = getUserId(c);
  const workspace = await workspaceService.leaveWorkspace(id, userId);
  return c.json(successResponse(workspace));
});

// ---------------------------------------------------------------------------
// 11. Transfer Ownership
// ---------------------------------------------------------------------------
const transferOwnershipRoute = createRoute({
  method: 'post',
  path: '/{id}/transfer-ownership',
  summary: 'Transfer Workspace Ownership',
  tags: ['Workspace Members'],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ newOwnerId: z.string() })
        }
      }
    }
  },
  responses: {
    200: { description: 'Ownership transferred successfully' }
  }
});

workspacesRouter.openapi(transferOwnershipRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { newOwnerId } = c.req.valid('json');
  const userId = getUserId(c);
  const workspace = await workspaceService.transferOwnership(id, newOwnerId, userId);
  return c.json(successResponse(workspace));
});

// ---------------------------------------------------------------------------
// 12. List Pending Invitations (for logged-in user)
// ---------------------------------------------------------------------------
const listUserInvitesRoute = createRoute({
  method: 'get',
  path: '/invites/pending',
  summary: 'List User Pending Invitations',
  tags: ['Workspace Invitations'],
  responses: {
    200: { description: 'Pending invites retrieved' }
  }
});

workspacesRouter.openapi(listUserInvitesRoute, async (c) => {
  const user = (c as any).get('user');
  if (!user || !user.email) {
    return c.json(successResponse([]));
  }
  const invites = await workspaceService.listPendingUserInvitesByEmail(user.email);
  return c.json(successResponse(invites));
});

// ---------------------------------------------------------------------------
// 13. Accept Invitation
// ---------------------------------------------------------------------------
const acceptInviteRoute = createRoute({
  method: 'post',
  path: '/invites/accept',
  summary: 'Accept Invitation',
  tags: ['Workspace Invitations'],
  request: {
    body: {
      content: {
        'application/json': { schema: acceptInviteDtoSchema }
      }
    }
  },
  responses: {
    200: { description: 'Invitation accepted' }
  }
});

workspacesRouter.openapi(acceptInviteRoute, async (c) => {
  const { token } = c.req.valid('json');
  const userId = getUserId(c);
  const workspace = await workspaceService.acceptInvite(token, userId);
  return c.json(successResponse(workspace));
});

// ---------------------------------------------------------------------------
// 14. Decline Invitation
// ---------------------------------------------------------------------------
const declineInviteRoute = createRoute({
  method: 'post',
  path: '/invites/decline',
  summary: 'Decline Invitation',
  tags: ['Workspace Invitations'],
  request: {
    body: {
      content: {
        'application/json': { schema: acceptInviteDtoSchema } // Reuses token schema
      }
    }
  },
  responses: {
    200: { description: 'Invitation declined' }
  }
});

workspacesRouter.openapi(declineInviteRoute, async (c) => {
  const { token } = c.req.valid('json');
  const userId = getUserId(c);
  const workspace = await workspaceService.declineInvite(token, userId);
  return c.json(successResponse(workspace));
});

// ── Companies Router ──────────────────────────────────────────────────────

companiesRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const status = c.req.query('status');
  const industry = c.req.query('industry');
  const city = c.req.query('city');
  const state = c.req.query('state');
  const country = c.req.query('country');
  const location = c.req.query('location');
  const name = c.req.query('name');
  const domain = c.req.query('domain');
  const search = c.req.query('search');

  const filter: any = {};
  if (status && status !== 'undefined' && status !== 'null') filter.status = status;
  if (industry && industry !== 'undefined' && industry !== 'null') filter.industry = industry;
  if (city && city !== 'undefined' && city !== 'null') filter.city = city;
  if (state && state !== 'undefined' && state !== 'null') filter.state = state;
  if (country && country !== 'undefined' && country !== 'null') filter.country = country;
  if (location && location !== 'undefined' && location !== 'null') filter.location = location;
  if (name && name !== 'undefined' && name !== 'null') filter.name = name;
  if (domain && domain !== 'undefined' && domain !== 'null') filter.domain = domain;
  if (search && search !== 'undefined' && search !== 'null') filter.search = search;

  const service = new CompanyService(wsId);
  const result = await service.listCompanies(page, limit, filter);
  return c.json(successResponse(result.data));
});

companiesRouter.get('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new CompanyService(wsId);
  const company = await service.getCompanyById(id);
  return c.json(successResponse(company));
});

companiesRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new CompanyService(wsId);
  const company = await service.createCompany({ ...body, workspaceId: wsId });
  return c.json(successResponse(company));
});

companiesRouter.post('/bulk', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new CompanyService(wsId);
  const result = await service.createBulk(body);
  return c.json(successResponse(result), result.failed > 0 && result.inserted === 0 ? 400 : 200);
});

companiesRouter.patch('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const service = new CompanyService(wsId);
  const company = await service.updateCompany(id, body);
  return c.json(successResponse(company));
});

companiesRouter.delete('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new CompanyService(wsId);
  await service.deleteCompany(id);
  return c.json(successResponse({ success: true }));
});

// ── Contacts Router ───────────────────────────────────────────────────────

contactsRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const companyId = c.req.query('companyId');
  const status = c.req.query('status');
  const email = c.req.query('email');
  const title = c.req.query('title');
  const source = c.req.query('source');
  const search = c.req.query('search');

  const filter: any = {};
  if (companyId && companyId !== 'undefined' && companyId !== 'null') filter.companyId = companyId;
  if (status && status !== 'undefined' && status !== 'null') filter.status = status;
  if (email && email !== 'undefined' && email !== 'null') filter.email = email;
  if (title && title !== 'undefined' && title !== 'null') filter.title = title;
  if (source && source !== 'undefined' && source !== 'null') filter.source = source;
  if (search && search !== 'undefined' && search !== 'null') filter.search = search;

  const service = new ContactService(wsId);
  const result = await service.listContacts(page, limit, filter);
  return c.json(successResponse(result.data));
});

contactsRouter.get('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new ContactService(wsId);
  const contact = await service.getContactById(id);
  return c.json(successResponse(contact));
});

contactsRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new ContactService(wsId);
  const contact = await service.createContact({ ...body, workspaceId: wsId });
  return c.json(successResponse(contact));
});

contactsRouter.post('/bulk', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new ContactService(wsId);
  const result = await service.createBulk(body);
  return c.json(successResponse(result), result.failed > 0 && result.inserted === 0 ? 400 : 200);
});

contactsRouter.patch('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const service = new ContactService(wsId);
  const contact = await service.updateContact(id, body);
  return c.json(successResponse(contact));
});

contactsRouter.delete('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new ContactService(wsId);
  await service.deleteContact(id);
  return c.json(successResponse({ success: true }));
});

// ── Campaigns Router ──────────────────────────────────────────────────────

campaignsRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const service = new CampaignService(wsId);
  const result = await service.listCampaigns(page, limit);
  return c.json(successResponse(result.data));
});

campaignsRouter.get('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new CampaignService(wsId);
  const campaign = await service.getCampaignById(id);
  return c.json(successResponse(campaign));
});

campaignsRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new CampaignService(wsId);
  const idempotencyKey =
    c.req.header('idempotency-key') ||
    c.req.header('x-idempotency-key') ||
    body.idempotencyKey ||
    body.idempotency_key;
  const campaign = await service.createCampaign({
    ...body,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    workspaceId: wsId
  });
  return c.json(successResponse(campaign));
});

campaignsRouter.patch('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const service = new CampaignService(wsId);
  const campaign = await service.updateCampaign(id, body);
  return c.json(successResponse(campaign));
});

campaignsRouter.delete('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new CampaignService(wsId);
  await service.deleteCampaign(id);
  return c.json(successResponse({ success: true }));
});

campaignsRouter.post('/:id/schedule', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new OutreachService(wsId);
  await service.scheduleCampaign(id);
  return c.json(successResponse({ success: true }));
});

campaignsRouter.post('/:id/pause', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new CampaignService(wsId);
  const campaign = await service.pauseCampaign(id);
  return c.json(successResponse(campaign));
});

campaignsRouter.post('/:id/resume', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new CampaignService(wsId);
  const campaign = await service.resumeCampaign(id);
  return c.json(successResponse(campaign));
});

campaignsRouter.post('/:id/stop', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new CampaignService(wsId);
  const campaign = await service.stopCampaign(id);
  return c.json(successResponse(campaign));
});

// ── Outreach Email Accounts & Templates Router ──────────────────────────────

outreachRouter.get('/accounts', async (c) => {
  const wsId = getWorkspaceId(c);
  const service = new OutreachService(wsId);
  const accounts = await service.listEmailAccounts();
  return c.json(successResponse(accounts));
});

outreachRouter.post('/accounts', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new OutreachService(wsId);
  const account = await service.createEmailAccount(body);
  return c.json(successResponse(account));
});

outreachRouter.delete('/accounts/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new OutreachService(wsId);
  await service.deleteEmailAccount(id);
  return c.json(successResponse({ success: true }));
});

outreachRouter.post('/accounts/:id/verify', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new OutreachService(wsId);
  const verified = await service.testConnection(id);
  return c.json(successResponse({ verified }));
});

outreachRouter.post('/accounts/:id/disconnect', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new OutreachService(wsId);
  await service.disconnectEmailAccount(id);
  return c.json(successResponse({ success: true }));
});

outreachRouter.post('/accounts/:id/reconnect', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const service = new OutreachService(wsId);
  const account = await service.reconnectEmailAccount(id, body);
  return c.json(successResponse(account));
});

outreachRouter.get('/templates', async (c) => {
  const wsId = getWorkspaceId(c);
  const service = new OutreachService(wsId);
  const templates = await service.listTemplates();
  return c.json(successResponse(templates));
});

outreachRouter.post('/templates', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new OutreachService(wsId);
  const template = await service.createTemplate(body);
  return c.json(successResponse(template));
});

outreachRouter.get('/templates/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new OutreachService(wsId);
  const template = await service.getTemplate(id);
  return c.json(successResponse(template));
});

outreachRouter.get('/templates/:id/versions/:version', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const version = parseInt(c.req.param('version'), 10);
  const service = new OutreachService(wsId);
  const versionDoc = await service.getTemplateVersion(id, version);
  return c.json(successResponse(versionDoc));
});

outreachRouter.delete('/templates/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new OutreachService(wsId);
  await service.deleteTemplate(id);
  return c.json(successResponse({ success: true }));
});

outreachRouter.patch('/templates/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const service = new OutreachService(wsId);
  const updated = await service.updateTemplate(id, body);
  return c.json(successResponse(updated));
});

outreachRouter.get('/templates/:id/preview', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const contactId = c.req.query('contactId');
  const versionParam = c.req.query('version');
  const version = versionParam ? parseInt(versionParam, 10) : undefined;
  const service = new OutreachService(wsId);
  const preview = await service.previewTemplate(id, contactId, version);
  return c.json(successResponse(preview));
});

// ── Discovery Runs Router ──────────────────────────────────────────────────

discoveryRunsRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const service = new DiscoveryRunService(wsId);
  const result = await service.listRuns(page, limit);
  return c.json(successResponse(result.data));
});

discoveryRunsRouter.get('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new DiscoveryRunService(wsId);
  const run = await service.getRunById(id);
  return c.json(successResponse(run));
});

discoveryRunsRouter.get('/:id/companies', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new DiscoveryRunService(wsId);
  const companies = await service.getCompaniesForRun(id);
  return c.json(successResponse(companies));
});

discoveryRunsRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new DiscoveryRunService(wsId);
  const run = await service.createRun({ ...body, workspaceId: wsId });
  return c.json(successResponse(run));
});

discoveryRunsRouter.patch('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const service = new DiscoveryRunService(wsId);
  const run = await service.updateRun(id, body);
  return c.json(successResponse(run));
});

discoveryRunsRouter.delete('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new DiscoveryRunService(wsId);
  await service.deleteRun(id);
  return c.json(successResponse({ success: true }));
});

// ── Company Discovery Runs (Provenance) Router ──────────────────────────────

companyDiscoveryRunsRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const discoveryRunId = c.req.query('discoveryRunId');
  const service = new DiscoveryRunService(wsId);
  const filter: any = {};
  if (discoveryRunId) filter.discoveryRunId = discoveryRunId;
  const result = await service.listProvenance(filter, page, limit);
  return c.json(successResponse(result.data));
});

companyDiscoveryRunsRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new DiscoveryRunService(wsId);
  const prov = await service.recordCompanyProvenance(
    body.companyId,
    body.discoveryRunId,
    body.requiresReview
  );
  return c.json(successResponse(prov));
});

companyDiscoveryRunsRouter.patch('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new DiscoveryRunService(wsId);
  const prov = await service.recordCompanyProvenance(
    body.companyId,
    body.discoveryRunId,
    body.requiresReview
  );
  return c.json(successResponse(prov));
});

companyDiscoveryRunsRouter.delete('/:id', async (c) => {
  return c.json(successResponse({ success: true }));
});

// ── Audiences Router ────────────────────────────────────────────────────────

audiencesRouter.get('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '100');
  const service = new AudienceService(wsId);
  const result = await service.listAudiences(page, limit);
  return c.json(successResponse(result.data));
});

audiencesRouter.get('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new AudienceService(wsId);
  const audience = await service.getAudienceById(id);
  return c.json(successResponse(audience));
});

audiencesRouter.post('/', async (c) => {
  const wsId = getWorkspaceId(c);
  const body = await c.req.json();
  const service = new AudienceService(wsId);
  const audience = await service.createAudience({ ...body, workspaceId: wsId });
  return c.json(successResponse(audience));
});

audiencesRouter.patch('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const service = new AudienceService(wsId);
  const audience = await service.updateAudience(id, body);
  return c.json(successResponse(audience));
});

audiencesRouter.delete('/:id', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new AudienceService(wsId);
  await service.deleteAudience(id);
  return c.json(successResponse({ success: true }));
});

audiencesRouter.post('/:id/resolve', async (c) => {
  const wsId = getWorkspaceId(c);
  const id = c.req.param('id');
  const service = new AudienceService(wsId);
  const resolved = await service.resolveAudience(id);
  return c.json(successResponse(resolved));
});

