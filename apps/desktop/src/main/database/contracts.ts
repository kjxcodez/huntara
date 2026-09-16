/**
 * Base generic interface for CRUD repository operations.
 */
export interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  findMany(filter?: Partial<T>): Promise<T[]>;
  create(data: T): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string, options?: any): Promise<any>;
}

/**
 * Interface signature for main-process SQLite Local Repositories.
 */
export interface ILocalRepository<T> extends IRepository<T> {
  saveMany(records: T[]): Promise<void>;
  softDelete(id: string): Promise<void>;
}

/**
 * Interface signature for HTTP Remote Repositories wrapping SDK modules.
 */
export interface IRemoteRepository<T> {
  get(id: string): Promise<T>;
  list(filter?: Record<string, any>): Promise<T[]>;
  create(data: Record<string, any>): Promise<T>;
  update(id: string, data: Record<string, any>): Promise<T>;
  delete(id: string, options?: any): Promise<any>;
}

/**
 * Interface signature for UI Data Repositories.
 */
export interface ISyncRepository<T> extends IRepository<T> {
  /**
   * Reads cached local SQLite values.
   */
  listAndSync(workspaceId: string, filter?: Record<string, any>): Promise<T[]>;
}
