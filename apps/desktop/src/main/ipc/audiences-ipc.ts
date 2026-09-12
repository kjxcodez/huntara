import { safeRegister } from './helper';
import { LocalCRMRepository } from '../database/repositories/local-crm';
import { getDatabase } from '../database/connection';
import { WorkspaceManager } from '../lib/workspace-manager';
import { ProjectionService } from '../services/projection-service';
import { ConnectivityService } from '../services/connectivity-service';

export function resolveAudienceLocally(
  workspaceId: string,
  filterDefinition: any,
  mode?: string,
  staticMemberIds?: any
) {
  const db = getDatabase(workspaceId);
  const isStatic = mode === 'static' || (Array.isArray(staticMemberIds) && staticMemberIds.length > 0);

  if (isStatic) {
    let ids: string[] = [];
    if (Array.isArray(staticMemberIds)) {
      ids = staticMemberIds.map((id) => String(id));
    } else if (typeof staticMemberIds === 'string') {
      try {
        const parsed = JSON.parse(staticMemberIds);
        if (Array.isArray(parsed)) ids = parsed.map((id) => String(id));
      } catch {}
    }

    if (ids.length === 0) {
      return { contactIds: [], companyIds: [] };
    }

    // Query active contacts matching staticMemberIds in workspace
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db
      .prepare(
         `SELECT id, companyId FROM contacts 
          WHERE id IN (${placeholders}) 
            AND workspaceId = ? 
            AND deletedAt IS NULL
            AND email IS NOT NULL AND email != ''
            AND UPPER(COALESCE(status, 'NEW')) NOT IN ('UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT', 'ARCHIVED')
            AND UPPER(COALESCE(emailStatus, 'UNVERIFIED')) NOT IN ('QUARANTINED', 'INVALID')
            AND LOWER(email) NOT IN (SELECT LOWER(email) FROM suppressions WHERE workspaceId = ?)`
      )
      .all(...ids, workspaceId, workspaceId) as Array<{ id: string; companyId: string | null }>;

    const contactIds = rows.map((r) => r.id);
    const companyIds = Array.from(
      new Set(rows.map((r) => r.companyId).filter(Boolean))
    ) as string[];

    return { contactIds, companyIds };
  }

  // Dynamic mode resolution
  const filter = filterDefinition || {};

  let companyQuery = 'SELECT id FROM companies WHERE workspaceId = ? AND deletedAt IS NULL';
  const companyParams: any[] = [workspaceId];

  let contactQuery = `SELECT id FROM contacts 
    WHERE workspaceId = ? 
      AND deletedAt IS NULL 
      AND email IS NOT NULL AND email != ''
      AND UPPER(COALESCE(status, 'NEW')) NOT IN ('UNSUBSCRIBED', 'BOUNCED', 'DO_NOT_CONTACT', 'ARCHIVED')
      AND UPPER(COALESCE(emailStatus, 'UNVERIFIED')) NOT IN ('QUARANTINED', 'INVALID')
      AND LOWER(email) NOT IN (SELECT LOWER(email) FROM suppressions WHERE workspaceId = ?)`;
  const contactParams: any[] = [workspaceId, workspaceId];
  let hasCompanyFilter = false;

  if (filter.search) {
    companyQuery += ' AND (name LIKE ? OR domain LIKE ? OR industry LIKE ?)';
    const term = `%${filter.search}%`;
    companyParams.push(term, term, term);

    contactQuery += ' AND (firstName LIKE ? OR lastName LIKE ? OR email LIKE ? OR title LIKE ?)';
    contactParams.push(term, term, term, term);
  }

  if (filter.status) {
    companyQuery += ' AND status = ?';
    companyParams.push(filter.status);

    contactQuery += ' AND status = ?';
    contactParams.push(filter.status);
  }

  if (filter.industry) {
    companyQuery += ' AND industry LIKE ?';
    companyParams.push(`%${filter.industry}%`);
    hasCompanyFilter = true;
  }

  if (filter.city) {
    companyQuery += ' AND (city LIKE ? OR location LIKE ?)';
    companyParams.push(`%${filter.city}%`, `%${filter.city}%`);
    hasCompanyFilter = true;
  }

  if (filter.state) {
    companyQuery += ' AND (state LIKE ? OR location LIKE ?)';
    companyParams.push(`%${filter.state}%`, `%${filter.state}%`);
    hasCompanyFilter = true;
  }

  if (filter.country) {
    companyQuery += ' AND (country LIKE ? OR location LIKE ?)';
    companyParams.push(`%${filter.country}%`, `%${filter.country}%`);
    hasCompanyFilter = true;
  }

  if (filter.location) {
    companyQuery += ' AND location LIKE ?';
    companyParams.push(`%${filter.location}%`);
    hasCompanyFilter = true;
  }

  if (filter.companyId) {
    companyQuery += ' AND id = ?';
    companyParams.push(filter.companyId);
    contactQuery += ' AND companyId = ?';
    contactParams.push(filter.companyId);
    hasCompanyFilter = true;
  }

  if (filter.discoveryRunId) {
    companyQuery +=
      ' AND id IN (SELECT companyId FROM company_discovery_runs WHERE workspaceId = ? AND discoveryRunId = ?)';
    companyParams.push(workspaceId, filter.discoveryRunId);

    contactQuery +=
      ' AND companyId IN (SELECT companyId FROM company_discovery_runs WHERE workspaceId = ? AND discoveryRunId = ?)';
    contactParams.push(workspaceId, filter.discoveryRunId);
    hasCompanyFilter = true;
  }

  if (filter.contactedStatus === 'never') {
    contactQuery += ` AND id NOT IN (
      SELECT DISTINCT contactId FROM email_deliveries 
      WHERE workspaceId = ? AND status = 'SENT'
    )`;
    contactParams.push(workspaceId);
  } else if (filter.contactedStatus === 'contacted') {
    contactQuery += ` AND id IN (
      SELECT DISTINCT contactId FROM email_deliveries 
      WHERE workspaceId = ? AND status = 'SENT'
    )`;
    contactParams.push(workspaceId);
  }

  const companyRows = db.prepare(companyQuery).all(...companyParams) as Array<{ id: string }>;
  const companyIds = companyRows.map((r) => r.id);

  if (hasCompanyFilter && !filter.discoveryRunId && !filter.companyId) {
    if (companyIds.length === 0) {
      return { contactIds: [], companyIds: [] };
    }
    contactQuery += ` AND companyId IN (${companyIds.map(() => '?').join(', ')})`;
    contactParams.push(...companyIds);
  }

  const contactRows = db.prepare(contactQuery).all(...contactParams) as Array<{ id: string }>;
  const contactIds = contactRows.map((r) => r.id);

  return { contactIds, companyIds };
}

