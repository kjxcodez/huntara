import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { SdkClient } from '@huntara/sdk';
import type { LocalEventBus, AppEvent, EventType } from '../lib/event-bus';

// ── Trigger type constants ────────────────────────────────────────────────────
// These values must match what is stored in sequences.trigger JSON in SQLite.
// Based on automation_engine_spec.md §5 and the API sequence model.

const TRIGGER_TYPES = {
  COMPANY_CREATED: 'COMPANY_CREATED',
  CONTACT_CREATED: 'CONTACT_CREATED',
  PIPELINE_STAGE_CHANGED: 'PIPELINE_STAGE_CHANGED',
  DISCOVERY_IMPORT_COMPLETED: 'DISCOVERY_IMPORT_COMPLETED',
  EMAIL_SENT: 'EMAIL_SENT',
  EMAIL_REPLIED: 'EMAIL_REPLIED',
  EMAIL_BOUNCED: 'EMAIL_BOUNCED',
  JOB_COMPLETED: 'JOB_COMPLETED',
  JOB_FAILED: 'JOB_FAILED',
  CAMPAIGN_FINISHED: 'CAMPAIGN_FINISHED',
  CRAWLER_FINISHED: 'CRAWLER_FINISHED',
  DISCOVERY_FINISHED: 'DISCOVERY_FINISHED',
  REPLY_RECEIVED: 'REPLY_RECEIVED',
  LEAD_SCORE_CHANGED: 'LEAD_SCORE_CHANGED',
  IMPORT_FINISHED: 'IMPORT_FINISHED',
  UPDATE_INSTALLED: 'UPDATE_INSTALLED',
  WORKSPACE_OPENED: 'WORKSPACE_OPENED',
  SCHEDULE: 'SCHEDULE',
  MANUAL: 'MANUAL'
} as const;

type AutomationTriggerType = (typeof TRIGGER_TYPES)[keyof typeof TRIGGER_TYPES];

function evaluateConditionValue(actual: any, op: string, expected: any): boolean {
  if (Array.isArray(actual)) {
    const valStr = String(expected).toLowerCase();
    if (op === 'contains' || op === '==') {
      return actual.map((v) => String(v).toLowerCase()).includes(valStr);
    }
    return false;
  }

  if (typeof actual === 'string' && actual.startsWith('[') && actual.endsWith(']')) {
    try {
      const parsed = JSON.parse(actual);
      if (Array.isArray(parsed)) {
        return evaluateConditionValue(parsed, op, expected);
      }
    } catch {}
  }

  const actNum = parseFloat(String(actual));
  const expNum = parseFloat(String(expected));

  if (!isNaN(actNum) && !isNaN(expNum)) {
    switch (op) {
      case '==':
        return actNum === expNum;
      case '!=':
        return actNum !== expNum;
      case '>':
        return actNum > expNum;
      case '<':
        return actNum < expNum;
      case '>=':
        return actNum >= expNum;
      case '<=':
        return actNum <= expNum;
    }
  }

  const actStr = String(actual).toLowerCase();
  const expStr = String(expected).toLowerCase();
  switch (op) {
    case '==':
      return actStr === expStr;
    case '!=':
      return actStr !== expStr;
    case 'contains':
      return actStr.includes(expStr);
    case 'startsWith':
      return actStr.startsWith(expStr);
  }
  return false;
}

function loadEntityData(
  db: Database.Database,
  entityId: string,
  entityType: string,
  workspaceId: string
): { contact: Record<string, any>; company: Record<string, any> } {
  let contact: Record<string, any> = {};
  let company: Record<string, any> = {};

  if (entityType === 'contact') {
    const row = db
      .prepare(
        `SELECT id, firstName, lastName, email, phone, title, status, companyId FROM contacts WHERE id = ? AND workspaceId = ? AND deletedAt IS NULL`
      )
      .get(entityId, workspaceId) as any;
    if (row) {
      contact = row;
      if (row.companyId) {
        const compRow = db
          .prepare(
            `SELECT id, name, domain, industry, size FROM companies WHERE id = ? AND workspaceId = ? AND deletedAt IS NULL`
          )
          .get(row.companyId, workspaceId) as any;
        if (compRow) company = compRow;
      }
    }
  } else if (entityType === 'company' || entityType === 'companies') {
    const row = db
      .prepare(
        `SELECT id, name, domain, industry, size FROM companies WHERE id = ? AND workspaceId = ? AND deletedAt IS NULL`
      )
      .get(entityId, workspaceId) as any;
    if (row) company = row;
  }

  return { contact, company };
}

