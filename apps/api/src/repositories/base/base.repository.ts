import { type Model, type Document, type ClientSession } from 'mongoose';
import { generateEntityId } from '@huntara/schema';
import {
  NotFoundError,
  ConflictError,
  ValidationError,
  DatabaseError
} from '../../errors/index.js';

type FilterQuery<T> = any;

export class BaseRepository<T extends Document<any>> {
  constructor(
    protected model: Model<T>,
    protected workspaceId?: string
  ) {}



  /**
   * Translates mongoose exceptions to domain errors.
   */
  protected handleError(error: any): never {
    if (error.name === 'ValidationError') {
      throw new ValidationError(error.message, error.errors);
    }
    if (error.code === 11000) {
      throw new ConflictError(
        'A record with this unique constraint already exists.',
        error.keyValue
      );
    }
    if (error.name === 'CastError') {
      throw new NotFoundError(`Resource not found.`);
    }
    throw new DatabaseError(error.message || 'Database operation failed', error);
  }

  /**
   * Helper to merge workspace filter into queries.
   */
  protected applyScope(filter: FilterQuery<T> = {}): FilterQuery<T> {
    if (this.workspaceId) {
      return { ...filter, workspaceId: this.workspaceId } as FilterQuery<T>;
    }
    return filter;
  }

  public async findById(id: string, session?: ClientSession): Promise<T> {
    try {
      const filter = this.applyScope({ _id: id } as any);
      const doc = await this.model.findOne(filter).session(session || null);
      if (!doc) {
        throw new NotFoundError(`Resource with id ${id} not found.`);
      }
      return doc;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      this.handleError(error);
    }
  }

  public async findOne(filter: FilterQuery<T>, session?: ClientSession): Promise<T | null> {
    try {
      const scopedFilter = this.applyScope(filter);
      return await this.model.findOne(scopedFilter).session(session || null);
    } catch (error) {
      this.handleError(error);
    }
  }

  public async findMany(
    filter: FilterQuery<T> = {},
    options: { sort?: any; limit?: number; skip?: number; projection?: any } = {},
    session?: ClientSession
  ): Promise<T[]> {
    try {
      const scopedFilter = this.applyScope(filter);
      let query: any = this.model.find(scopedFilter).session(session || null);
      if (options.projection) query = query.select(options.projection);
      if (options.sort) query = query.sort(options.sort);
      if (options.skip) query = query.skip(options.skip);
      if (options.limit) query = query.limit(options.limit);
      return (await query) as T[];
    } catch (error) {
      this.handleError(error);
    }
  }

  public async create(data: Partial<T> | any, session?: ClientSession): Promise<T> {
    try {
      const payload = this.workspaceId ? { ...data, workspaceId: this.workspaceId } : { ...data };
      if (!payload._id) {
        payload._id = payload.id || generateEntityId();
      }
      const doc = new this.model(payload);

      const saveOptions = session ? { session } : {};
      await doc.save(saveOptions);
      return doc;
    } catch (error) {
      this.handleError(error);
    }
  }

  public async createMany(
    items: (Partial<T> | any)[],
    session?: ClientSession
  ): Promise<T[]> {
    try {
      const payloads = items.map((item) => {
        const payload = this.workspaceId ? { ...item, workspaceId: this.workspaceId } : { ...item };
        if (!payload._id) {
          payload._id = payload.id || generateEntityId();
        }
        return payload;
      });

      const options = session ? { session } : {};
      const docs = await this.model.insertMany(payloads, options);
      return docs as unknown as T[];
    } catch (error) {
      this.handleError(error);
    }
  }

  public async update(
    id: string,
    updateData: Partial<T> | any,
    session?: ClientSession
  ): Promise<T> {
    try {
      const filter = this.applyScope({ _id: id } as any);
      // ID Override Safety: callers cannot change document identity
      const sanitizedUpdate = { ...updateData };
      delete sanitizedUpdate._id;
      delete sanitizedUpdate.id;

      const options: any = { returnDocument: 'after', runValidators: true };
      if (session) {
        options.session = session;
      }

      const doc = (await this.model.findOneAndUpdate(
        filter,
        { $set: sanitizedUpdate },
        options
      )) as unknown as T | null;

      if (!doc) {
        throw new NotFoundError(`Resource with id ${id} not found.`);
      }
      return doc;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      this.handleError(error);
    }
  }

