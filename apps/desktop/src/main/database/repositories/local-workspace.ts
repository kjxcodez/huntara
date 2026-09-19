import { getDatabase } from '../connection';
import { type Workspace, workspaceSettingsSchema } from '@huntara/schema';

/**
 * LocalWorkspaceRepository handles local SQLite caching of workspace records.
 */
export const LocalWorkspaceRepository = {
  /**
   * Finds a workspace by ID.
   */
  async findById(id: string): Promise<Workspace | null> {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;
    if (!row) return null;

    let parsedSettings = { defaultTimezone: 'UTC' };
    if (row.settings) {
      try {
        parsedSettings = JSON.parse(row.settings);
      } catch {
        parsedSettings = { defaultTimezone: row.settingsTimezone || 'UTC' };
      }
    }

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerId: row.ownerId,
      plan: row.plan || 'free',
      settings: workspaceSettingsSchema.parse(parsedSettings),
      members: [],
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt)
    };
  },

  /**
   * Lists all cached workspaces.
   */
  async findMany(): Promise<Workspace[]> {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM workspaces').all() as any[];

    return rows.map((row) => {
      let parsedSettings = { defaultTimezone: 'UTC' };
      if (row.settings) {
        try {
          parsedSettings = JSON.parse(row.settings);
        } catch {
          parsedSettings = { defaultTimezone: row.settingsTimezone || 'UTC' };
        }
      }

      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        ownerId: row.ownerId,
        plan: row.plan || 'free',
        settings: workspaceSettingsSchema.parse(parsedSettings),
        members: [],
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt)
      };
    });
  },

  /**
   * Caches a single workspace.
   */
  async save(ws: Workspace): Promise<Workspace> {
    const db = getDatabase();
    db.prepare(
      `
      INSERT OR REPLACE INTO workspaces (id, name, slug, ownerId, plan, settings, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      ws.id,
      ws.name,
      ws.slug,
      ws.ownerId,
      ws.plan || 'free',
      typeof ws.settings === 'object' ? JSON.stringify(ws.settings) : String(ws.settings || '{}'),
      ws.createdAt ? new Date(ws.createdAt).toISOString() : new Date().toISOString(),
      ws.updatedAt ? new Date(ws.updatedAt).toISOString() : new Date().toISOString()
    );

    return ws;
  },

  /**
   * Caches many workspaces inside a transaction.
   */
  async saveMany(workspaces: Workspace[]): Promise<void> {
    const db = getDatabase();
    const insert = db.prepare(`
      INSERT OR REPLACE INTO workspaces (id, name, slug, ownerId, plan, settings, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((list: Workspace[]) => {
      for (const ws of list) {
        insert.run(
          ws.id,
          ws.name,
          ws.slug,
          ws.ownerId,
          ws.plan || 'free',
          typeof ws.settings === 'object' ? JSON.stringify(ws.settings) : String(ws.settings || '{}'),
          ws.createdAt ? new Date(ws.createdAt).toISOString() : new Date().toISOString(),
          ws.updatedAt ? new Date(ws.updatedAt).toISOString() : new Date().toISOString()
        );
      }
    });

    transaction(workspaces);
  },

  /**
   * Deletes a workspace cache entry.
   */
  async delete(id: string): Promise<void> {
    const db = getDatabase();
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }
};