// ── Event → Trigger mapping helper ───────────────────────────────────────────

/**
 * Maps an incoming LocalEventBus event to an AutomationTriggerType.
 * Returns null if the event does not correspond to any trigger type.
 * Spec: automation_engine_spec.md §5
 */
function mapEventToTriggerType(event: AppEvent): AutomationTriggerType | null {
  const { type, payload } = event;
  const entityType: string = payload?.entityType || '';
  const changeType: string = payload?.changeType || '';
  const jobType: string = payload?.type || payload?.jobType || '';

  switch (type) {
    case 'crm:created':
      if (entityType === 'company' || entityType === 'companies') {
        return TRIGGER_TYPES.COMPANY_CREATED;
      }
      if (entityType === 'contact' || entityType === 'contacts') {
        return TRIGGER_TYPES.CONTACT_CREATED;
      }
      return null;

    case 'crm:updated':
      if (
        (entityType === 'contact' || entityType === 'contacts') &&
        (changeType === 'status' ||
          changeType === 'pipelineStage' ||
          changeType === 'pipeline_stage')
      ) {
        return TRIGGER_TYPES.PIPELINE_STAGE_CHANGED;
      }
      if (
        changeType === 'score' ||
        changeType === 'opportunityScore' ||
        changeType === 'overallScore'
      ) {
        return TRIGGER_TYPES.LEAD_SCORE_CHANGED;
      }
      return null;

    case 'crm:deleted':
      return null;

    case 'job:completed':
      if (jobType === 'scraper:maps') {
        return TRIGGER_TYPES.DISCOVERY_FINISHED;
      }
      if (jobType === 'crawler:website') {
        return TRIGGER_TYPES.CRAWLER_FINISHED;
      }
      if (jobType === 'enrich:intelligence') {
        return TRIGGER_TYPES.LEAD_SCORE_CHANGED;
      }
      return TRIGGER_TYPES.JOB_COMPLETED;

    case 'job:failed':
      return TRIGGER_TYPES.JOB_FAILED;

    case 'sync:completed':
      return TRIGGER_TYPES.IMPORT_FINISHED;

    case 'workspace:opened':
      return TRIGGER_TYPES.WORKSPACE_OPENED;

    case 'update:installed':
      return TRIGGER_TYPES.UPDATE_INSTALLED;

    default:
      return null;
  }
}

// ── AutomationTriggerEvaluator ────────────────────────────────────────────────

/**
 * AutomationTriggerEvaluator — TASK-021.
 *
 * Lives in the main process (WorkspaceRuntime). Subscribes to LocalEventBus events,
 * evaluates which active sequences have matching trigger conditions, deduplicates
 * against in-flight jobs and sequence_executions, and queues `automation:workflow`
 * jobs into the SQLite jobs table.
 *
 * Error isolation: one broken sequence evaluation never stops evaluation of others,
 * and evaluation errors never crash WorkspaceRuntime.
 *
 * Spec: automation_engine_spec.md §2.2
 */
export class AutomationTriggerEvaluator {
  /** Stored unsubscribe functions returned by eventBus.subscribe(). */
  private readonly unsubscribers: Array<() => void> = [];

  /**
   * Cached prepared statement for loading active sequences.
   * Re-used on every event to avoid repeated compilation overhead.
   */
  private readonly stmtLoadSequences: Database.Statement;

  /**
   * Cached prepared statement for checking existing running/waiting executions.
   */
  private readonly stmtCheckExistingExecution: Database.Statement;

