import Database from 'better-sqlite3';
import { SuppressionReason, compareSuppressionPrecedence } from '@huntara/schema';

export interface SqliteSuppressionRow {
  id: string;
  workspaceId: string;
  email: string;
  reason: string;
  source: string;
  evidence: string | null;
  suppressedAt: string;
  suppressedBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export class DesktopSuppressionRepository {
  constructor(private readonly db: Database.Database) {}

  public isSuppressed(workspaceId: string, email: string): boolean {
    if (!email) return false;
    const cleanEmail = email.toLowerCase().trim();
    const row = this.db
      .prepare('SELECT 1 FROM suppressions WHERE workspaceId = ? AND email = ? LIMIT 1')
      .get(workspaceId, cleanEmail);
    return Boolean(row);
  }

  public getSuppression(workspaceId: string, email: string): SqliteSuppressionRow | null {
    if (!email) return null;
    const cleanEmail = email.toLowerCase().trim();
    return (
      (this.db
        .prepare('SELECT * FROM suppressions WHERE workspaceId = ? AND email = ?')
        .get(workspaceId, cleanEmail) as SqliteSuppressionRow) || null
    );
  }

  public suppress(
    workspaceId: string,
    email: string,
    reason: SuppressionReason,
    source = 'desktop_system',
    evidence: Record<string, any> | null = null,
    suppressedBy: string | null = null,
    notes: string | null = null
  ): void {
    const cleanEmail = email.toLowerCase().trim();
    const existing = this.getSuppression(workspaceId, cleanEmail);

    const now = new Date().toISOString();
    const evidenceJson = evidence ? JSON.stringify(evidence) : null;

    if (existing) {
      // Precedence check: only upgrade if target reason is stronger
      const comp = compareSuppressionPrecedence(
        reason,
        existing.reason as SuppressionReason
      );
      const targetReason = comp > 0 ? reason : existing.reason;
      const targetSource = comp >= 0 ? source : existing.source;

      this.db
        .prepare(
          `UPDATE suppressions 
           SET reason = ?, source = ?, evidence = ?, notes = COALESCE(?, notes), updatedAt = ?
           WHERE workspaceId = ? AND email = ?`
        )
        .run(targetReason, targetSource, evidenceJson, notes, now, workspaceId, cleanEmail);
      return;
    }

    const id = `sup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.db
      .prepare(
        `INSERT INTO suppressions (id, workspaceId, email, reason, source, evidence, suppressedAt, suppressedBy, notes, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        workspaceId,
        cleanEmail,
        reason,
        source,
        evidenceJson,
        now,
        suppressedBy,
        notes,
        now,
        now
      );
  }

  public unsuppress(workspaceId: string, email: string): boolean {
    const cleanEmail = email.toLowerCase().trim();
    const res = this.db
      .prepare('DELETE FROM suppressions WHERE workspaceId = ? AND email = ?')
      .run(workspaceId, cleanEmail);
    return res.changes > 0;
  }

  public listSuppressions(
    workspaceId: string,
    limit = 50,
    offset = 0
  ): { items: SqliteSuppressionRow[]; total: number } {
    const items = this.db
      .prepare(
        'SELECT * FROM suppressions WHERE workspaceId = ? ORDER BY suppressedAt DESC LIMIT ? OFFSET ?'
      )
      .all(workspaceId, limit, offset) as SqliteSuppressionRow[];

    const totalRow = this.db
      .prepare('SELECT COUNT(*) as count FROM suppressions WHERE workspaceId = ?')
      .get(workspaceId) as { count: number };

    return { items, total: totalRow.count };
  }
}