  public async delete(id: string, session?: ClientSession): Promise<boolean> {
    try {
      const filter = this.applyScope({ _id: id } as any);
      const doc = await this.model.findOne(filter).session(session || null);
      if (!doc) {
        throw new NotFoundError(`Resource with id ${id} not found.`);
      }

      if (typeof (doc as any).softDelete === 'function') {
        await (doc as any).softDelete();
        return true;
      }

      const result = await this.model.deleteOne({ _id: id } as any).session(session || null);
      return result.deletedCount > 0;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      this.handleError(error);
    }
  }

  public async paginate(
    filter: FilterQuery<T> = {},
    page = 1,
    limit = 20,
    sort: any = { createdAt: -1, _id: 1 }
  ): Promise<{ data: T[]; total: number }> {
    try {
      const scopedFilter = this.applyScope(filter);
      const skip = (page - 1) * limit;

      const [data, total] = await Promise.all([
        this.model.find(scopedFilter).sort(sort).skip(skip).limit(limit),
        this.model.countDocuments(scopedFilter)
      ]);

      return { data, total };
    } catch (error) {
      this.handleError(error);
    }
  }

  public async exists(filter: FilterQuery<T>): Promise<boolean> {
    try {
      const scopedFilter = this.applyScope(filter);
      const count = await this.model.countDocuments(scopedFilter);
      return count > 0;
    } catch (error) {
      this.handleError(error);
    }
  }