export function registerAudiencesIpc() {
  safeRegister('audiences:list', async (_event, payload) => {
    const workspaceId = payload?.workspaceId || WorkspaceManager.getActiveRuntime()?.workspaceId;
    if (!workspaceId) return [];
    const runtime = await WorkspaceManager.getOrAwaitActiveRuntime(workspaceId);
    if (!runtime) return [];

    const connState = ConnectivityService.getState();
    if (connState.status === 'ONLINE') {
      try {
        await ProjectionService.reconcileEntity(workspaceId, 'audiences', runtime.sdk, false);
      } catch (err) {
        // Fallback to SQLite cache if network/API is temporarily unavailable
      }
    }

    const audiences = await LocalCRMRepository.findMany('audiences', workspaceId);

    return audiences.map((audience) => {
      let filterDef = audience.filterDefinition;
      if (typeof filterDef === 'string') {
        try {
          filterDef = JSON.parse(filterDef);
        } catch {
          filterDef = {};
        }
      }
      let staticIds = audience.staticMemberIds;
      if (typeof staticIds === 'string') {
        try {
          staticIds = JSON.parse(staticIds);
        } catch {
          staticIds = [];
        }
      }
      const { contactIds, companyIds } = resolveAudienceLocally(
        workspaceId,
        filterDef,
        audience.mode,
        staticIds
      );
      return {
        ...audience,
        mode: audience.mode || (Array.isArray(staticIds) && staticIds.length > 0 ? 'static' : 'dynamic'),
        staticMemberIds: staticIds || [],
        contactCount: contactIds.length,
        companyCount: companyIds.length
      };
    });
  });

  safeRegister('audiences:create', async (_event, record) => {
    if (!record.workspaceId) throw new Error('workspaceId is required.');
    if (!record.name) throw new Error('name is required.');
    const payload = {
      ...record,
      mode: record.mode || (Array.isArray(record.staticMemberIds) && record.staticMemberIds.length > 0 ? 'static' : 'dynamic'),
      filterDefinition: record.filterDefinition || {},
      staticMemberIds: record.staticMemberIds || []
    };
    const sdk = WorkspaceManager.getSdk();
    const created = await sdk.audiences.create(payload);
    await LocalCRMRepository.saveFromServer('audiences', created);
    ProjectionService.broadcastProjectionUpdated('audiences', record.workspaceId);
    return created;
  });

  safeRegister('audiences:get', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');
    const audience = await LocalCRMRepository.findById('audiences', workspaceId, id);
    if (!audience) return null;

    let filterDef = audience.filterDefinition;
    if (typeof filterDef === 'string') {
      try {
        filterDef = JSON.parse(filterDef);
      } catch {
        filterDef = {};
      }
    }
    let staticIds = audience.staticMemberIds;
    if (typeof staticIds === 'string') {
      try {
        staticIds = JSON.parse(staticIds);
      } catch {
        staticIds = [];
      }
    }
    const { contactIds, companyIds } = resolveAudienceLocally(
      workspaceId,
      filterDef,
      audience.mode,
      staticIds
    );
    return {
      ...audience,
      mode: audience.mode || (Array.isArray(staticIds) && staticIds.length > 0 ? 'static' : 'dynamic'),
      staticMemberIds: staticIds || [],
      contactCount: contactIds.length,
      companyCount: companyIds.length,
      resolvedContactIds: contactIds,
      resolvedCompanyIds: companyIds
    };
  });

  safeRegister('audiences:update', async (_event, { id, dto }) => {
    if (!dto.workspaceId) throw new Error('workspaceId is required.');
    const sdk = WorkspaceManager.getSdk();
    const updated = await sdk.audiences.update(id, dto);
    await LocalCRMRepository.saveFromServer('audiences', updated);
    ProjectionService.broadcastProjectionUpdated('audiences', dto.workspaceId);
    return updated;
  });

  safeRegister('audiences:delete', async (_event, { workspaceId, id }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    if (!id) throw new Error('id is required.');
    const sdk = WorkspaceManager.getSdk();
    await sdk.audiences.delete(id);
    await LocalCRMRepository.softDeleteFromServer('audiences', workspaceId, id);
    ProjectionService.broadcastProjectionUpdated('audiences', workspaceId);
    return { success: true };
  });

  safeRegister('audiences:resolve', async (_event, { workspaceId, id, filterDefinition, mode, staticMemberIds }) => {
    if (!workspaceId) throw new Error('workspaceId is required.');
    let filterDef = filterDefinition;
    let audMode = mode;
    let staticIds = staticMemberIds;

    if (id && !filterDef && !staticIds) {
      const audience = await LocalCRMRepository.findById('audiences', workspaceId, id);
      if (audience) {
        audMode = audience.mode;
        staticIds = audience.staticMemberIds;
        filterDef = typeof audience.filterDefinition === 'string'
          ? JSON.parse(audience.filterDefinition)
          : audience.filterDefinition;
      }
    }
    return resolveAudienceLocally(workspaceId, filterDef || {}, audMode, staticIds);
  });
}

