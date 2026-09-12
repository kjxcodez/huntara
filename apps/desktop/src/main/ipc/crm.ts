import { safeRegister } from './helper';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import { getDatabase } from '../database/connection';
import { WorkspaceManager } from '../lib/workspace-manager';
import { loadSession } from '../lib/session';
import type { CanonicalContactQuery, BulkContactSelection } from '@leadforge/schema';

import { resolveMatchingContactIds } from './query-resolver';
export { resolveMatchingContactIds };


/**
 * Registers CRM entities (companies, contacts, campaigns, activities) IPC channels
 * targeting the local SQLite database.
 */
export function registerCrmIpc() {
  // Companies
  safeRegister('companies:list', async (_event, { workspaceId, filter }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    return LocalCRMRepository.findMany('companies', workspaceId, filter);
  });

  safeRegister('companies:query', async (_event, { workspaceId, search, status, industry, discoveryRunId, location, city, state, country }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    const db = getDatabase(workspaceId);

    let query = 'SELECT DISTINCT c.* FROM companies c';
    const params: any[] = [];
    const conditions: string[] = ['c.workspaceId = ?', 'c.deletedAt IS NULL'];
    params.push(workspaceId);

    if (discoveryRunId) {
      query += ' INNER JOIN company_discovery_runs cdr ON c.id = cdr.companyId';
      conditions.push('cdr.discoveryRunId = ?');
      params.push(discoveryRunId);
    }

    if (search) {
      conditions.push('(c.name LIKE ? OR c.domain LIKE ? OR c.industry LIKE ? OR c.notes LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    if (status) {
      conditions.push('c.status = ?');
      params.push(status);
    }

    if (industry) {
      conditions.push('c.industry LIKE ?');
      params.push(`%${industry}%`);
    }

    if (location) {
      conditions.push('c.location LIKE ?');
      params.push(`%${location}%`);
    }

    if (city) {
      conditions.push('(c.city LIKE ? OR c.location LIKE ?)');
      params.push(`%${city}%`, `%${city}%`);
    }

    if (state) {
      conditions.push('(c.state LIKE ? OR c.location LIKE ?)');
      params.push(`%${state}%`, `%${state}%`);
    }

    if (country) {
      conditions.push('(c.country LIKE ? OR c.location LIKE ?)');
      params.push(`%${country}%`, `%${country}%`);
    }

    query += ' WHERE ' + conditions.join(' AND ') + ' ORDER BY c.createdAt DESC';

    return db.prepare(query).all(...params) as any[];
  });

  safeRegister('companies:get', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');
    return LocalCRMRepository.findById('companies', workspaceId, id);
  });

  safeRegister('companies:create', async (_event, record) => {
    if (!record.workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const created = await sdk.companies.create(record);
    await LocalCRMRepository.saveFromServer('companies', created);
    return created;
  });

  safeRegister('companies:update', async (_event, { id, dto }) => {
    const workspaceId = dto.workspaceId || dto.workspace_id;
    if (!workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const updated = await sdk.companies.update(id, dto);
    await LocalCRMRepository.saveFromServer('companies', updated);
    return updated;
  });

  safeRegister('companies:delete', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');
    const sdk = WorkspaceManager.getSdk();
    await sdk.companies.delete(id);
    await LocalCRMRepository.softDeleteFromServer('companies', workspaceId, id);
    return { success: true };
  });

  // Contacts
  safeRegister('contacts:list', async (_event, { workspaceId, filter }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    return LocalCRMRepository.findMany('contacts', workspaceId, filter);
  });

  safeRegister('contacts:query', async (_event, { workspaceId, search, status, companyId, title, source, discoveryRunId, location, city, state, country }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    const db = getDatabase(workspaceId);

    let query = 'SELECT DISTINCT c.* FROM contacts c';
    const params: any[] = [];
    const conditions: string[] = ['c.workspaceId = ?', 'c.deletedAt IS NULL'];
    params.push(workspaceId);

    const hasGeoFilter = Boolean(city || state || country || location);
    if (hasGeoFilter) {
      query += ' INNER JOIN companies comp ON c.companyId = comp.id AND comp.deletedAt IS NULL';
    }

    if (discoveryRunId) {
      query += ' INNER JOIN company_discovery_runs cdr ON c.companyId = cdr.companyId';
      conditions.push('cdr.discoveryRunId = ?');
      params.push(discoveryRunId);
    }

    if (search) {
      conditions.push('(c.firstName LIKE ? OR c.lastName LIKE ? OR c.email LIKE ? OR c.title LIKE ? OR c.notes LIKE ?)');
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    if (status) {
      conditions.push('c.status = ?');
      params.push(status);
    }

    if (companyId) {
      conditions.push('c.companyId = ?');
      params.push(companyId);
    }

    if (title) {
      conditions.push('c.title LIKE ?');
      params.push(`%${title}%`);
    }

    if (source) {
      conditions.push('c.source LIKE ?');
      params.push(`%${source}%`);
    }

    if (location) {
      conditions.push('comp.location LIKE ?');
      params.push(`%${location}%`);
    }

    if (city) {
      conditions.push('(comp.city LIKE ? OR comp.location LIKE ?)');
      params.push(`%${city}%`, `%${city}%`);
    }

    if (state) {
      conditions.push('(comp.state LIKE ? OR comp.location LIKE ?)');
      params.push(`%${state}%`, `%${state}%`);
    }

    if (country) {
      conditions.push('(comp.country LIKE ? OR comp.location LIKE ?)');
      params.push(`%${country}%`, `%${country}%`);
    }

    query += ' WHERE ' + conditions.join(' AND ') + ' ORDER BY c.createdAt DESC';

    const rows = db.prepare(query).all(...params) as any[];
    return rows.map((r) => {
      if (typeof r.tags === 'string') {
        try { r.tags = JSON.parse(r.tags); } catch {}
      }
      return r;
    });
  });

  safeRegister('companies:distinct-values', async (_event, { workspaceId }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    const db = getDatabase(workspaceId);
    const indRows = db.prepare(`SELECT DISTINCT industry FROM companies WHERE workspaceId = ? AND deletedAt IS NULL AND industry IS NOT NULL AND industry != '' ORDER BY industry ASC`).all(workspaceId) as Array<{ industry: string }>;
    const locRows = db.prepare(`SELECT DISTINCT location FROM companies WHERE workspaceId = ? AND deletedAt IS NULL AND location IS NOT NULL AND location != '' ORDER BY location ASC`).all(workspaceId) as Array<{ location: string }>;
    const cityRows = db.prepare(`SELECT DISTINCT city FROM companies WHERE workspaceId = ? AND deletedAt IS NULL AND city IS NOT NULL AND city != '' ORDER BY city ASC`).all(workspaceId) as Array<{ city: string }>;
    const stateRows = db.prepare(`SELECT DISTINCT state FROM companies WHERE workspaceId = ? AND deletedAt IS NULL AND state IS NOT NULL AND state != '' ORDER BY state ASC`).all(workspaceId) as Array<{ state: string }>;
    const countryRows = db.prepare(`SELECT DISTINCT country FROM companies WHERE workspaceId = ? AND deletedAt IS NULL AND country IS NOT NULL AND country != '' ORDER BY country ASC`).all(workspaceId) as Array<{ country: string }>;
    return {
      industries: indRows.map((r) => r.industry),
      locations: locRows.map((r) => r.location),
      cities: cityRows.map((r) => r.city),
      states: stateRows.map((r) => r.state),
      countries: countryRows.map((r) => r.country)
    };
  });

  safeRegister('contacts:distinct-values', async (_event, { workspaceId }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    const db = getDatabase(workspaceId);
    const titleRows = db.prepare(`SELECT DISTINCT title FROM contacts WHERE workspaceId = ? AND deletedAt IS NULL AND title IS NOT NULL AND title != '' ORDER BY title ASC`).all(workspaceId) as Array<{ title: string }>;
    const sourceRows = db.prepare(`SELECT DISTINCT source FROM contacts WHERE workspaceId = ? AND deletedAt IS NULL AND source IS NOT NULL AND source != '' ORDER BY source ASC`).all(workspaceId) as Array<{ source: string }>;

    const set = new Set<string>();
    sourceRows.forEach((r) => set.add(r.source));

    if (set.size === 0) {
      ['google_maps', 'web_crawler', 'linkedin', 'manual'].forEach((s) => set.add(s));
    }

    return {
      titles: titleRows.map((r) => r.title),
      sources: Array.from(set).sort()
    };
  });

  safeRegister('contacts:get', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');
    return LocalCRMRepository.findById('contacts', workspaceId, id);
  });

  safeRegister('contacts:create', async (_event, record) => {
    if (!record.workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const created = await sdk.contacts.create(record);
    await LocalCRMRepository.saveFromServer('contacts', created);
    return created;
  });

  safeRegister('contacts:update', async (_event, { id, dto }) => {
    const workspaceId = dto.workspaceId || dto.workspace_id;
    if (!workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const updated = await sdk.contacts.update(id, dto);
    await LocalCRMRepository.saveFromServer('contacts', updated);
    return updated;
  });

  safeRegister('contacts:delete', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');
    const sdk = WorkspaceManager.getSdk();
    await sdk.contacts.delete(id);
    await LocalCRMRepository.softDeleteFromServer('contacts', workspaceId, id);
    return { success: true };
  });

  safeRegister('contacts:query:resolve', async (_event, { workspaceId, query, excludedIds }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    const db = getDatabase(workspaceId);
    const contactIds = resolveMatchingContactIds(db, workspaceId, query || {}, excludedIds || []);
    return { contactIds, total: contactIds.length };
  });

  safeRegister('contacts:bulk:delete', async (_event, { workspaceId, selection }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!selection) throw new Error('selection is required.');
    const db = getDatabase(workspaceId);
    const sdk = WorkspaceManager.getSdk();

    let targetIds: string[] = [];
    if (selection.mode === 'explicit') {
      targetIds = Array.isArray(selection.selectedIds) ? selection.selectedIds : [];
    } else if (selection.mode === 'all-matching') {
      targetIds = resolveMatchingContactIds(db, workspaceId, selection.query || {}, selection.excludedIds || []);
    } else {
      throw new Error(`Unsupported selection mode: ${(selection as any).mode}`);
    }

    if (targetIds.length === 0) {
      return { success: true, count: 0 };
    }

    const BATCH_SIZE = 100;
    let deletedCount = 0;
    for (let i = 0; i < targetIds.length; i += BATCH_SIZE) {
      const batch = targetIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (id) => {
          try {
            await sdk.contacts.delete(id).catch(() => null);
            await LocalCRMRepository.softDeleteFromServer('contacts', workspaceId, id);
            deletedCount++;
          } catch (err) {
            console.warn(`[BulkDelete] Failed to delete contact ${id}:`, err);
          }
        })
      );
    }

    return { success: true, count: deletedCount };
  });

  safeRegister('contacts:bulk:update-status', async (_event, { workspaceId, selection, status }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!selection) throw new Error('selection is required.');
    if (!status) throw new Error('status is required.');
    const db = getDatabase(workspaceId);
    const sdk = WorkspaceManager.getSdk();

    let targetIds: string[] = [];
    if (selection.mode === 'explicit') {
      targetIds = Array.isArray(selection.selectedIds) ? selection.selectedIds : [];
    } else if (selection.mode === 'all-matching') {
      targetIds = resolveMatchingContactIds(db, workspaceId, selection.query || {}, selection.excludedIds || []);
    } else {
      throw new Error(`Unsupported selection mode: ${(selection as any).mode}`);
    }

    if (targetIds.length === 0) {
      return { success: true, count: 0 };
    }

    const BATCH_SIZE = 100;
    let updatedCount = 0;
    for (let i = 0; i < targetIds.length; i += BATCH_SIZE) {
      const batch = targetIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (id) => {
          try {
            const updated = await sdk.contacts.update(id, { status } as any).catch(() => null);
            if (updated) {
              await LocalCRMRepository.saveFromServer('contacts', updated);
            } else {
              db.prepare('UPDATE contacts SET status = ?, updatedAt = ? WHERE id = ? AND workspaceId = ?').run(
                status,
                new Date().toISOString(),
                id,
                workspaceId
              );
            }
            updatedCount++;
          } catch (err) {
            console.warn(`[BulkUpdateStatus] Failed to update contact ${id}:`, err);
          }
        })
      );
    }

    return { success: true, count: updatedCount };
  });

  // Helper function exported for use in campaigns-ipc and test runner
  // (Defined within module scope)


  // Campaigns
  safeRegister('campaigns:list', async (_event, payload) => {
    const workspaceId = payload?.workspaceId || WorkspaceManager.getActiveRuntime()?.workspaceId;
    if (!workspaceId) return [];
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime(workspaceId);
    if (!runtime) return [];
    const filter = payload?.filter;
    const campaigns = await LocalCRMRepository.findMany('campaigns', workspaceId, filter);
    const db = getDatabase(workspaceId);

    // Enrich campaigns with aggregate stats and auto-calculated statuses
    for (const campaign of campaigns) {
      const stats = db
        .prepare(
          `
        SELECT 
          COUNT(id) as total,
          SUM(CASE WHEN status IN ('running', 'queued', 'starting') THEN 1 ELSE 0 END) as running,
          SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
          SUM(CASE WHEN status IN ('replied', 'REPLIED') THEN 1 ELSE 0 END) as replied,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
        FROM sequence_executions
        WHERE campaignId = ? AND deletedAt IS NULL
      `
        )
        .get(campaign.id) as {
        total: number;
        running: number;
        waiting: number;
        replied: number;
        failed: number;
        paused: number;
        completed: number;
      };

      campaign.contactsCount = stats.total;
      campaign.runningCount = stats.running;
      campaign.waitingCount = stats.waiting;
      campaign.repliedCount = stats.replied;
      campaign.failedCount = stats.failed;
      campaign.pausedCount = stats.paused;
      campaign.completedCount = stats.completed;

      // Canonical status is preserved from authoritative store; provide computed execution status for UI
      const upperStatus = String(campaign.status || 'DRAFT').toUpperCase();
      campaign.status = upperStatus;
      if (stats.total > 0 && (stats.completed + stats.replied + stats.failed === stats.total) && upperStatus === 'ACTIVE') {
        campaign.executionState = 'COMPLETED';
      } else {
        campaign.executionState = upperStatus;
      }
    }

    return campaigns;
  });

  safeRegister('campaigns:get', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');
    const campaign = await LocalCRMRepository.findById('campaigns', workspaceId, id);
    if (!campaign) return null;

    const db = getDatabase(workspaceId);
    const stats = db
      .prepare(
        `
      SELECT 
        COUNT(id) as total,
        SUM(CASE WHEN UPPER(status) IN ('RUNNING', 'QUEUED', 'STARTING') THEN 1 ELSE 0 END) as running,
        SUM(CASE WHEN UPPER(status) = 'WAITING' THEN 1 ELSE 0 END) as waiting,
        SUM(CASE WHEN UPPER(status) = 'REPLIED' THEN 1 ELSE 0 END) as replied,
        SUM(CASE WHEN UPPER(status) = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN UPPER(status) = 'PAUSED' THEN 1 ELSE 0 END) as paused,
        SUM(CASE WHEN UPPER(status) = 'COMPLETED' THEN 1 ELSE 0 END) as completed
      FROM sequence_executions
      WHERE campaignId = ? AND deletedAt IS NULL
    `
      )
      .get(campaign.id) as {
      total: number;
      running: number;
      waiting: number;
      replied: number;
      failed: number;
      paused: number;
      completed: number;
    };

    campaign.contactsCount = stats.total;
    campaign.runningCount = stats.running;
    campaign.waitingCount = stats.waiting;
    campaign.repliedCount = stats.replied;
    campaign.failedCount = stats.failed;
    campaign.pausedCount = stats.paused;
    campaign.completedCount = stats.completed;

    return campaign;
  });

  safeRegister('companies:bulk:create', async (_event, dto) => {
    if (!dto.workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const result = await sdk.companies.createBulk(dto);
    if (result && Array.isArray(result.data)) {
      await LocalCRMRepository.saveManyFromServer('companies', result.data);
    }
    return result;
  });

  safeRegister('contacts:bulk:create', async (_event, dto) => {
    if (!dto.workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const result = await sdk.contacts.createBulk(dto);
    if (result && Array.isArray(result.data)) {
      await LocalCRMRepository.saveManyFromServer('contacts', result.data);
    }
    return result;
  });

  safeRegister('campaigns:create', async (_event, record) => {
    if (!record.workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const rawStatus = record.status ? String(record.status).toUpperCase() : 'DRAFT';
    const validStatus = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'].includes(rawStatus)
      ? rawStatus
      : 'DRAFT';
    const trackingEnabled = Boolean(record.trackingEnabled ?? record.settings?.trackingEnabled ?? false);
    const payload = {
      ...record,
      status: validStatus,
      trackingEnabled,
      idempotencyKey: record.idempotencyKey || undefined
    };
    const created = await sdk.campaigns.create(payload);
    await LocalCRMRepository.saveFromServer('campaigns', created);
    return created;
  });

  safeRegister('campaigns:update', async (_event, { id, dto }) => {
    const workspaceId = dto.workspaceId || dto.workspace_id;
    if (!workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const rawStatus = dto.status ? String(dto.status).toUpperCase() : undefined;
    const validStatus =
      rawStatus && ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED'].includes(rawStatus)
        ? rawStatus
        : rawStatus;
    const payload = {
      ...dto,
      ...(validStatus ? { status: validStatus } : {})
    };
    const updated = await sdk.campaigns.update(id, payload);
    await LocalCRMRepository.saveFromServer('campaigns', updated);
    return updated;
  });

  safeRegister('campaigns:delete', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');
    const sdk = WorkspaceManager.getSdk();
    await sdk.campaigns.delete(id);
    await LocalCRMRepository.softDeleteFromServer('campaigns', workspaceId, id);
    return { success: true };
  });

  // Activities / Audit log
  safeRegister('activities:list', async (_event, { workspaceId, filter }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const page = filter?.page || 1;
    const limit = filter?.limit || 50;

    if (filter?.entityType && filter?.entityId) {
      return sdk.auditLogs.listByEntity(filter.entityType, filter.entityId, limit);
    }
    if (filter?.actorId || filter?.userId) {
      return sdk.auditLogs.listByActor(filter.actorId || filter.userId, limit);
    }

    const res = await sdk.auditLogs.list(page, limit);
    return res?.data || [];
  });

  safeRegister('intelligence:get', async (_event, { workspaceId, companyId }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!companyId) throw new Error('companyId is required.');

    const db = getDatabase(workspaceId);

    const companyIntelligence = db
      .prepare('SELECT * FROM company_intelligence WHERE companyId = ?')
      .get(companyId);
    const websiteIntelligence = db
      .prepare('SELECT * FROM website_intelligence WHERE companyId = ?')
      .get(companyId);
    const contactIntelligences = db
      .prepare(
        `
      SELECT ci.*, c.firstName, c.lastName, c.title
      FROM contact_intelligence ci
      JOIN contacts c ON c.id = ci.contactId
      WHERE c.companyId = ?
    `
      )
      .all(companyId);
    const opportunityScore = db
      .prepare('SELECT * FROM opportunity_scores WHERE companyId = ?')
      .get(companyId);

    const safeParse = (str: any) => {
      if (!str) return [];
      try {
        return JSON.parse(str);
      } catch {
        return [];
      }
    };

    const sources = db
      .prepare('SELECT * FROM intelligence_sources WHERE companyId = ?')
      .all(companyId);
    const evidence = db
      .prepare('SELECT * FROM intelligence_evidence WHERE companyId = ?')
      .all(companyId);
    const claims = db
      .prepare('SELECT * FROM intelligence_claims WHERE companyId = ?')
      .all(companyId);
    const inferences = db
      .prepare('SELECT * FROM intelligence_inferences WHERE companyId = ?')
      .all(companyId);

    return {
      companyIntelligence: companyIntelligence
        ? {
            ...companyIntelligence,
            techStack: safeParse((companyIntelligence as any).techStack),
            growthSignals: safeParse((companyIntelligence as any).growthSignals),
            hiringSignals: safeParse((companyIntelligence as any).hiringSignals),
            missingInformation: safeParse((companyIntelligence as any).missingInformation)
          }
        : null,
      websiteIntelligence: websiteIntelligence
        ? {
            ...websiteIntelligence,
            buyingSignals: safeParse((websiteIntelligence as any).buyingSignals),
            seoSignals: safeParse((websiteIntelligence as any).seoSignals),
            technicalIssues: safeParse((websiteIntelligence as any).technicalIssues),
            productsServices: safeParse((websiteIntelligence as any).productsServices),
            testimonialsCaseStudies: safeParse((websiteIntelligence as any).testimonialsCaseStudies)
          }
        : null,
      contactIntelligences: contactIntelligences.map((c: any) => ({
        ...c,
        personalizationOpportunities: safeParse(c.personalizationOpportunities)
      })),
      opportunityScore: opportunityScore
        ? {
            ...opportunityScore,
            provenance: safeParse((opportunityScore as any).provenance)
          }
        : null,
      sources,
      evidence,
      claims: claims.map((clm: any) => ({
        ...clm,
        evidenceIds: safeParse(clm.evidenceIds)
      })),
      inferences: inferences.map((inf: any) => ({
        ...inf,
        supportingClaimIds: safeParse(inf.supportingClaimIds)
      }))
    };
  });

  safeRegister('intelligence:trigger', async (_event, { workspaceId, companyId }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!companyId) throw new Error('companyId is required.');

    const sdk = WorkspaceManager.getSdk();
    const jobId = require('crypto').randomUUID();

    await sdk.jobs.create({
      id: jobId,
      type: 'enrich:intelligence',
      priority: 5,
      payload: { companyId }
    });

    return { success: true, jobId };
  });
}
