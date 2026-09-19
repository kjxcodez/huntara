import type { CanonicalContactQuery } from '@huntara/schema';

/**
 * Resolves contact IDs matching a canonical query snapshot minus exclusions.
 * Enforces workspace isolation and SQL injection protection.
 */
export function resolveMatchingContactIds(
  db: any,
  workspaceId: string,
  filterQuery: CanonicalContactQuery,
  excludedIds: string[] = []
): string[] {
  let query = 'SELECT DISTINCT c.id FROM contacts c';
  const params: any[] = [];
  const conditions: string[] = ['c.workspaceId = ?', 'c.deletedAt IS NULL'];
  params.push(workspaceId);

  const hasGeoFilter = Boolean(
    filterQuery.city || filterQuery.state || filterQuery.country || filterQuery.location
  );
  if (hasGeoFilter) {
    query += ' INNER JOIN companies comp ON c.companyId = comp.id AND comp.deletedAt IS NULL';
  }

  if (filterQuery.discoveryRunId) {
    query += ' INNER JOIN company_discovery_runs cdr ON c.companyId = cdr.companyId';
    conditions.push('cdr.discoveryRunId = ?');
    params.push(filterQuery.discoveryRunId);
  }

  if (filterQuery.search) {
    conditions.push(
      '(c.firstName LIKE ? OR c.lastName LIKE ? OR c.email LIKE ? OR c.title LIKE ? OR c.notes LIKE ?)'
    );
    const term = `%${filterQuery.search}%`;
    params.push(term, term, term, term, term);
  }

  if (filterQuery.status) {
    conditions.push('c.status = ?');
    params.push(filterQuery.status);
  }

  if (filterQuery.companyId) {
    conditions.push('c.companyId = ?');
    params.push(filterQuery.companyId);
  }

  if (filterQuery.title) {
    conditions.push('c.title LIKE ?');
    params.push(`%${filterQuery.title}%`);
  }

  if (filterQuery.source) {
    conditions.push('c.source LIKE ?');
    params.push(`%${filterQuery.source}%`);
  }

  if (filterQuery.location) {
    conditions.push('comp.location LIKE ?');
    params.push(`%${filterQuery.location}%`);
  }

  if (filterQuery.city) {
    conditions.push('(comp.city LIKE ? OR comp.location LIKE ?)');
    params.push(`%${filterQuery.city}%`, `%${filterQuery.city}%`);
  }

  if (filterQuery.state) {
    conditions.push('(comp.state LIKE ? OR comp.location LIKE ?)');
    params.push(`%${filterQuery.state}%`, `%${filterQuery.state}%`);
  }

  if (filterQuery.country) {
    conditions.push('(comp.country LIKE ? OR comp.location LIKE ?)');
    params.push(`%${filterQuery.country}%`, `%${filterQuery.country}%`);
  }

  query += ' WHERE ' + conditions.join(' AND ') + ' ORDER BY c.createdAt DESC';

  const rows = db.prepare(query).all(...params) as Array<{ id: string }>;
  const excludedSet = new Set(excludedIds || []);
  return rows.map((r) => r.id).filter((id) => !excludedSet.has(id));
}