  /**
   * Cached prepared statement for inserting a new automation workflow job.
   */
  constructor(
    private readonly workspaceId: string,
    private readonly db: Database.Database,
    private readonly eventBus: LocalEventBus,
    private readonly sdk?: SdkClient
  ) {
    // Pre-compile all prepared statements once — never re-compiled on every event.
    this.stmtLoadSequences = this.db.prepare(`
      SELECT id, trigger, steps
      FROM sequences
      WHERE workspaceId = ?
        AND status = 'active'
        AND deletedAt IS NULL
    `);

    this.stmtCheckExistingExecution = this.db.prepare(`
      SELECT id FROM sequence_executions
      WHERE workspaceId = ?
        AND sequenceId = ?
        AND (contactId = ? OR companyId = ?)
        AND status IN ('running', 'waiting')
      LIMIT 1
    `);
  }

  public get isRunning(): boolean {
    return this.unsubscribers.length > 0;
  }

  /**
   * Starts the evaluator: registers all EventBus subscriptions.
   * Must be called from WorkspaceRuntime.start() before scheduler starts.
   */
  public start(): void {
    // All automation-relevant events from the EventType union
    const eventsToSubscribe: EventType[] = [
      'crm:created',
      'crm:updated',
      'crm:deleted',
      'job:completed',
      'job:failed',
      'job:cancelled',
      'job:paused',
      'job:resumed',
      'job:heartbeat:timeout',
      'automation:triggered',
      'sync:completed',
      'workspace:opened',
      'update:installed'
    ];

    for (const eventType of eventsToSubscribe) {
      const unsub = this.eventBus.subscribe(eventType, (event) => this.onEvent(event));
      this.unsubscribers.push(unsub);
    }

    console.log(
      `[AutomationTriggerEvaluator] Started — subscribed to ${eventsToSubscribe.length} event types for workspace: ${this.workspaceId}`
    );
  }