  public async count(filter: FilterQuery<T> = {}): Promise<number> {
    try {
      const scopedFilter = this.applyScope(filter);
      return await this.model.countDocuments(scopedFilter);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Performs an atomic findOneAndUpdate operation respecting workspace scoping.
   */
  public async atomicFindOneAndUpdate(
    filter: FilterQuery<T>,
    update: any,
    options: any = {}
  ): Promise<T | null> {
    try {
      const scopedFilter = this.applyScope(filter);
      let sanitizedUpdate: any;
      if (Array.isArray(update)) {
        sanitizedUpdate = update.map((stage: any) => {
          if (stage && typeof stage === 'object' && stage.$set) {
            const copy = { ...stage, $set: { ...stage.$set } };
            delete copy.$set._id;
            delete copy.$set.id;
            delete copy.$set.workspaceId;
            return copy;
          }
          return stage;
        });
      } else {
        sanitizedUpdate = { ...update };
        if (sanitizedUpdate.$set) {
          delete sanitizedUpdate.$set._id;
          delete sanitizedUpdate.$set.id;
          delete sanitizedUpdate.$set.workspaceId;
        }
      }

      return (await this.model.findOneAndUpdate(scopedFilter, sanitizedUpdate, {
        returnDocument: 'after',
        runValidators: !Array.isArray(update),
        ...(Array.isArray(update) ? { updatePipeline: true } : {}),
        ...options
      })) as unknown as T | null;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * High-throughput native MongoDB bulkUpsert using bulkWrite with ordered: false.
   */
  public async bulkUpsert(
    items: (Partial<T> | any)[],
    matchFields: string[] = ['_id']
  ): Promise<{
    success: boolean;
    totalRequested: number;
    inserted: number;
    updated: number;
    failed: number;
    errors: { index: number; id?: string; error: string }[];
  }> {
    if (!items || items.length === 0) {
      return { success: true, totalRequested: 0, inserted: 0, updated: 0, failed: 0, errors: [] };
    }

    const errors: { index: number; id?: string; error: string }[] = [];
    const operations: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const raw = items[i];
      try {
        const payload = this.workspaceId ? { ...raw, workspaceId: this.workspaceId } : { ...raw };
        if (!payload._id) {
          payload._id = payload.id || generateEntityId();
        }

        const filter: any = {};
        if (this.workspaceId) {
          filter.workspaceId = this.workspaceId;
        }

        for (const field of matchFields) {
          const matchVal = payload[field] || (field === '_id' ? payload.id : undefined);
          if (matchVal !== undefined) {
            filter[field] = matchVal;
          }
        }

        const sanitized = { ...payload };
        delete sanitized.id;

        operations.push({
          updateOne: {
            filter,
            update: { $set: sanitized, $setOnInsert: { createdAt: new Date() } },
            upsert: true
          }
        });
      } catch (err: any) {
        errors.push({ index: i, id: raw?.id || raw?._id, error: err.message || 'Validation failed' });
      }
    }

    if (operations.length === 0) {
      return {
        success: errors.length === 0,
        totalRequested: items.length,
        inserted: 0,
        updated: 0,
        failed: errors.length,
        errors
      };
    }

    try {
      const bulkRes = await this.model.bulkWrite(operations, { ordered: false });
      const inserted = (bulkRes.upsertedCount || 0) + (bulkRes.insertedCount || 0);
      const updated = bulkRes.modifiedCount || 0;

      return {
        success: errors.length === 0,
        totalRequested: items.length,
        inserted,
        updated,
        failed: errors.length,
        errors
      };
    } catch (bulkErr: any) {
      const writeErrors = bulkErr.writeErrors || [];
      for (const wErr of writeErrors) {
        errors.push({
          index: wErr.index,
          id: items[wErr.index]?.id || items[wErr.index]?._id,
          error: wErr.errmsg || 'Bulk write error'
        });
      }

      const inserted = (bulkErr.result?.nUpserted || 0) + (bulkErr.result?.nInserted || 0);
      const updated = bulkErr.result?.nModified || 0;
      const failed = errors.length;

      return {
        success: failed === 0,
        totalRequested: items.length,
        inserted,
        updated,
        failed,
        errors
      };
    }
  }

  /**
   * High-throughput native MongoDB bulkInsert using insertMany.
   */
  public async bulkInsert(
    items: (Partial<T> | any)[]
  ): Promise<{
    success: boolean;
    totalRequested: number;
    inserted: number;
    updated: number;
    failed: number;
    errors: { index: number; id?: string; error: string }[];
    data?: T[];
  }> {
    if (!items || items.length === 0) {
      return { success: true, totalRequested: 0, inserted: 0, updated: 0, failed: 0, errors: [], data: [] };
    }

    const payloads = items.map((raw) => {
      const payload = this.workspaceId ? { ...raw, workspaceId: this.workspaceId } : { ...raw };
      if (!payload._id) {
        payload._id = payload.id || generateEntityId();
      }
      return payload;
    });

    try {
      const docs = await this.model.insertMany(payloads, { ordered: false });
      return {
        success: true,
        totalRequested: items.length,
        inserted: docs.length,
        updated: 0,
        failed: 0,
        errors: [],
        data: docs as unknown as T[]
      };
    } catch (err: any) {
      const errors: { index: number; id?: string; error: string }[] = [];
      const writeErrors = err.writeErrors || [];
      for (const wErr of writeErrors) {
        errors.push({
          index: wErr.index,
          id: items[wErr.index]?.id || items[wErr.index]?._id,
          error: wErr.errmsg || 'Insert error'
        });
      }

      const inserted = err.insertedDocs ? err.insertedDocs.length : 0;
      return {
        success: false,
        totalRequested: items.length,
        inserted,
        updated: 0,
        failed: errors.length || (items.length - inserted),
        errors,
        data: err.insertedDocs as unknown as T[]
      };
    }
  }

  /**
   * Helper to execute operations within a MongoDB transaction session.
   */
  public async withTransaction<R>(
    fn: (session: ClientSession) => Promise<R>
  ): Promise<R> {
    const session = await this.model.db.startSession();
    try {
      let result: R;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result!;
    } finally {
      await session.endSession();
    }
  }
}