  /**
   * Stops the evaluator: unregisters all EventBus subscriptions and releases resources.
   * Must be called from WorkspaceRuntime.stop() before eventBus.clear().
   */
  public stop(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch (err) {
        console.error('[AutomationTriggerEvaluator] Error unsubscribing listener:', err);
      }
    }
    this.unsubscribers.length = 0;
    console.log(
      `[AutomationTriggerEvaluator] Stopped — all listeners unregistered for workspace: ${this.workspaceId}`
    );
  }

  // ── Event handler ─────────────────────────────────────────────────────────

  /**
   * Top-level event handler — called by LocalEventBus for every subscribed event.
   * Wrapped in try/catch to prevent crashes in WorkspaceRuntime.
   */
  private onEvent(event: AppEvent): void {
    // Guard: only evaluate events for this workspace
    if (event.workspaceId !== this.workspaceId) {
      return;
    }

    console.log(
      `[AutomationTriggerEvaluator] Event received: ${event.type} for workspace: ${this.workspaceId}`
    );

    try {
      this.evaluate(event);
    } catch (err) {
      console.error(
        `[AutomationTriggerEvaluator] Unhandled error evaluating event "${event.type}":`,
        err
      );
    }
  }

  // ── Evaluation engine ─────────────────────────────────────────────────────

  /**
   * Core trigger evaluation logic.
   *
   * 1. Map event to AutomationTriggerType.
   * 2. Load all active sequences for this workspace.
   * 3. Filter sequences whose trigger.type matches.
   * 4. For each match: check duplicates, then insert job.
   */
  private evaluate(event: AppEvent): void {
    const triggerType = mapEventToTriggerType(event);
    if (!triggerType) {
      // Event does not map to any trigger — skip silently
      return;
    }

    const entityId: string = event.payload?.entityId || event.payload?.id || '';
    const entityType: string = event.payload?.entityType || '';

    console.log(
      `[AutomationTriggerEvaluator] Evaluating trigger type "${triggerType}" for entity "${entityId}" (${entityType})`
    );

    // Load all active sequences for this workspace
    const sequences = this.stmtLoadSequences.all(this.workspaceId) as Array<{
      id: string;
      trigger: string;
      steps: string;
    }>;

    if (sequences.length === 0) {
      return;
    }

    for (const seq of sequences) {
      // Each sequence is evaluated independently to prevent one failure from blocking others
      try {
        this.evaluateSequence(seq, triggerType, entityId, entityType, event);
      } catch (seqErr) {
        console.error(
          `[AutomationTriggerEvaluator] Error evaluating sequence "${seq.id}":`,
          seqErr
        );
        // Continue to next sequence — error isolation
      }
    }
  }

  /**
   * Evaluates a single sequence against the resolved trigger type.
   * Checks trigger match, then deduplicates, then inserts job.
   */
  private evaluateSequence(
    seq: { id: string; trigger: string; steps: string },
    triggerType: AutomationTriggerType,
    entityId: string,
    entityType: string,
    sourceEvent: AppEvent
  ): void {
    // Parse the sequence trigger JSON
    let triggerConfig: Record<string, any>;
    try {
      triggerConfig = JSON.parse(seq.trigger || '{}');
    } catch {
      console.error(
        `[AutomationTriggerEvaluator] Sequence "${seq.id}" has invalid trigger JSON — skipping.`
      );
      return;
    }

    // Check if this sequence's trigger type matches the resolved trigger type
    if (triggerConfig.type !== triggerType) {
      return; // Not a match — skip silently
    }

    console.log(
      `[AutomationTriggerEvaluator] Sequence "${seq.id}" matched trigger "${triggerType}"`
    );

    // Evaluate trigger conditions if present
    const conditions = triggerConfig.conditions || [];
    if (conditions.length > 0) {
      const { contact, company } = loadEntityData(this.db, entityId, entityType, this.workspaceId);
      const intel = this.db
        .prepare('SELECT * FROM company_intelligence WHERE companyId = ?')
        .get(company.id || entityId) as any;
      const scoreRow = this.db
        .prepare('SELECT * FROM opportunity_scores WHERE companyId = ?')
        .get(company.id || entityId) as any;

      for (const cond of conditions) {
        const field = cond.field;
        const op = cond.op || '==';
        const expected = cond.value;
        let actual: any = undefined;

        if (field === 'leadScore' || field === 'score') {
          actual = scoreRow?.overallScore;
        } else if (field === 'intentScore') {
          actual = scoreRow?.intentScore;
        } else if (field === 'industry') {
          actual = company?.industry;
        } else if (field === 'location') {
          actual = company?.location;
        } else if (field === 'technology' || field === 'techStack') {
          actual = intel?.techStack;
        } else if (field === 'companySize' || field === 'size') {
          actual = company?.size;
        } else if (field === 'emailExists') {
          actual = contact?.email ? 'true' : 'false';
        }

        if (actual !== undefined) {
          const matched = evaluateConditionValue(actual, op, expected);
          if (!matched) {
            console.log(
              `[AutomationTriggerEvaluator] Condition failed: ${field} (${actual}) ${op} ${expected} for sequence ${seq.id}`
            );
            return; // Exit early: condition not met!
          }
        }
      }
    }

    // ── Duplicate prevention ─────────────────────────────────────────────────
    // Check: Is there already a running/waiting sequence_execution for this sequence+entity?
    const existingExecution = this.stmtCheckExistingExecution.get(
      this.workspaceId,
      seq.id,
      entityId,
      entityId
    ) as { id: string } | undefined;

    if (existingExecution) {
      console.log(
        `[AutomationTriggerEvaluator] Duplicate prevented — active execution "${existingExecution.id}" already exists for sequence "${seq.id}" + entity "${entityId}"`
      );
      return;
    }

    // ── Job insertion via MongoDB SDK ─────────────────────────────────────────

    const jobId = randomUUID();
    const payload = {
      sequenceId: seq.id,
      entityId,
      entityType,
      triggerType,
      triggerPayload: sourceEvent.payload,
      workspaceId: this.workspaceId
    };

    if (this.sdk) {
      this.sdk.jobs
        .create({
          id: jobId,
          type: 'automation:workflow',
          priority: 3,
          payload,
          maxRetries: 3
        })
        .catch((err: any) => {
          console.warn('[AutomationTriggerEvaluator] Job queueing error:', err);
        });
    }

    console.log(
      `[AutomationTriggerEvaluator] Workflow job "${jobId}" queued for sequence "${seq.id}" + entity "${entityId}"`
    );

    // ── Publish automation:triggered ──────────────────────────────────────────
    this.eventBus.publish('automation:triggered', {
      sequenceId: seq.id,
      jobId,
      entityId,
      entityType,
      triggerType,
      workspaceId: this.workspaceId
    });
  }
}
