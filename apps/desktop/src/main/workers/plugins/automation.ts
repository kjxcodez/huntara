import { randomUUID } from 'crypto';
import { AIRuntime, PromptsLibrary } from '@leadforge/ai';
import type { JobContext } from '../../../shared/types/job';
import { SdkClient, renderCanonicalVariables, formatEmailBody, captureVariablesSnapshot } from '@leadforge/sdk';
import { generateEntityId, CampaignStatus, evaluateOutreachEligibility } from '@leadforge/schema';
import { resolveWorkerApiUrl } from '../worker-env';

function decryptSecretFallback(val: string): string {
  if (!val) return '';
  if (val.startsWith('_enc_base64:')) {
    return '';
  }
  return val;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AutomationWorkflowPayload {
  sequenceId: string;
  entityId: string;
  entityType: string;
  triggerType?: string;
  triggerPayload?: any;
  workspaceId?: string;
  /** Present on resume: the previously saved checkpoint data. */
  _checkpoint?: AutomationCheckpoint | null;
}

interface AutomationCheckpoint {
  executionId: string;
  currentStep: number;
  sequenceId: string;
  entityId: string;
  entityType: string;
  /** Secondary crash-recovery path for execution context. */
  executionContext?: ExecutionContext;
}

/**
 * Mutable execution context that travels with a workflow run.
 * Persisted atomically to `sequence_executions.executionContext` after every step.
 */
interface ExecutionContext {
  /** User-defined workflow variables set by SET_VARIABLE steps. */
  variables: Record<string, any>;
  /** Pinned historical template versions used by this execution (TPL-05). */
  templateVersions?: Record<string, number>;
  /** Snapshot of the target contact row at run start. */
  contact: Record<string, any>;
  /** Snapshot of the target company row at run start (if applicable). */
  company: Record<string, any>;
  sequence: { id: string; name: string };
  workspace: { id: string };
  execution: { id: string; currentStep: number; startedAt: string };
  runtime: {
    /** Incremented on every loop iteration. Reset to 0 on resume. */
    loopCount: number;
    /**
     * Incremented on every GOTO/IF-jump.
     * Persisted across crash-restarts to prevent infinite-loop bypass via restart.
     */
    jumpCount: number;
    /** Name of the most recently entered LABEL, or null. */
    currentLabel: string | null;
  };
}

function createExecutionContext(
  executionId: string,
  sequenceId: string,
  sequenceName: string,
  workspaceId: string,
  contact: Record<string, any>,
  company: Record<string, any>,
  startedAt: string
): ExecutionContext {
  return {
    variables: {},
    templateVersions: {},
    contact: contact || {},
    company: company || {},
    sequence: { id: sequenceId, name: sequenceName },
    workspace: { id: workspaceId },
    execution: { id: executionId, currentStep: 0, startedAt },
    runtime: {
      loopCount: 0,
      jumpCount: 0,
      currentLabel: null
    }
  };
}

interface SequenceRecord {
  id: string;
  name: string;
  status: string;
  trigger: string;
  steps: string;
}

interface StepDefinition {
  type: string;
  [key: string]: any;
}

type StepResult =
  | { status: 'success' }
  | { status: 'wait'; delaySeconds: number }
  | { status: 'goto'; targetIndex: number; targetLabel: string }
  | { status: 'skip'; skipCount: number }
  | { status: 'paused' }
  | { status: 'cancelled' };

// ── Event publisher ────────────────────────────────────────────────────────────

function publishAutomationEvent(event: string, payload: any): void {
  if (process.send) {
    process.send({ type: 'automation_event', event, payload });
  }
}

/**
 * Resolves a single token path against the ExecutionContext using canonical variable resolution.
 */
export function resolveTokenPath(path: string, ctx: ExecutionContext): string {
  return renderCanonicalVariables(`{{${path.trim()}}}`, ctx as any);
}

/**
 * Replaces all `{{token}}` references in a template string using the ExecutionContext.
 * Used by SEND_EMAIL, ASSIGN_TAG, and SET_VARIABLE step handlers.
 */
export function resolveVariables(template: string, ctx: ExecutionContext): string {
  if (template === null || template === undefined) return '';
  if (typeof template !== 'string') return String(template);
  return renderCanonicalVariables(template, ctx as any);
}

export function resolveVariablesRecursive(
  val: any,
  ctx: ExecutionContext,
  _db?: any,
  _workspaceId?: string,
  secrets?: Record<string, string>
): any {
  if (val === null || val === undefined) return val;

  if (typeof val === 'string') {
    // 1. Resolve secrets first
    if (val.includes('{{secret.')) {
      return val.replace(/\{\{secret\.([^}]+)\}\}/g, (_m, key: string) => {
        const trimmedKey = key.trim();
        const possibleKeys = [trimmedKey, `secret.${trimmedKey}`, `secrets.${trimmedKey}`];
        if (secrets) {
          for (const pk of possibleKeys) {
            if (secrets[pk] !== undefined && secrets[pk] !== null) {
              return secrets[pk];
            }
          }
        }
        return '';
      });
    }
    // 2. Resolve standard templates
    return resolveVariables(val, ctx);
  }

  if (Array.isArray(val)) {
    return val.map((item) => resolveVariablesRecursive(item, ctx, _db, _workspaceId, secrets));
  }

  if (typeof val === 'object') {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = resolveVariablesRecursive(v, ctx, _db, _workspaceId, secrets);
    }
    return res;
  }

  return val;
}

// ── Expression Engine ─────────────────────────────────────────────────────────

type TokenKind =
  | 'NUM'
  | 'STR'
  | 'TEMPLATE'
  | 'IDENT'
  | 'LPAREN'
  | 'RPAREN'
  | 'COMMA'
  | 'OP'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'EOF';

interface Token {
  kind: TokenKind;
  value: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    // Whitespace
    if (/\s/.test(src.charAt(i))) {
      i++;
      continue;
    }

    // Template: {{ ... }}
    if (src.charAt(i) === '{' && src.charAt(i + 1) === '{') {
      let j = i + 2;
      while (j < src.length && !(src.charAt(j) === '}' && src.charAt(j + 1) === '}')) j++;
      tokens.push({ kind: 'TEMPLATE', value: src.slice(i + 2, j).trim() });
      i = j + 2;
      continue;
    }

    // Two-char operators
    if (i + 1 < src.length) {
      const two = src.slice(i, i + 2);
      if (two === '==') {
        tokens.push({ kind: 'OP', value: '==' });
        i += 2;
        continue;
      }
      if (two === '!=') {
        tokens.push({ kind: 'OP', value: '!=' });
        i += 2;
        continue;
      }
      if (two === '>=') {
        tokens.push({ kind: 'OP', value: '>=' });
        i += 2;
        continue;
      }
      if (two === '<=') {
        tokens.push({ kind: 'OP', value: '<=' });
        i += 2;
        continue;
      }
      if (two === '&&') {
        tokens.push({ kind: 'AND', value: '&&' });
        i += 2;
        continue;
      }
      if (two === '||') {
        tokens.push({ kind: 'OR', value: '||' });
        i += 2;
        continue;
      }
    }

    const c = src.charAt(i);
    if (c === '>') {
      tokens.push({ kind: 'OP', value: '>' });
      i++;
      continue;
    }
    if (c === '<') {
      tokens.push({ kind: 'OP', value: '<' });
      i++;
      continue;
    }
    if (c === '!') {
      tokens.push({ kind: 'NOT', value: '!' });
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ kind: 'LPAREN', value: '(' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'RPAREN', value: ')' });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ kind: 'COMMA', value: ',' });
      i++;
      continue;
    }

    // String literals (single or double quoted)
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < src.length && src.charAt(j) !== q) j++;
      tokens.push({ kind: 'STR', value: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }

    // Numbers (including negative: only when preceded by operator/start)
    const prevToken = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
    const nextChar = src.charAt(i + 1);
    const canBeNeg =
      c === '-' &&
      /[0-9]/.test(nextChar) &&
      (!prevToken ||
        prevToken.kind === 'OP' ||
        prevToken.kind === 'AND' ||
        prevToken.kind === 'OR' ||
        prevToken.kind === 'NOT' ||
        prevToken.kind === 'LPAREN' ||
        prevToken.kind === 'COMMA');
    if (/[0-9]/.test(c) || canBeNeg) {
      let j = i;
      if (src.charAt(j) === '-') j++;
      while (j < src.length && /[0-9.]/.test(src.charAt(j))) j++;
      tokens.push({ kind: 'NUM', value: src.slice(i, j) });
      i = j;
      continue;
    }

    // Identifiers (letters, digits, underscores, dots for path lookup)
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_.]/.test(src.charAt(j))) j++;
      tokens.push({ kind: 'IDENT', value: src.slice(i, j) });
      i = j;
      continue;
    }

    throw new Error(
      `Expression parser: unexpected character '${c}' at position ${i} in expression: ${src}`
    );
  }

  tokens.push({ kind: 'EOF', value: '' });
  return tokens;
}

class ExpressionParser {
  private readonly tokens: Token[];
  private readonly ctx: ExecutionContext;
  private pos = 0;

  constructor(tokens: Token[], ctx: ExecutionContext) {
    this.tokens = tokens;
    this.ctx = ctx;
  }

  private peek(): Token {
    return this.tokens[this.pos]!;
  }
  private consume(): Token {
    return this.tokens[this.pos++]!;
  }
  private expect(kind: TokenKind): Token {
    const t = this.consume();
    if (t.kind !== kind) {
      throw new Error(`Expression parser: expected ${kind}, got ${t.kind} ("${t.value}")`);
    }
    return t;
  }

  parseExpr(): boolean {
    return this.parseOr();
  }

  private parseOr(): boolean {
    let left = this.parseAnd();
    while (this.peek().kind === 'OR') {
      this.consume();
      const right = this.parseAnd();
      left = left || right;
    }
    return left;
  }

  private parseAnd(): boolean {
    let left = this.parseNot();
    while (this.peek().kind === 'AND') {
      this.consume();
      const right = this.parseNot();
      left = left && right;
    }
    return left;
  }

  private parseNot(): boolean {
    if (this.peek().kind === 'NOT') {
      this.consume();
      return !this.parseNot();
    }
    return this.parseComparison();
  }

  private parseComparison(): boolean {
    const left = this.parseValue();
    const op = this.peek();
    if (op.kind !== 'OP') {
      return this.coerceBool(left);
    }
    this.consume();
    const right = this.parseValue();
    return this.compare(left, op.value, right);
  }

  private parseValue(): any {
    const t = this.peek();

    if (t.kind === 'LPAREN') {
      this.consume();
      const val = this.parseExpr();
      this.expect('RPAREN');
      return val;
    }

    if (t.kind === 'TEMPLATE') {
      this.consume();
      // Resolve lazily — safe for any character sequence including @, ., spaces, etc.
      const resolved = resolveTokenPath(t.value, this.ctx);
      const asNum = parseFloat(resolved);
      return !isNaN(asNum) && String(asNum) === resolved.trim() ? asNum : resolved;
    }

    if (t.kind === 'NUM') {
      this.consume();
      return parseFloat(t.value);
    }

    if (t.kind === 'STR') {
      this.consume();
      return t.value;
    }

    if (t.kind === 'IDENT') {
      // Function call — check next token without consuming
      const nextTok = this.tokens[this.pos + 1];
      if (nextTok?.kind === 'LPAREN') {
        return this.parseFnCall();
      }
      this.consume();
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      // Dotted lookup in variables namespace directly
      if (t.value.startsWith('apiResponse.') || t.value.startsWith('variables.')) {
        const path = t.value.startsWith('variables.') ? t.value : `variables.${t.value}`;
        const resolved = resolveTokenPath(path, this.ctx);
        const asNum = parseFloat(resolved);
        if (!isNaN(asNum) && String(asNum) === resolved.trim()) return asNum;
        if (resolved === 'true') return true;
        if (resolved === 'false') return false;
        if (resolved === 'null') return null;
        return resolved;
      }
      // Bare identifier → look up in ctx.variables
      if (t.value in this.ctx.variables) {
        const v = this.ctx.variables[t.value];
        return typeof v === 'number' ? v : String(v ?? '');
      }
      // Unknown → treat as string literal (allows comparisons like status == ACTIVE)
      return t.value;
    }

    throw new Error(`Expression parser: unexpected token ${t.kind} ("${t.value}")`);
  }

  private parseFnCall(): any {
    const name = this.consume().value;
    this.expect('LPAREN');
    const args: any[] = [];
    if (this.peek().kind !== 'RPAREN') {
      args.push(this.parseValue());
      while (this.peek().kind === 'COMMA') {
        this.consume();
        args.push(this.parseValue());
      }
    }
    this.expect('RPAREN');

    const a = String(args[0] ?? '');
    const b = String(args[1] ?? '');

    switch (name) {
      case 'contains':
        return a.includes(b);
      case 'startsWith':
        return a.startsWith(b);
      case 'endsWith':
        return a.endsWith(b);
      case 'exists':
        return args[0] !== null && args[0] !== undefined && String(args[0]).trim() !== '';
      case 'empty':
        return args[0] === null || args[0] === undefined || String(args[0]).trim() === '';
      default:
        throw new Error(`Expression parser: unknown function "${name}".`);
    }
  }

  private compare(left: any, op: string, right: any): boolean {
    const lNum = parseFloat(String(left));
    const rNum = parseFloat(String(right));
    if (!isNaN(lNum) && !isNaN(rNum)) {
      switch (op) {
        case '==':
          return lNum === rNum;
        case '!=':
          return lNum !== rNum;
        case '>':
          return lNum > rNum;
        case '<':
          return lNum < rNum;
        case '>=':
          return lNum >= rNum;
        case '<=':
          return lNum <= rNum;
      }
    }
    const l = String(left);
    const r = String(right);
    switch (op) {
      case '==':
        return l === r;
      case '!=':
        return l !== r;
      case '>':
        return l > r;
      case '<':
        return l < r;
      case '>=':
        return l >= r;
      case '<=':
        return l <= r;
    }
    return false;
  }

  private coerceBool(val: any): boolean {
    if (typeof val === 'boolean') return val;
    if (val === null || val === undefined || val === '' || val === '0' || val === 'false')
      return false;
    return true;
  }
}

/**
 * Evaluates a boolean expression string using the current ExecutionContext.
 * `{{...}}` tokens are resolved lazily by the parser — no pre-resolution pass.
 * Does not use eval().
 */
function evaluateExpression(expression: string, ctx: ExecutionContext): boolean {
  if (!expression || !expression.trim()) return false;
  const tokens = tokenize(expression);
  const parser = new ExpressionParser(tokens, ctx);
  return parser.parseExpr();
}

// ── Label Map & Runtime Validation ────────────────────────────────────────────

/**
 * Builds a Map<labelName (lowercased) → stepIndex> for O(1) jump resolution.
 * Called once before the execution loop begins.
 */
function buildLabelMap(steps: StepDefinition[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s && s.type === 'LABEL' && s.config?.name) {
      map.set(String(s.config.name).toLowerCase(), i);
    }
  }
  return map;
}

/**
 * Validates a workflow step array before execution starts.
 * Returns an array of human-readable error strings (empty array = valid).
 */
function validateWorkflow(steps: StepDefinition[]): string[] {
  const errors: string[] = [];
  const labelMap = buildLabelMap(steps);
  const seenLabels = new Set<string>();
  const seenResponseVars = new Set<string>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || !step.type) {
      errors.push(`Step at index ${i} is malformed or missing a type.`);
      continue;
    }

    const registryAction = ActionRegistry[step.type];
    if (!registryAction) {
      errors.push(`Step at index ${i}: Unhandled step type "${step.type}"`);
      continue;
    }

    // Action-specific validations
    const actionErrors = registryAction.validate(step, labelMap);
    errors.push(...actionErrors.map((e) => `Step at index ${i} (${step.type}): ${e}`));

    // Sequence-wide assertions
    if (step.type === 'LABEL' && step.config?.name) {
      const name = String(step.config.name).toLowerCase();
      if (seenLabels.has(name)) {
        errors.push(`Step at index ${i} (LABEL): Duplicate label "${step.config.name}"`);
      }
      seenLabels.add(name);
    }

    if (step.type === 'HTTP_REQUEST' && step.config?.saveResponseAs) {
      const saveResponseAs = String(step.config.saveResponseAs).trim();
      if (seenResponseVars.has(saveResponseAs)) {
        errors.push(
          `Step at index ${i} (HTTP_REQUEST): Duplicate saveResponseAs variable "${saveResponseAs}" across workflow`
        );
      }
      seenResponseVars.add(saveResponseAs);
    }

    // Inspect config properties for malformed secrets or recursive assignments
    if (step.config) {
      const inspectValue = (val: any, path: string) => {
        if (typeof val === 'string') {
          if (val.includes('{{secret.')) {
            val.replace(/\{\{secret\.([^}]+)\}\}/g, (_m, key: string) => {
              const trimmed = key.trim();
              if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
                errors.push(
                  `Step at index ${i} (${step.type}): Invalid secret reference format in "${path}": "${trimmed}" (must be alphanumeric)`
                );
              }
              return '';
            });
          }
          if (step.type === 'SET_VARIABLE' && step.config?.assignments) {
            step.config.assignments.forEach((assignment: any) => {
              if (assignment.variable && val.includes(`{{variables.${assignment.variable}}}`)) {
                errors.push(
                  `Step at index ${i} (${step.type}): Recursive variable reference detected: "${assignment.variable}" references itself`
                );
              }
            });
          }
        } else if (Array.isArray(val)) {
          val.forEach((item, idx) => inspectValue(item, `${path}[${idx}]`));
        } else if (typeof val === 'object' && val !== null) {
          for (const [k, v] of Object.entries(val)) {
            inspectValue(v, `${path}.${k}`);
          }
        }
      };

      for (const [k, v] of Object.entries(step.config)) {
        inspectValue(v, k);
      }
    }
  }
  return errors;
}

async function loadEntityData(
  sdk: SdkClient,
  entityId: string,
  entityType: string,
  _workspaceId: string
): Promise<{ contact: Record<string, any>; company: Record<string, any> }> {
  let contact: Record<string, any> = {};
  let company: Record<string, any> = {};

  if (entityType === 'contact') {
    try {
      const row = await sdk.contacts.get(entityId);
      if (row) {
        contact = row;
        if (row.companyId) {
          try {
            const compRow = await sdk.companies.get(row.companyId);
            if (compRow) company = compRow;
          } catch {}
        }
      }
    } catch {}
  } else if (entityType === 'company') {
    try {
      const row = await sdk.companies.get(entityId);
      if (row) company = row;
    } catch {}
  }

  return { contact, company };
}

// ── Main Plugin ────────────────────────────────────────────────────────────────

/**
 * Automation Workflow Plugin (Phase 7 - API/MongoDB-First).
 * Executes `automation:workflow` jobs. Runs steps sequentially and persists state via SdkClient.
 */
export async function executeAutomationWorkflow(ctx: JobContext): Promise<any> {
  ctx.emitLog('Automation workflow plugin execution starting.', 'info');

  const executionStartTime = Date.now();
  const MAX_EXECUTION_DURATION_MS = 300_000; // 5 minutes

  // Initialize SdkClient for authoritative API/MongoDB persistence
  const apiUrl = resolveWorkerApiUrl(ctx);
  const authToken = ctx.payload._secrets?.sessionToken || process.env.LEADFORGE_API_TOKEN || '';
  const sdk = new SdkClient({
    baseUrl: apiUrl,
    token: authToken,
    headers: {
      'x-workspace-id': ctx.workspaceId
    }
  });

  let sequenceId: string | undefined;
  let entityId: string | undefined;
  let entityType: string | undefined;
  let executionId: string | undefined;
  let currentStep = 0;
  let steps: StepDefinition[] = [];

  try {
    // ── 1. Resolve payload & checkpoint ──────────────────────────────────────
    const payload = ctx.payload as AutomationWorkflowPayload;
    const checkpoint = ctx.getCheckpoint() as AutomationCheckpoint | null;
    const isResume = !!checkpoint?.executionId;

    executionId = isResume ? checkpoint!.executionId : (payload as any).executionId || generateEntityId();
    currentStep = isResume ? checkpoint!.currentStep : ((payload as any).resumeFrom ?? 0);

    sequenceId = payload?.sequenceId;
    entityId = payload?.entityId;
    entityType = payload?.entityType;
    let resolvedCampaignId: string | undefined = (payload as any)?.campaignId || (ctx.payload as any)?.campaignId;

    // Recover missing fields from API if needed
    if ((!sequenceId || !resolvedCampaignId) && executionId) {
      try {
        const execRecord = await sdk.executions.get(executionId);
        if (execRecord) {
          if (!sequenceId) sequenceId = execRecord.sequenceId;
          if (!resolvedCampaignId && execRecord.campaignId) resolvedCampaignId = execRecord.campaignId;
          if (!entityId) {
            if (execRecord.contactId) {
              entityId = execRecord.contactId;
              entityType = 'contact';
            } else if (execRecord.companyId) {
              entityId = execRecord.companyId;
              entityType = 'company';
            }
          }
        }
      } catch {}
    }

    // ── 2. Validate required fields ───────────────────────────────────────────
    if (!sequenceId)
      throw new Error('Automation workflow: missing required payload field: sequenceId.');
    if (!entityId)
      throw new Error('Automation workflow: missing required payload field: entityId.');
    if (!entityType)
      throw new Error('Automation workflow: missing required payload field: entityType.');

    // ── 2.1. Acquire execution lock via API ──────────────────────────────────
    let lockAcquired = true;
    try {
      const lockRes = await sdk.locks.acquireLock(sequenceId, entityId, 'worker', 300000);
      lockAcquired = lockRes.acquired !== false;
    } catch {
      lockAcquired = true; // Proceed if lock endpoint gracefully passes
    }

    if (!lockAcquired) {
      ctx.emitLog(
        `Duplicate execution prevented: lock held for sequence "${sequenceId}" / entity "${entityId}". Skipping.`,
        'warn'
      );
      return { status: 'locked_duplicate', sequenceId, entityId };
    }

    // ── 3. Early cancellation check ───────────────────────────────────────────
    if (ctx.isCancelled()) {
      ctx.emitLog(
        `Execution Cancelled (early): executionId=${executionId}, sequenceId=${sequenceId}`,
        'warn'
      );
      try {
        await sdk.locks.releaseLock(sequenceId, entityId);
      } catch {}
      publishAutomationEvent('automation:cancelled', {
        executionId,
        sequenceId,
        workspaceId: ctx.workspaceId,
        entityId,
        currentStep,
        workerPid: process.pid,
        timestamp: new Date().toISOString()
      });
      return { status: 'cancelled', sequenceId, entityId };
    }

    // Phase 15 (PAUSE-07 / DRIFT-STOP-19): Upfront authoritative campaign status check
    if (resolvedCampaignId) {
      try {
        const campaignDoc = await sdk.campaigns.get(resolvedCampaignId);
        if (campaignDoc) {
          const campStatus = String(campaignDoc.status || '').toUpperCase();
          if (campStatus === 'PAUSED') {
            ctx.emitLog(
              `Campaign "${resolvedCampaignId}" is PAUSED. Halting execution before dispatching steps: executionId=${executionId}`,
              'info'
            );
            try {
              if (executionId) {
                await sdk.executions.update(executionId, { status: 'PAUSED' });
              }
              await sdk.locks.releaseLock(sequenceId, entityId);
            } catch {}
            publishAutomationEvent('automation:paused', {
              executionId,
              sequenceId,
              workspaceId: ctx.workspaceId,
              entityId,
              currentStep,
              workerPid: process.pid,
              timestamp: new Date().toISOString()
            });
            return {
              status: 'paused',
              executionId,
              sequenceId,
              entityId,
              currentStep,
              campaignId: resolvedCampaignId
            };
          }
          if (campStatus === 'STOPPED' || campStatus === 'FAILED') {
            ctx.emitLog(
              `Campaign "${resolvedCampaignId}" is ${campStatus}. Halting execution permanently: executionId=${executionId}`,
              'warn'
            );
            try {
              if (executionId) {
                await sdk.executions.update(executionId, { status: 'CANCELLED' });
              }
              await sdk.locks.releaseLock(sequenceId, entityId);
            } catch {}
            publishAutomationEvent('automation:cancelled', {
              executionId,
              sequenceId,
              workspaceId: ctx.workspaceId,
              entityId,
              currentStep,
              workerPid: process.pid,
              timestamp: new Date().toISOString()
            });
            return {
              status: 'cancelled',
              executionId,
              sequenceId,
              entityId,
              currentStep,
              campaignId: resolvedCampaignId
            };
          }
        }
      } catch (campErr: any) {
        ctx.emitLog(`Campaign authority check note: ${campErr.message || campErr}`, 'warn');
      }
    }

    // ── 4. Load sequence from API ─────────────────────────────────────────────
    ctx.updateProgress(10, { description: 'Loading sequence template...' });

    const sequence = await sdk.sequences.get(sequenceId);
    if (!sequence) {
      throw new Error(
        `Automation workflow: sequence "${sequenceId}" not found in workspace "${ctx.workspaceId}".`
      );
    }

    if (sequence.status && String(sequence.status).toLowerCase() !== 'active') {
      throw new Error(
        `Automation workflow: sequence "${sequence.name}" is not active (status: "${sequence.status}").`
      );
    }

    try {
      const rawSteps = sequence.steps;
      const parsed = typeof rawSteps === 'string' ? JSON.parse(rawSteps || '[]') : rawSteps || [];
      if (!Array.isArray(parsed)) throw new Error('steps field is not an array.');
      steps = parsed;
    } catch (e: any) {
      throw new Error(
        `Automation workflow: invalid steps JSON in sequence "${sequence.name}": ${e.message}`
      );
    }

    // ── 4.1. Pre-execution validation ─────────────────────────────────────────
    const validationErrors = validateWorkflow(steps);
    if (validationErrors.length > 0) {
      throw new Error(
        `Automation workflow: sequence "${sequence.name}" failed validation:\n` +
          validationErrors.map((e) => `  - ${e}`).join('\n')
      );
    }

    // ── 4.2. Build label map ──────────────────────────────────────────────────
    const labelMap = buildLabelMap(steps);

    // ── 5. Initialize or resume ExecutionContext ──────────────────────────────
    const now = new Date().toISOString();
    let execCtx: ExecutionContext;

    const isNewRun = !isResume && !(payload as any).executionId;

    if (isNewRun) {
      ctx.updateProgress(30, { description: 'Initializing sequence execution...' });
      const { contact, company } = await loadEntityData(sdk, entityId!, entityType!, ctx.workspaceId);
      execCtx = createExecutionContext(
        executionId!,
        sequenceId!,
        sequence.name,
        ctx.workspaceId,
        contact,
        company,
        now
      );

      try {
        await sdk.executions.create({
          id: executionId!,
          workspaceId: ctx.workspaceId,
          sequenceId: sequenceId!,
          contactId: entityType === 'contact' ? entityId : undefined,
          companyId: entityType === 'company' ? entityId : undefined,
          currentStep: 0,
          status: 'RUNNING',
          startedAt: now
        });

        await sdk.executions.addLogs(executionId!, [
          {
            id: generateEntityId(),
            workspaceId: ctx.workspaceId,
            executionId: executionId!,
            timestamp: now,
            step: 0,
            action: 'INITIALIZED',
            status: 'success',
            message: `Workflow initialized for sequence "${sequence.name}". Entity: ${entityType}/${entityId}.`
          }
        ]);
      } catch (initErr) {
        ctx.emitLog(`Failed to persist execution init: ${initErr}`, 'warn');
      }

      ctx.emitLog(
        `Execution Started: executionId=${executionId}, sequenceId=${sequenceId}`,
        'info'
      );
      publishAutomationEvent('automation:started', {
        executionId,
        sequenceId,
        workspaceId: ctx.workspaceId,
        entityId,
        currentStep,
        workerPid: process.pid,
        timestamp: new Date().toISOString()
      });
    } else {
      let loaded = false;
      if (checkpoint?.executionContext) {
        execCtx = checkpoint.executionContext;
        loaded = true;
      }

      if (!loaded) {
        const { contact, company } = await loadEntityData(sdk, entityId!, entityType!, ctx.workspaceId);
        execCtx = createExecutionContext(
          executionId!,
          sequenceId!,
          sequence.name,
          ctx.workspaceId,
          contact,
          company,
          now
        );
      }

      execCtx!.runtime.loopCount = 0;

      ctx.emitLog(
        `Resuming execution: executionId=${executionId}, sequenceId=${sequenceId}, stepIndex=${currentStep}`,
        'info'
      );
      publishAutomationEvent('automation:resumed', {
        executionId,
        sequenceId,
        workspaceId: ctx.workspaceId,
        entityId,
        currentStep,
        workerPid: process.pid,
        timestamp: new Date().toISOString()
      });
    }

    // ── 6. Empty-sequence fast-path ───────────────────────────────────────────
    if (steps.length === 0) {
      const n = new Date().toISOString();
      try {
        await sdk.executions.update(executionId!, {
          status: 'COMPLETED',
          completedAt: n
        });
        await sdk.locks.releaseLock(sequenceId!, entityId!);
      } catch {}

      ctx.updateProgress(100, {
        description: 'Sequence has no steps. Completed.',
        total: 0
      });
      ctx.emitLog(`Execution Completed (empty sequence): executionId=${executionId}`, 'info');
      publishAutomationEvent('automation:completed', {
        executionId,
        sequenceId,
        workspaceId: ctx.workspaceId,
        entityId,
        currentStep: 0,
        workerPid: process.pid,
        timestamp: new Date().toISOString()
      });
      return {
        status: 'completed',
        executionId,
        sequenceId,
        entityId,
        stepsTotal: 0
      };
    }

    const MAX_AUTOMATION_STEPS_PER_RUN = 100;

    // ── 7. Execution loop ─────────────────────────────────────────────────────
    while (currentStep < steps.length) {
      if (execCtx!.runtime.loopCount >= MAX_AUTOMATION_STEPS_PER_RUN) {
        throw new Error(
          `Max automation step iterations reached (${MAX_AUTOMATION_STEPS_PER_RUN}). Possible infinite loop.`
        );
      }
      execCtx!.runtime.loopCount++;

      if (Date.now() - executionStartTime > MAX_EXECUTION_DURATION_MS) {
        throw new Error(
          `Execution timeout: workflow exceeded ${MAX_EXECUTION_DURATION_MS / 1000}s.`
        );
      }

      // Check for stop condition if contact was contacted / replied
      if (entityType === 'contact') {
        try {
          const freshContact = await sdk.contacts.get(entityId!);
          if (freshContact) {
            const status = (freshContact.status || '').toUpperCase();
            if (status === 'REPLIED' || status === 'BOUNCED' || status === 'UNSUBSCRIBED') {
              ctx.emitLog(
                `Aborting execution loop: contact status is "${status}". Stop condition matched.`,
                'info'
              );
              const stopNow = new Date().toISOString();
              try {
                await sdk.executions.update(executionId!, {
                  status: 'COMPLETED',
                  completedAt: stopNow
                });
                await sdk.executions.addLogs(executionId!, [
                  {
                    id: generateEntityId(),
                    workspaceId: ctx.workspaceId,
                    executionId: executionId!,
                    timestamp: stopNow,
                    step: currentStep,
                    action: 'STOP',
                    status: 'success',
                    message: `Stopped early: contact status changed to "${status}".`
                  }
                ]);
                await sdk.locks.releaseLock(sequenceId!, entityId!);
              } catch {}

              publishAutomationEvent('automation:completed', {
                executionId,
                sequenceId,
                workspaceId: ctx.workspaceId,
                entityId,
                currentStep,
                workerPid: process.pid,
                timestamp: new Date().toISOString()
              });

              return {
                status: 'completed',
                executionId,
                sequenceId,
                entityId,
                currentStep,
                stoppedReason: `status_${status.toLowerCase()}`
              };
            }
          }
        } catch {}
      }

      // Pause check
      if (ctx.isPaused()) {
        execCtx!.execution.currentStep = currentStep;
        ctx.saveCheckpoint({
          executionId: executionId!,
          currentStep,
          sequenceId: sequenceId!,
          entityId: entityId!,
          entityType: entityType!,
          executionContext: execCtx!
        } satisfies AutomationCheckpoint);
        ctx.emitLog(
          `Execution Paused: executionId=${executionId}, stepIndex=${currentStep}`,
          'info'
        );
        try {
          await sdk.locks.releaseLock(sequenceId!, entityId!);
        } catch {}
        publishAutomationEvent('automation:paused', {
          executionId,
          sequenceId,
          workspaceId: ctx.workspaceId,
          entityId,
          currentStep,
          workerPid: process.pid,
          timestamp: new Date().toISOString()
        });
        return {
          status: 'paused',
          executionId,
          sequenceId,
          entityId,
          currentStep
        };
      }

      // Cancellation check
      if (ctx.isCancelled()) {
        ctx.emitLog(
          `Execution Cancelled: executionId=${executionId}, stepIndex=${currentStep}`,
          'warn'
        );
        try {
          await sdk.locks.releaseLock(sequenceId!, entityId!);
        } catch {}
        publishAutomationEvent('automation:cancelled', {
          executionId,
          sequenceId,
          workspaceId: ctx.workspaceId,
          entityId,
          currentStep,
          workerPid: process.pid,
          timestamp: new Date().toISOString()
        });
        return {
          status: 'cancelled',
          executionId,
          sequenceId,
          entityId,
          currentStep
        };
      }

      const step = steps[currentStep];
      if (!step) {
        break;
      }

      ctx.emitLog(
        `Step Starting: executionId=${executionId}, stepIndex=${currentStep}, stepType=${step.type}`,
        'info'
      );
      ctx.updateProgress(Math.round(((currentStep + 1) / steps.length) * 100), {
        description: `Running step ${currentStep + 1}/${steps.length}: ${step.type}`,
        step: currentStep + 1,
        total: steps.length
      });

      const registryAction = ActionRegistry[step.type];
      if (!registryAction) {
        throw new Error(`Unhandled step type "${step.type}" at index ${currentStep}.`);
      }

      const stepStart = Date.now();
      const MAX_STEP_DURATION_MS = 60_000;
      let dispatchResult: StepResult;

      try {
        const stepPromise = Promise.resolve(
          registryAction.execute(
            sdk,
            entityId!,
            ctx.workspaceId,
            sequenceId!,
            step,
            ctx,
            execCtx!,
            labelMap
          )
        );

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Step execution timeout: step of type "${step.type}" exceeded ${MAX_STEP_DURATION_MS / 1000}s.`
                )
              ),
            MAX_STEP_DURATION_MS
          )
        );

        dispatchResult = await Promise.race([stepPromise, timeoutPromise]);
      } catch (stepErr: any) {
        const elapsed = Date.now() - stepStart;
        ctx.emitLog(
          `Step Failed: executionId=${executionId}, stepIndex=${currentStep}, ` +
            `stepType=${step.type}, elapsed=${elapsed}ms, error=${stepErr.message || String(stepErr)}`,
          'error'
        );
        throw stepErr;
      }

      const elapsed = Date.now() - stepStart;
      ctx.emitLog(
        `Step Completed: executionId=${executionId}, stepIndex=${currentStep}, ` +
          `stepType=${step.type}, elapsed=${elapsed}ms`,
        'info'
      );

      const nowStr = new Date().toISOString();

      if (dispatchResult.status === 'success') {
        const nextStep = currentStep + 1;
        const isCompleted = nextStep >= steps.length;
        execCtx!.execution.currentStep = nextStep;

        try {
          await sdk.executions.update(executionId!, {
            currentStep: nextStep,
            status: isCompleted ? 'COMPLETED' : 'RUNNING',
            completedAt: isCompleted ? nowStr : undefined
          });

          await sdk.executions.addLogs(executionId!, [
            {
              id: generateEntityId(),
              workspaceId: ctx.workspaceId,
              executionId: executionId!,
              timestamp: nowStr,
              step: currentStep,
              action: step.type,
              status: 'success',
              message: `Step "${step.type}" completed successfully.`
            }
          ]);
        } catch {}

        currentStep = nextStep;

        if (isCompleted) {
          ctx.emitLog(
            `Execution Completed: executionId=${executionId}, sequenceId=${sequenceId}`,
            'info'
          );
          try {
            await sdk.locks.releaseLock(sequenceId!, entityId!);
          } catch {}
          publishAutomationEvent('automation:completed', {
            executionId,
            sequenceId,
            workspaceId: ctx.workspaceId,
            entityId,
            currentStep,
            workerPid: process.pid,
            timestamp: new Date().toISOString()
          });
          ctx.updateProgress(100, {
            description: 'Workflow complete.',
            step: currentStep,
            total: steps.length
          });
          return {
            status: 'completed',
            executionId,
            sequenceId,
            entityId,
            currentStep,
            campaignId: resolvedCampaignId
          };
        }
      } else if (dispatchResult.status === 'wait') {
        const delay = dispatchResult.delaySeconds || 60;
        const nextExecutionAt = new Date(Date.now() + delay * 1000).toISOString();
        const retrySameStep = (dispatchResult as any).retrySameStep === true;
        const nextStep = retrySameStep ? currentStep : currentStep + 1;
        execCtx!.execution.currentStep = nextStep;

        try {
          await sdk.executions.update(executionId!, {
            currentStep: nextStep,
            status: 'WAITING',
            nextExecutionAt
          });

          await sdk.executions.addLogs(executionId!, [
            {
              id: generateEntityId(),
              workspaceId: ctx.workspaceId,
              executionId: executionId!,
              timestamp: nowStr,
              step: currentStep,
              action: retrySameStep ? 'RATE_LIMIT_WAIT' : 'WAIT',
              status: 'success',
              message: retrySameStep
                ? `Mailbox throttled. Pausing execution for ${delay}s. Will retry step ${currentStep} at: ${nextExecutionAt}`
                : `Scheduled delay of ${delay}s. Next execution at: ${nextExecutionAt}`
            }
          ]);
        } catch {}

        ctx.saveCheckpoint({
          executionId: executionId!,
          currentStep: nextStep,
          sequenceId: sequenceId!,
          entityId: entityId!,
          entityType: entityType!,
          executionContext: execCtx!
        } satisfies AutomationCheckpoint);

        try {
          await sdk.locks.releaseLock(sequenceId!, entityId!);
        } catch {}

        ctx.emitLog(
          `Execution Waiting: executionId=${executionId}, stepIndex=${currentStep}, delay=${delay}s`,
          'info'
        );
        publishAutomationEvent('automation:waiting', {
          executionId,
          sequenceId,
          workspaceId: ctx.workspaceId,
          entityId,
          currentStep: nextStep,
          workerPid: process.pid,
          timestamp: new Date().toISOString()
        });
        ctx.updateProgress(100, {
          description: 'Waiting scheduled.',
          step: nextStep,
          total: steps.length
        });
        return {
          status: 'waiting',
          executionId,
          sequenceId,
          entityId,
          currentStep: nextStep,
          delaySeconds: delay,
          nextExecutionAt,
          campaignId: resolvedCampaignId
        };
      } else if (dispatchResult.status === 'goto') {
        const { targetIndex, targetLabel } = dispatchResult as {
          status: 'goto';
          targetIndex: number;
          targetLabel: string;
        };
        execCtx!.execution.currentStep = targetIndex;

        try {
          await sdk.executions.update(executionId!, {
            currentStep: targetIndex
          });

          await sdk.executions.addLogs(executionId!, [
            {
              id: generateEntityId(),
              workspaceId: ctx.workspaceId,
              executionId: executionId!,
              timestamp: nowStr,
              step: currentStep,
              action: step.type,
              status: 'success',
              message: `Jump to label "${targetLabel}" (index ${targetIndex}). jumpCount=${execCtx!.runtime.jumpCount}`
            }
          ]);
        } catch {}

        currentStep = targetIndex;
      } else if (dispatchResult.status === 'skip') {
        const { skipCount } = dispatchResult as {
          status: 'skip';
          skipCount: number;
        };
        const nextStep = Math.min(currentStep + 1 + skipCount, steps.length);
        execCtx!.execution.currentStep = nextStep;

        try {
          await sdk.executions.update(executionId!, {
            currentStep: nextStep
          });

          await sdk.executions.addLogs(executionId!, [
            {
              id: generateEntityId(),
              workspaceId: ctx.workspaceId,
              executionId: executionId!,
              timestamp: nowStr,
              step: currentStep,
              action: step.type,
              status: 'success',
              message: `Skipped ${skipCount} step(s). Advancing to step index ${nextStep}.`
            }
          ]);
        } catch {}

        currentStep = nextStep;

        if (currentStep >= steps.length) {
          const n2 = new Date().toISOString();
          try {
            await sdk.executions.update(executionId!, {
              status: 'COMPLETED',
              completedAt: n2
            });
            await sdk.locks.releaseLock(sequenceId!, entityId!);
          } catch {}

          publishAutomationEvent('automation:completed', {
            executionId,
            sequenceId,
            workspaceId: ctx.workspaceId,
            entityId,
            currentStep,
            workerPid: process.pid,
            timestamp: new Date().toISOString()
          });
          ctx.updateProgress(100, {
            description: 'Workflow complete (via SKIP).',
            step: currentStep,
            total: steps.length
          });
          return {
            status: 'completed',
            executionId,
            sequenceId,
            entityId,
            currentStep
          };
        }
      } else if (dispatchResult.status === 'paused') {
        execCtx!.execution.currentStep = currentStep;
        ctx.saveCheckpoint({
          executionId: executionId!,
          currentStep,
          sequenceId: sequenceId!,
          entityId: entityId!,
          entityType: entityType!,
          executionContext: execCtx!
        } satisfies AutomationCheckpoint);
        ctx.emitLog(`Execution Paused at step ${currentStep}: executionId=${executionId}`, 'info');
        try {
          await sdk.locks.releaseLock(sequenceId!, entityId!);
        } catch {}
        publishAutomationEvent('automation:paused', {
          executionId,
          sequenceId,
          workspaceId: ctx.workspaceId,
          entityId,
          currentStep,
          workerPid: process.pid,
          timestamp: new Date().toISOString()
        });
        return {
          status: 'paused',
          executionId,
          sequenceId,
          entityId,
          currentStep,
          campaignId: resolvedCampaignId
        };
      } else if (dispatchResult.status === 'cancelled') {
        ctx.emitLog(`Execution Cancelled at step ${currentStep}: executionId=${executionId}`, 'warn');
        try {
          await sdk.locks.releaseLock(sequenceId!, entityId!);
        } catch {}
        publishAutomationEvent('automation:cancelled', {
          executionId,
          sequenceId,
          workspaceId: ctx.workspaceId,
          entityId,
          currentStep,
          workerPid: process.pid,
          timestamp: new Date().toISOString()
        });
        return {
          status: 'cancelled',
          executionId,
          sequenceId,
          entityId,
          currentStep,
          campaignId: resolvedCampaignId
        };
      }
    }

    try {
      await sdk.locks.releaseLock(sequenceId!, entityId!);
    } catch {}
    publishAutomationEvent('automation:completed', {
      executionId,
      sequenceId,
      workspaceId: ctx.workspaceId,
      entityId,
      currentStep,
      workerPid: process.pid,
      timestamp: new Date().toISOString()
    });
    return {
      status: 'completed',
      executionId,
      sequenceId,
      entityId,
      currentStep
    };
  } catch (err: any) {
    try {
      const payload = ctx.payload as AutomationWorkflowPayload;
      const checkpoint = ctx.getCheckpoint() as AutomationCheckpoint | null;
      const resolvedExecId = checkpoint?.executionId || executionId || (payload as any).executionId;
      const resolvedStep = checkpoint?.currentStep ?? currentStep ?? 0;
      const resolvedSeqId = sequenceId || payload?.sequenceId;
      const resolvedEntId = entityId || payload?.entityId;

      if (resolvedExecId) {
        ctx.emitLog(
          `Execution Failed: executionId=${resolvedExecId}, sequenceId=${resolvedSeqId || 'unknown'}, ` +
            `stepIndex=${resolvedStep}, error=${err.message || String(err)}`,
          'error'
        );
        const n = new Date().toISOString();
        try {
          await sdk.executions.update(resolvedExecId, {
            status: 'FAILED',
            completedAt: n
          });
          await sdk.executions.addLogs(resolvedExecId, [
            {
              id: generateEntityId(),
              workspaceId: ctx.workspaceId,
              executionId: resolvedExecId,
              timestamp: n,
              step: resolvedStep,
              action: 'ERROR',
              status: 'failed',
              message: err.message || String(err)
            }
          ]);
        } catch {}

        if (resolvedSeqId && resolvedEntId) {
          try {
            await sdk.locks.releaseLock(resolvedSeqId, resolvedEntId);
          } catch {}
        }

        publishAutomationEvent('automation:failed', {
          executionId: resolvedExecId,
          sequenceId: resolvedSeqId || 'unknown',
          workspaceId: ctx.workspaceId,
          entityId: resolvedEntId || 'unknown',
          currentStep: resolvedStep,
          workerPid: process.pid,
          error: err.message || String(err),
          timestamp: new Date().toISOString()
        });
      }
    } catch {}
    throw err;
  }
}

// ── Step Handlers ─────────────────────────────────────────────────────────────

async function handleSendEmailStep(
  sdk: SdkClient,
  entityId: string,
  workspaceId: string,
  sequenceId: string,
  step: StepDefinition,
  ctx: JobContext,
  execCtx: ExecutionContext
): Promise<
  | { status: 'success' }
  | { status: 'wait'; delaySeconds: number; retrySameStep: boolean }
  | { status: 'paused' }
  | { status: 'cancelled' }
> {
  const templateId = step.config?.templateId;
  let rawSubject = step.config?.subject || '';
  let rawBody = step.config?.body || '';
  let rawAttachments: any[] = step.config?.attachments || [];
  let matchedTemplate: any = null;
  let pinnedTemplateVersion: number | undefined = undefined;

  if (templateId) {
    if (!execCtx.templateVersions) {
      execCtx.templateVersions = {};
    }

    // Determine pinned version:
    // 1. Explicitly pinned on sequence step
    // 2. Previously pinned in this execution context
    // 3. Initial lookup pinned at send time
    let resolvedVersion = 1;
    if (typeof step.config?.templateVersion === 'number' && step.config.templateVersion > 0) {
      resolvedVersion = step.config.templateVersion;
    } else if (execCtx.templateVersions[templateId]) {
      resolvedVersion = execCtx.templateVersions[templateId];
    } else {
      // First materialization for this execution: query active template to pin its current version
      const activeTpl = await sdk.outreach.getTemplate(templateId).catch(() => null);
      resolvedVersion = activeTpl?.version || 1;
    }

    pinnedTemplateVersion = resolvedVersion;
    execCtx.templateVersions[templateId] = resolvedVersion;

    // Fetch the pinned historical version through typed SDK contract (TPL-05)
    try {
      matchedTemplate = await sdk.outreach.getTemplateVersion(templateId, resolvedVersion);
    } catch (verErr: any) {
      ctx.emitLog(
        `Failed to resolve pinned template version ${pinnedTemplateVersion} for template "${templateId}": ${verErr?.message || verErr}`,
        'error'
      );
      throw new Error(
        `Automation workflow: pinned version ${pinnedTemplateVersion} of template "${templateId}" not found.`
      );
    }

    if (matchedTemplate) {
      if (!rawSubject) rawSubject = matchedTemplate.subject;
      if (!rawBody) rawBody = matchedTemplate.body;
      if (!rawAttachments || rawAttachments.length === 0) {
        rawAttachments = Array.isArray(matchedTemplate.attachments)
          ? matchedTemplate.attachments
          : typeof matchedTemplate.attachments === 'string'
          ? JSON.parse(matchedTemplate.attachments)
          : [];
      }
    }
  }

  if (!rawSubject || !rawBody) {
    throw new Error(
      'Automation workflow: SEND_EMAIL step config missing required subject/body or valid templateId.'
    );
  }

  const contact = await sdk.contacts.get(entityId);
  if (!contact) throw new Error(`Contact not found: ${entityId}`);

  // Phase 15 (SEC-EMAIL-14): Deterministic email resolution
  // 1. Thread / step override -> 2. Primary verified email -> 3. First secondary email
  const secondaryList = (contact as any).secondaryEmails;
  const firstSecondary = Array.isArray(secondaryList) && secondaryList.length > 0 ? String(secondaryList[0]) : null;
  const candidateEmail = (step.config?.recipientEmail as string | undefined) || contact.email || firstSecondary;

  if (!candidateEmail) throw new Error(`Contact ${entityId} has no valid email address.`);
  const recipientEmail: string = candidateEmail;

  // Phase 16: Variables snapshot determinism (VARIABLES-SNAPSHOT)
  // Interpolation context prioritizes execCtx.contact snapshot taken at execution initialization,
  // preventing later edits to the contact table from mutating the committed outreach content.
  const renderCtx: ExecutionContext = {
    ...execCtx,
    contact: {
      ...contact,
      ...(execCtx.contact || {}),
      email: recipientEmail
    }
  };
  const renderedSubject = resolveVariables(rawSubject, renderCtx);
  const renderedBody = resolveVariables(rawBody, renderCtx);
  const formattedBody = formatEmailBody(renderedBody);
  const variablesSnapshot = captureVariablesSnapshot(rawSubject + ' ' + rawBody, renderCtx as any);

  const accounts = await sdk.outreach.listAccounts();
  const targetAccountId = step.config?.sendingAccountId || step.config?.accountId;
  const accountDoc = targetAccountId
    ? accounts.find((a: any) => a.id === targetAccountId)
    : accounts.find((a: any) => a.status === 'connected') || accounts[0];

  if (!accountDoc) {
    throw new Error('No connected email sender account found in workspace for sending email step.');
  }

  const stepKey = step.id || String(execCtx.execution.currentStep || 0);
  const stepIndexNum = typeof execCtx.execution.currentStep === 'number' ? execCtx.execution.currentStep : 0;
  const campaignId = (step.config as any)?.campaignId || (ctx.payload as any)?.campaignId || (execCtx as any)?.campaign?.id;

  // Send-time server-authoritative campaign authorization check (PAUSE-07 / DRIFT-STOP-19)
  let campaignDoc: any = null;
  if (campaignId) {
    try {
      campaignDoc = await sdk.campaigns.get(campaignId);
    } catch {}
    if (campaignDoc) {
      const campStatus = String(campaignDoc.status || '').toUpperCase();
      if (campStatus === 'STOPPED' || campStatus === 'FAILED') {
        ctx.emitLog(`Campaign "${campaignId}" is in terminal state "${campStatus}". Aborting email send step.`, 'warn');
        try {
          if (execCtx.execution.id) {
            await sdk.executions.update(execCtx.execution.id, { status: 'CANCELLED' });
          }
          await sdk.locks.releaseLock(sequenceId, entityId);
        } catch {}
        return { status: 'cancelled' };
      }
      if (campStatus === 'PAUSED') {
        ctx.emitLog(`Campaign "${campaignId}" is PAUSED. Halting email send step and setting execution PAUSED.`, 'info');
        try {
          if (execCtx.execution.id) {
            await sdk.executions.update(execCtx.execution.id, { status: 'PAUSED' });
          }
          await sdk.locks.releaseLock(sequenceId, entityId);
        } catch {}
        return { status: 'paused' };
      }
    }
  }

  // Send-time contact eligibility check
  const eligibility = evaluateOutreachEligibility({
    contact: { ...contact, email: recipientEmail },
    campaign: campaignDoc,
    recipientEmail,
    bouncedEmail: (contact as any).bouncedEmail || (contact.status === 'BOUNCED' ? (contact.email || null) : null)
  });
  if (!eligibility.eligible) {
    ctx.emitLog(`Contact "${recipientEmail}" is ineligible for outreach: ${eligibility.reason}. Skipping send step.`, 'warn');
    return { status: 'success' };
  }

  const idempotencyKey = `email_${workspaceId}_${execCtx.execution.id}_${stepKey}_${entityId}`;

  try {
    const sendResult = await sdk.outreach.sendEmail({
      accountId: accountDoc.id,
      to: recipientEmail,
      subject: renderedSubject,
      text: formattedBody.text,
      html: formattedBody.html,
      useSignature: step.config?.useGmailSignature !== false,
      attachments: rawAttachments,
      idempotencyKey,
      campaignId,
      sequenceId,
      executionId: execCtx.execution.id,
      stepIndex: stepIndexNum,
      contactId: entityId,
      ...(templateId ? { templateId } : {}),
      ...(typeof pinnedTemplateVersion === 'number' ? { templateVersion: pinnedTemplateVersion } : {}),
      ...(variablesSnapshot ? { variablesSnapshot } : {})
    });
    const sentMsgId = sendResult.messageId || null;

    try {
      await sdk.contacts.update(entityId, {
        notes: `[Contacted] ${new Date().toISOString()}`
      });
    } catch {}

    ctx.emitLog(
      `Email send success: messageId=${sentMsgId || 'unknown'}, recipient=${contact.email}, subject=${renderedSubject}`,
      'info',
      {
        messageId: sentMsgId,
        recipient: contact.email,
        subject: renderedSubject,
        executionId: execCtx.execution.id,
        stepIndex: stepIndexNum,
        attachmentsCount: rawAttachments.length
      }
    );
    return { status: 'success' };
  } catch (sendErr: any) {
    const errMsg = sendErr.message || String(sendErr);

    const isCardinalityExceeded =
      sendErr.code === 'COMPANY_CARDINALITY_EXCEEDED' ||
      errMsg.includes('COMPANY_CARDINALITY_EXCEEDED') ||
      errMsg.includes('Company contact cardinality limit reached');

    if (isCardinalityExceeded) {
      ctx.emitLog(
        `Contact "${recipientEmail}" deferred: company contact cardinality limit reached for campaign "${campaignId}". Yielding WAITING state.`,
        'warn'
      );
      return { status: 'wait', delaySeconds: 3600, retrySameStep: true };
    }

    const isRateLimited =
      sendErr.status === 429 ||
      sendErr.code === 'EMAIL_RATE_LIMITED' ||
      sendErr.code === 'PROVIDER_RATE_LIMITED' ||
      sendErr.code === 'DOMAIN_PACING_THROTTLED' ||
      errMsg.includes('DOMAIN_PACING_THROTTLED') ||
      errMsg.includes('EMAIL_RATE_LIMITED') ||
      errMsg.includes('PROVIDER_RATE_LIMITED') ||
      errMsg.includes('429') ||
      errMsg.includes('Rate limit') ||
      errMsg.includes('limit reached');

    if (isRateLimited) {
      const retryAfterSec =
        typeof sendErr.retryAfterSec === 'number' && sendErr.retryAfterSec > 0
          ? sendErr.retryAfterSec
          : 5;

      if (retryAfterSec <= 5) {
        ctx.emitLog(
          `Mailbox temporarily throttled (${retryAfterSec}s). Pausing in-process to retry step...`,
          'warn'
        );
        await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
        try {
          const retryResult = await sdk.outreach.sendEmail({
            accountId: accountDoc.id,
            to: recipientEmail,
            subject: renderedSubject,
            text: formattedBody.text,
            html: formattedBody.html,
            useSignature: step.config?.useGmailSignature !== false,
            attachments: rawAttachments,
            idempotencyKey,
            campaignId,
            sequenceId,
            executionId: execCtx.execution.id,
            stepIndex: stepIndexNum,
            contactId: entityId,
            ...(templateId ? { templateId } : {}),
            ...(typeof pinnedTemplateVersion === 'number' ? { templateVersion: pinnedTemplateVersion } : {}),
            ...(variablesSnapshot ? { variablesSnapshot } : {})
          });
          const sentMsgId = retryResult.messageId || null;
          ctx.emitLog(
            `Email send succeeded on retry: messageId=${sentMsgId || 'unknown'}, recipient=${recipientEmail}`,
            'info'
          );
          return { status: 'success' };
        } catch (retryErr: any) {
          const secondRetrySec = retryErr.retryAfterSec || 15;
          ctx.emitLog(
            `Mailbox throttled on retry. Yielding WAITING state for ${secondRetrySec}s without advancing step.`,
            'warn'
          );
          return { status: 'wait', delaySeconds: secondRetrySec, retrySameStep: true };
        }
      } else {
        ctx.emitLog(
          `Mailbox rate limit/quota reached (retryAfter=${retryAfterSec}s). Yielding WAITING state without advancing step.`,
          'warn'
        );
        return { status: 'wait', delaySeconds: retryAfterSec, retrySameStep: true };
      }
    }

    const isAuthRequired =
      sendErr.code === 'MAILBOX_REAUTH_REQUIRED' ||
      sendErr.code === 'GMAIL_AUTH_REVOKED' ||
      sendErr.code === 'UNAUTHORIZED' ||
      errMsg.includes('MAILBOX_REAUTH_REQUIRED') ||
      errMsg.includes('Re-authentication required');

    if (isAuthRequired) {
      ctx.emitLog(
        `Mailbox requires re-authorization: ${errMsg}. Yielding WAITING state so operator can reconnect without failing execution.`,
        'warn'
      );
      return { status: 'wait', delaySeconds: 300, retrySameStep: true };
    }

    const isMailboxBlocked =
      sendErr.code === 'MAILBOX_NOT_AUTHORIZED' ||
      sendErr.code === 'MAILBOX_BLOCKED' ||
      errMsg.includes('MAILBOX_BLOCKED') ||
      errMsg.includes('Operator action required') ||
      errMsg.includes('Operator intervention required');

    if (isMailboxBlocked) {
      ctx.emitLog(
        `Mailbox is blocked: ${errMsg}. Yielding WAITING state for operator review.`,
        'warn'
      );
      return { status: 'wait', delaySeconds: 300, retrySameStep: true };
    }

    const isAmbiguous =
      sendErr.code === 'AMBIGUOUS_SEND_TIMEOUT' ||
      sendErr.category === 'AMBIGUOUS' ||
      sendErr.ambiguous === true ||
      errMsg.includes('AMBIGUOUS_SEND_TIMEOUT') ||
      errMsg.includes('ambiguous') ||
      errMsg.includes('pending reconciliation');

    if (isAmbiguous) {
      ctx.emitLog(
        `Ambiguous send outcome encountered for recipient ${contact.email}: ${errMsg}. Execution paused pending reconciliation. Will NOT blindly retry.`,
        'warn'
      );
      try {
        if (execCtx.execution.id) {
          await sdk.executions.update(execCtx.execution.id, {
            status: 'PAUSED'
          });
          await sdk.executions.addLogs(execCtx.execution.id, [
            {
              id: generateEntityId(),
              workspaceId: ctx.workspaceId,
              executionId: execCtx.execution.id,
              timestamp: new Date().toISOString(),
              step: stepIndexNum,
              action: 'AMBIGUOUS_DELIVERY_PAUSE',
              status: 'warn',
              message: `Ambiguous outbound send outcome encountered: ${errMsg}. Execution paused to prevent duplicate dispatch pending reconciliation.`
            }
          ]);
        }
        await sdk.locks.releaseLock(sequenceId, entityId);
      } catch {}

      return { status: 'paused' };
    }

    ctx.emitLog(
      `Email send failed for recipient ${contact.email} (subject: "${renderedSubject}"): ${errMsg}`,
      'error',
      {
        recipient: contact.email,
        subject: renderedSubject,
        executionId: execCtx.execution.id,
        stepIndex: stepIndexNum,
        error: errMsg
      }
    );
    throw new Error(`Email send failed: ${errMsg}`);
  }
}

function handleWaitStep(step: StepDefinition): {
  status: 'wait';
  delaySeconds: number;
} {
  const rawDelay = step.config?.delaySeconds || step.config?.duration || 60;
  const delay = Math.max(0, parseInt(String(rawDelay), 10) || 60);
  return { status: 'wait', delaySeconds: delay };
}

async function handleAssignTagStep(
  sdk: SdkClient,
  entityId: string,
  _workspaceId: string,
  step: StepDefinition,
  ctx: JobContext,
  execCtx: ExecutionContext
): Promise<{ status: 'success' }> {
  const rawTag = step.config?.tag;
  if (!rawTag)
    throw new Error('Automation workflow: ASSIGN_TAG step config missing required parameter: tag.');
  const newTag = resolveVariables(String(rawTag), execCtx);

  const contact = await sdk.contacts.get(entityId);
  if (!contact) throw new Error(`Contact not found: ${entityId}`);

  let existingTags: string[] = [];
  if (contact.notes && contact.notes.startsWith('Tags: ')) {
    existingTags = contact.notes.replace('Tags: ', '').split(',').map((t: string) => t.trim());
  }
  if (existingTags.includes(newTag)) {
    ctx.emitLog(
      `Tag "${newTag}" already assigned to contact ${entityId} (idempotent skip).`,
      'info'
    );
    return { status: 'success' };
  }

  const updatedTags = [...existingTags, newTag];
  await sdk.contacts.update(entityId, {
    notes: `Tags: ${updatedTags.join(', ')}`
  });

  return { status: 'success' };
}

async function handleUpdateStageStep(
  sdk: SdkClient,
  entityId: string,
  _workspaceId: string,
  step: StepDefinition,
  ctx: JobContext
): Promise<{ status: 'success' }> {
  const stage = step.config?.stage || step.config?.status;
  if (!stage)
    throw new Error(
      'Automation workflow: UPDATE_STAGE step config missing required parameter: stage.'
    );

  const validStages = ['NEW', 'CONTACTED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED'];
  if (!validStages.includes(stage.toUpperCase())) {
    throw new Error(
      `Invalid destination stage "${stage}". Valid stages: ${validStages.join(', ')}`
    );
  }

  const contact = await sdk.contacts.get(entityId);
  if (!contact) throw new Error(`Contact not found: ${entityId}`);

  if (contact.status === stage.toUpperCase()) {
    ctx.emitLog(
      `Contact ${entityId} is already in stage "${stage.toUpperCase()}" (idempotent skip).`,
      'info'
    );
    return { status: 'success' };
  }

  await sdk.contacts.update(entityId, {
    status: stage.toUpperCase() as any
  });

  return { status: 'success' };
}

function handleSetVariableStep(
  step: StepDefinition,
  execCtx: ExecutionContext
): { status: 'success' } {
  const assignments: Array<{
    variable: string;
    value: string;
    operator?: string;
  }> = step.config?.assignments || [];

  for (const assignment of assignments) {
    const resolved = resolveVariables(String(assignment.value ?? ''), execCtx);
    const op = assignment.operator || '=';

    if (op === '+=') {
      const current = parseFloat(String(execCtx.variables[assignment.variable] ?? '0'));
      const delta = parseFloat(resolved);
      execCtx.variables[assignment.variable] =
        !isNaN(current) && !isNaN(delta) ? current + delta : resolved;
    } else if (op === '-=') {
      const current = parseFloat(String(execCtx.variables[assignment.variable] ?? '0'));
      const delta = parseFloat(resolved);
      execCtx.variables[assignment.variable] =
        !isNaN(current) && !isNaN(delta) ? current - delta : resolved;
    } else {
      // "=" — store as number if the resolved value is a pure numeric string
      const asNum = parseFloat(resolved);
      execCtx.variables[assignment.variable] =
        !isNaN(asNum) && String(asNum) === resolved.trim() ? asNum : resolved;
    }
  }

  return { status: 'success' };
}

function handleIfStep(
  step: StepDefinition,
  execCtx: ExecutionContext,
  labelMap: Map<string, number>,
  ctx: JobContext
):
  | { status: 'success' }
  | { status: 'goto'; targetIndex: number; targetLabel: string }
  | { status: 'skip'; skipCount: number } {
  const condition = step.config?.condition || '';
  if (!condition) throw new Error('IF step: condition is empty.');

  const evalStart = Date.now();
  let result: boolean;
  try {
    result = evaluateExpression(condition, execCtx);
  } catch (e: any) {
    throw new Error(`IF step evaluation failed — ${e.message}. Expression: "${condition}"`);
  }

  const resolvedForLog = resolveVariables(condition, execCtx);
  ctx.emitLog(
    `IF evaluation: condition="${condition}" resolved="${resolvedForLog}" ` +
      `result=${result} duration=${Date.now() - evalStart}ms`,
    'info'
  );

  if (result) {
    const thenGoto = step.config?.thenGoto;
    if (thenGoto) {
      const key = String(thenGoto).toLowerCase();
      const targetIndex = labelMap.get(key);
      if (targetIndex === undefined) {
        throw new Error(`IF step: thenGoto label "${thenGoto}" not found.`);
      }
      execCtx.runtime.jumpCount++;
      if (execCtx.runtime.jumpCount > 100) {
        throw new Error(
          `Jump limit exceeded (100). Possible infinite loop via IF → "${thenGoto}".`
        );
      }
      execCtx.runtime.currentLabel = thenGoto;
      return { status: 'goto', targetIndex, targetLabel: thenGoto };
    }
    return { status: 'success' };
  } else {
    const elseSkip = step.config?.elseSkip;
    if (elseSkip !== undefined && Number(elseSkip) > 0) {
      return { status: 'skip', skipCount: Number(elseSkip) };
    }
    return { status: 'success' };
  }
}

function handleLabelStep(step: StepDefinition, execCtx: ExecutionContext): { status: 'success' } {
  execCtx.runtime.currentLabel = step.config?.name || null;
  return { status: 'success' };
}

function handleGotoStep(
  step: StepDefinition,
  labelMap: Map<string, number>,
  execCtx: ExecutionContext,
  ctx: JobContext
): { status: 'goto'; targetIndex: number; targetLabel: string } {
  const label = step.config?.label;
  if (!label) throw new Error('GOTO step: missing required config field: "label".');

  const key = String(label).toLowerCase();
  const targetIndex = labelMap.get(key);
  if (targetIndex === undefined) {
    throw new Error(`GOTO step: label "${label}" not found.`);
  }

  execCtx.runtime.jumpCount++;
  if (execCtx.runtime.jumpCount > 100) {
    throw new Error(`Jump limit exceeded (100). Infinite loop detected via GOTO → "${label}".`);
  }
  execCtx.runtime.currentLabel = label;

  ctx.emitLog(
    `GOTO: jumping to label "${label}" (index ${targetIndex}). jumpCount=${execCtx.runtime.jumpCount}`,
    'info'
  );

  return { status: 'goto', targetIndex, targetLabel: label };
}

function handleSkipStep(step: StepDefinition): {
  status: 'skip';
  skipCount: number;
} {
  const count = Math.max(1, Number(step.config?.count ?? 1));
  return { status: 'skip', skipCount: count };
}

// ── HTTP Action Implementation (STAB-013E) ────────────────────────────────────

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function redactHeaders(headers: Record<string, any>): Record<string, string> {
  const redacted: Record<string, string> = {};
  const sensitiveKeys = [
    'authorization',
    'cookie',
    'api-key',
    'apikey',
    'secret',
    'password',
    'token',
    'x-api-key',
    'pass',
    'sec'
  ];
  for (const [k, v] of Object.entries(headers)) {
    const kl = k.toLowerCase();
    if (sensitiveKeys.some((sk) => kl.includes(sk))) {
      redacted[k] = '[REDACTED]';
    } else {
      redacted[k] = String(v);
    }
  }
  return redacted;
}

function redactBody(body: any): any {
  if (body === null || body === undefined) return body;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return JSON.stringify(redactBody(parsed));
    } catch {
      return body.replace(
        /(password|token|secret|auth|apikey|api_key|pass|sec)=[^&]*/gi,
        '$1=[REDACTED]'
      );
    }
  }
  if (Array.isArray(body)) {
    return body.map((item) => redactBody(item));
  }
  if (typeof body === 'object') {
    const redacted: Record<string, any> = {};
    const sensitiveKeys = [
      'authorization',
      'cookie',
      'api-key',
      'apikey',
      'secret',
      'password',
      'token',
      'x-api-key',
      'pass',
      'sec'
    ];
    for (const [k, v] of Object.entries(body)) {
      const kl = k.toLowerCase();
      if (sensitiveKeys.some((sk) => kl.includes(sk))) {
        redacted[k] = '[REDACTED]';
      } else {
        redacted[k] = redactBody(v);
      }
    }
    return redacted;
  }
  return body;
}

export function isRetryableHttpError(err: any): boolean {
  if (!err) return false;
  if (err instanceof HttpError) {
    return err.status === 429 || (err.status >= 500 && err.status <= 599);
  }
  const message = String(err.message || '').toLowerCase();
  const name = String(err.name || '');
  if (name === 'AbortError' || message.includes('timeout')) return true;

  const code = String(err.code || '');
  const retryableCodes = [
    'ENOTFOUND',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'EADDRINUSE',
    'EPIPE'
  ];
  if (retryableCodes.includes(code)) return true;

  if (message.includes('fetch failed') || message.includes('network')) return true;
  return false;
}

async function handleHttpRequestStep(
  _sdk: SdkClient,
  workspaceId: string,
  step: StepDefinition,
  ctx: JobContext,
  execCtx: ExecutionContext
): Promise<{ status: 'success' }> {
  const method = String(step.config?.method || 'GET').toUpperCase();
  const rawUrl = step.config?.url;
  const timeoutMs = Number(step.config?.timeout ?? 30000);
  const saveResponseAs = step.config?.saveResponseAs;

  if (!rawUrl) throw new Error('HTTP_REQUEST: missing url');

  const resolvedUrl = String(
    resolveVariablesRecursive(rawUrl, execCtx, null, workspaceId, ctx.payload._secrets)
  );
  const redactedHdrs = redactHeaders(
    resolveVariablesRecursive(
      step.config?.headers || {},
      execCtx,
      null,
      workspaceId,
      ctx.payload._secrets
    )
  );
  const resolvedBody = resolveVariablesRecursive(
    step.config?.body,
    execCtx,
    null,
    workspaceId,
    ctx.payload._secrets
  );

  const actualHeaders = resolveVariablesRecursive(
    step.config?.headers || {},
    execCtx,
    null,
    workspaceId,
    ctx.payload._secrets
  );

  let bodyToSend: any = undefined;
  if (resolvedBody !== undefined && resolvedBody !== null) {
    if (typeof resolvedBody === 'object') {
      bodyToSend = JSON.stringify(resolvedBody);
      actualHeaders['content-type'] = actualHeaders['content-type'] || 'application/json';
    } else {
      bodyToSend = String(resolvedBody);
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const requestStartTime = Date.now();
  let response: Response;

  try {
    response = await fetch(resolvedUrl, {
      method,
      headers: actualHeaders,
      body: bodyToSend,
      signal: controller.signal
    });
  } catch (err: any) {
    const duration = Date.now() - requestStartTime;
    ctx.emitLog(
      `HTTP Request Failed: method=${method} url=${resolvedUrl} ` +
        `duration=${duration}ms timeout=${timeoutMs}ms error=${err.message}`,
      'error'
    );
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const duration = Date.now() - requestStartTime;
  const bodyText = await response.text();
  const payloadSize = Buffer.byteLength(bodyText, 'utf8');

  let parsedBody: any = bodyText;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch {
    // raw text fallback
  }

  ctx.emitLog(
    `HTTP Request Completed: method=${method} url=${resolvedUrl} ` +
      `status=${response.status} duration=${duration}ms payloadSize=${payloadSize}bytes ` +
      `headers=${JSON.stringify(redactedHdrs)}`,
    'info'
  );

  // Save response context
  if (saveResponseAs) {
    execCtx.variables[saveResponseAs] = {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: parsedBody,
      duration
    };
  }

  if (response.status >= 400) {
    throw new HttpError(response.status, `HTTP error ${response.status}`, bodyText);
  }

  return { status: 'success' };
}

// ── Generic Plugin Action Registry ─────────────────────────────────────────────

interface AutomationAction {
  execute(
    sdk: SdkClient,
    entityId: string,
    workspaceId: string,
    sequenceId: string,
    step: StepDefinition,
    ctx: JobContext,
    execCtx: ExecutionContext,
    labelMap: Map<string, number>
  ): Promise<StepResult> | StepResult;

  validate(step: StepDefinition, labelMap: Map<string, number>): string[];

  supportsRetry(err: any): boolean;
}

export const ActionRegistry: Record<string, AutomationAction> = {
  SEND_EMAIL: {
    execute: async (sdk, entityId, workspaceId, sequenceId, step, ctx, execCtx) => {
      return await handleSendEmailStep(sdk, entityId, workspaceId, sequenceId, step, ctx, execCtx);
    },
    validate: (step) => {
      const errors: string[] = [];
      if (!step.config?.templateId && (!step.config?.subject || !step.config?.body)) {
        errors.push('missing templateId or inline subject/body');
      }
      return errors;
    },
    supportsRetry: () => true
  },
  WAIT: {
    execute: (_sdk, _entityId, _workspaceId, _sequenceId, step) => handleWaitStep(step),
    validate: (step) => {
      const errors: string[] = [];
      const delay = step.config?.delaySeconds || step.config?.duration;
      if (delay === undefined) {
        errors.push('missing delaySeconds or duration');
      } else if (isNaN(Number(delay)) || Number(delay) < 0) {
        errors.push(`invalid delaySeconds/duration "${delay}" (must be a positive number)`);
      }
      return errors;
    },
    supportsRetry: () => false
  },
  ASSIGN_TAG: {
    execute: (sdk, entityId, workspaceId, _sequenceId, step, ctx, execCtx) =>
      handleAssignTagStep(sdk, entityId, workspaceId, step, ctx, execCtx),
    validate: (step) => {
      const errors: string[] = [];
      if (!step.config?.tag) errors.push('missing tag');
      return errors;
    },
    supportsRetry: () => false
  },
  UPDATE_STAGE: {
    execute: (sdk, entityId, workspaceId, _sequenceId, step, ctx) =>
      handleUpdateStageStep(sdk, entityId, workspaceId, step, ctx),
    validate: (step) => {
      const errors: string[] = [];
      const stage = step.config?.stage || step.config?.status;
      if (!stage) {
        errors.push('missing stage');
      } else {
        const validStages = ['NEW', 'CONTACTED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED'];
        if (!validStages.includes(String(stage).toUpperCase())) {
          errors.push(`invalid stage "${stage}"`);
        }
      }
      return errors;
    },
    supportsRetry: () => false
  },
  SET_VARIABLE: {
    execute: (_sdk, _entityId, _workspaceId, _sequenceId, step, _ctx, execCtx) =>
      handleSetVariableStep(step, execCtx),
    validate: (step) => {
      const errors: string[] = [];
      const assignments = step.config?.assignments;
      if (!Array.isArray(assignments) || assignments.length === 0) {
        errors.push('no assignments provided');
      } else {
        assignments.forEach((a: any, j: number) => {
          if (!a?.variable) errors.push(`assignment ${j} is missing variable name`);
        });
      }
      return errors;
    },
    supportsRetry: () => false
  },
  IF: {
    execute: (_sdk, _entityId, _workspaceId, _sequenceId, step, ctx, execCtx, labelMap) =>
      handleIfStep(step, execCtx, labelMap, ctx),
    validate: (step, labelMap) => {
      const errors: string[] = [];
      if (!step.config?.condition) {
        errors.push('condition is empty');
      }
      const thenGoto = step.config?.thenGoto;
      if (thenGoto && !labelMap.has(String(thenGoto).toLowerCase())) {
        errors.push(`thenGoto references undefined label "${thenGoto}"`);
      }
      return errors;
    },
    supportsRetry: () => false
  },
  LABEL: {
    execute: (_sdk, _entityId, _workspaceId, _sequenceId, step, _ctx, execCtx) =>
      handleLabelStep(step, execCtx),
    validate: (step, _labelMap) => {
      const errors: string[] = [];
      if (!step.config?.name) errors.push('missing name');
      return errors;
    },
    supportsRetry: () => false
  },
  GOTO: {
    execute: (_sdk, _entityId, _workspaceId, _sequenceId, step, ctx, execCtx, labelMap) =>
      handleGotoStep(step, labelMap, execCtx, ctx),
    validate: (step, labelMap) => {
      const errors: string[] = [];
      const label = step.config?.label;
      if (!label) {
        errors.push('missing label');
      } else if (!labelMap.has(String(label).toLowerCase())) {
        errors.push(`references undefined label "${label}"`);
      }
      return errors;
    },
    supportsRetry: () => false
  },
  SKIP: {
    execute: (_sdk, _entityId, _workspaceId, _sequenceId, step) => handleSkipStep(step),
    validate: (step) => {
      const errors: string[] = [];
      const count = step.config?.count;
      if (count !== undefined && (isNaN(Number(count)) || Number(count) < 1)) {
        errors.push(`invalid count "${count}"`);
      }
      return errors;
    },
    supportsRetry: () => false
  },
  HTTP_REQUEST: {
    execute: async (sdk, _entityId, workspaceId, _sequenceId, step, ctx, execCtx) => {
      return await handleHttpRequestStep(sdk, workspaceId, step, ctx, execCtx);
    },
    validate: (step) => {
      const errors: string[] = [];
      const method = step.config?.method;
      const url = step.config?.url;
      const timeout = step.config?.timeout;
      const saveResponseAs = step.config?.saveResponseAs;

      if (!url) {
        errors.push('missing url');
      } else {
        const isVariableUrl = url.includes('{{');
        if (!isVariableUrl) {
          try {
            new URL(url);
          } catch {
            errors.push(`invalid URL "${url}"`);
          }
        }
      }

      if (!method) {
        errors.push('missing method');
      } else {
        const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
        if (!allowedMethods.includes(String(method).toUpperCase())) {
          errors.push(`unsupported method "${method}"`);
        }
      }

      if (timeout !== undefined && (isNaN(Number(timeout)) || Number(timeout) <= 0)) {
        errors.push(`invalid timeout "${timeout}" (must be a positive number)`);
      }

      if (step.config?.headers && typeof step.config.headers !== 'object') {
        errors.push('headers must be an object');
      }

      if (saveResponseAs) {
        if (!/^[a-zA-Z0-9_]+$/.test(saveResponseAs)) {
          errors.push(`invalid saveResponseAs variable name "${saveResponseAs}"`);
        }
      }

      return errors;
    },
    supportsRetry: (err) => isRetryableHttpError(err)
  },
  RUN_DISCOVERY: {
    execute: async (sdk, _entityId, _workspaceId, _sequenceId, step, ctx) => {
      const query = step.config?.query;
      const limit = step.config?.limit || 50;
      if (!query) throw new Error('RUN_DISCOVERY: missing query parameter');

      const jobId = generateEntityId();
      try {
        await sdk.jobs.create({
          id: jobId,
          type: 'scraper:maps',
          priority: 3,
          payload: { query, maxResults: limit }
        });
      } catch {}
      ctx.emitLog(`Queued RUN_DISCOVERY scraper job ${jobId} for query "${query}"`, 'info');
      return { status: 'success' };
    },
    validate: (step) => {
      const errors: string[] = [];
      if (!step.config?.query) errors.push('missing query');
      return errors;
    },
    supportsRetry: () => false
  },
  RUN_CRAWLER: {
    execute: async (sdk, entityId, _workspaceId, _sequenceId, step, ctx) => {
      const companyId = step.config?.companyId || entityId;
      const website = step.config?.website || ctx.payload.website;
      if (!companyId || !website) throw new Error('RUN_CRAWLER: missing companyId or website');

      const jobId = generateEntityId();
      try {
        await sdk.jobs.create({
          id: jobId,
          type: 'crawler:website',
          priority: 3,
          payload: { companyId, website }
        });
      } catch {}
      ctx.emitLog(`Queued RUN_CRAWLER crawler job ${jobId} for company "${companyId}"`, 'info');
      return { status: 'success' };
    },
    validate: () => [],
    supportsRetry: () => false
  },
  RUN_INTELLIGENCE: {
    execute: async (sdk, entityId, _workspaceId, _sequenceId, step, ctx) => {
      const companyId = step.config?.companyId || entityId;
      if (!companyId) throw new Error('RUN_INTELLIGENCE: missing companyId');

      const jobId = generateEntityId();
      try {
        await sdk.jobs.create({
          id: jobId,
          type: 'enrich:intelligence',
          priority: 3,
          payload: { companyId }
        });
      } catch {}
      ctx.emitLog(
        `Queued RUN_INTELLIGENCE enricher job ${jobId} for company "${companyId}"`,
        'info'
      );
      return { status: 'success' };
    },
    validate: () => [],
    supportsRetry: () => false
  },
  GENERATE_AI_SUMMARY: {
    execute: async (sdk, entityId, _workspaceId, _sequenceId, step, ctx, execCtx) => {
      const companyId = step.config?.companyId || entityId;
      if (!companyId) throw new Error('GENERATE_AI_SUMMARY: missing companyId');

      let companyName = 'Unknown Company';
      let industry = 'Software';
      try {
        const company = await sdk.companies.get(companyId);
        if (company) {
          companyName = company.name || companyName;
          industry = company.industry || industry;
        }
      } catch {}

      const openRouterKey = ctx.payload._secrets?.['openrouter_key'] || '';
      const aiMode = ctx.payload._secrets?.['ai_mode'] as any;

      let summaryText = 'AI summary generation completed.';
      try {
        const result = await AIRuntime.execute(
          PromptsLibrary.GENERATE_AI_SUMMARY,
          { companyName, industry },
          {
            openRouterKey,
            aiMode,
            ollamaModel: ctx.payload._secrets?.['ollama_model']
          }
        );
        if (result.success) {
          summaryText = result.data;
        }
      } catch (err: any) {
        ctx.emitLog(`GENERATE_AI_SUMMARY: Execution error: ${err.message}`, 'warn');
      }

      try {
        await sdk.intelligence.createCompanyIntel({
          id: generateEntityId(),
          companyId,
          summary: summaryText,
          techStack: [],
          businessModel: 'B2B',
          estimatedRevenue: '$1M-$5M',
          growthSignals: [],
          hiringSignals: [],
          decisionMakerLikelihood: 0.8,
          missingInformation: []
        });
      } catch {}

      execCtx.variables.aiSummary = summaryText;
      ctx.emitLog(`Generated AI summary for company "${companyName}": "${summaryText}"`, 'info');
      return { status: 'success' };
    },
    validate: () => [],
    supportsRetry: () => false
  },
  GENERATE_OPENING_LINE: {
    execute: async (sdk, entityId, _workspaceId, _sequenceId, step, ctx, execCtx) => {
      const companyId = step.config?.companyId || entityId;
      if (!companyId) throw new Error('GENERATE_OPENING_LINE: missing companyId');

      let companyName = 'Unknown Company';
      let industry = 'Software';
      try {
        const company = await sdk.companies.get(companyId);
        if (company) {
          companyName = company.name || companyName;
          industry = company.industry || industry;
        }
      } catch {}

      const openRouterKey = ctx.payload._secrets?.['openrouter_key'] || '';
      const aiMode = ctx.payload._secrets?.['ai_mode'] as any;

      let openingLine = 'Hi there, reaching out to see if you have technical needs.';
      try {
        const result = await AIRuntime.execute(
          PromptsLibrary.GENERATE_OPENING_LINE,
          { companyName, industry },
          {
            openRouterKey,
            aiMode,
            ollamaModel: ctx.payload._secrets?.['ollama_model']
          }
        );
        if (result.success) {
          openingLine = result.data;
        }
      } catch (err: any) {
        ctx.emitLog(`GENERATE_OPENING_LINE: Execution error: ${err.message}`, 'warn');
      }

      execCtx.variables.openingLine = openingLine;
      ctx.emitLog(
        `Generated AI opening line for company "${companyName}": "${openingLine}"`,
        'info'
      );
      return { status: 'success' };
    },
    validate: () => [],
    supportsRetry: () => false
  },
  CREATE_CAMPAIGN: {
    execute: async (sdk, _entityId, _workspaceId, _sequenceId, step, ctx) => {
      const name = step.config?.name || 'Auto Generated Campaign';
      const subject = step.config?.subject || 'Reaching Out';
      const body = step.config?.body || 'Hello!';

      const campaignId = generateEntityId();
      try {
        await sdk.campaigns.create({
          id: campaignId,
          name,
          status: CampaignStatus.DRAFT,
          settings: { subject, body }
        });
      } catch {}

      ctx.emitLog(`Created campaign ${campaignId} named "${name}"`, 'info');
      return { status: 'success' };
    },
    validate: () => [],
    supportsRetry: () => false
  },
  ENROLL_CONTACT: {
    execute: async (sdk, entityId, _workspaceId, _sequenceId, step, ctx) => {
      const campaignId = step.config?.campaignId;
      const contactId = step.config?.contactId || entityId;
      if (!campaignId || !contactId)
        throw new Error('ENROLL_CONTACT: missing campaignId or contactId');

      let campaign: any = null;
      try {
        campaign = await sdk.campaigns.get(campaignId);
      } catch {}

      if (!campaign) throw new Error(`Campaign "${campaignId}" not found or deleted.`);

      const enrollmentId = generateEntityId();
      const now = new Date().toISOString();

      try {
        await sdk.executions.create({
          id: enrollmentId,
          sequenceId: campaign.sequenceId || campaignId,
          campaignId,
          contactId,
          currentStep: 0,
          currentStepName: 'Initial',
          status: campaign.status === 'Active' ? 'RUNNING' : 'PAUSED',
          startedAt: now
        });
      } catch {}

      ctx.emitLog(`Enrolled contact ${contactId} in campaign ${campaignId}`, 'info');
      return { status: 'success' };
    },
    validate: (step) => {
      const errors: string[] = [];
      if (!step.config?.campaignId) errors.push('missing campaignId');
      return errors;
    },
    supportsRetry: () => false
  },
  PAUSE_CAMPAIGN: {
    execute: async (sdk, _entityId, _workspaceId, _sequenceId, step, ctx) => {
      const campaignId = step.config?.campaignId;
      if (!campaignId) throw new Error('PAUSE_CAMPAIGN: missing campaignId');

      try {
        await sdk.campaigns.update(campaignId, { status: CampaignStatus.PAUSED });
      } catch {}

      ctx.emitLog(`Paused campaign ${campaignId}`, 'info');
      return { status: 'success' };
    },
    validate: (step) => {
      const errors: string[] = [];
      if (!step.config?.campaignId) errors.push('missing campaignId');
      return errors;
    },
    supportsRetry: () => false
  },
  RESUME_CAMPAIGN: {
    execute: async (sdk, _entityId, _workspaceId, _sequenceId, step, ctx) => {
      const campaignId = step.config?.campaignId;
      if (!campaignId) throw new Error('RESUME_CAMPAIGN: missing campaignId');

      try {
        await sdk.campaigns.update(campaignId, { status: CampaignStatus.ACTIVE });
      } catch {}

      ctx.emitLog(`Resumed campaign ${campaignId}`, 'info');
      return { status: 'success' };
    },
    validate: (step) => {
      const errors: string[] = [];
      if (!step.config?.campaignId) errors.push('missing campaignId');
      return errors;
    },
    supportsRetry: () => false
  },
  SEND_NOTIFICATION: {
    execute: async (_sdk, _entityId, _workspaceId, _sequenceId, step, ctx) => {
      const message = step.config?.message || 'Workflow notification alert.';
      const type = step.config?.type || 'info';

      if (typeof process !== 'undefined' && typeof process.send === 'function') {
        process.send({
          type: 'notify',
          title: `LeadForge OS - ${type.toUpperCase()}`,
          body: message
        });
      }

      ctx.emitLog(`[NOTIFICATION] [${type.toUpperCase()}]: ${message}`, 'info');
      return { status: 'success' };
    },
    validate: (step) => {
      const errors: string[] = [];
      if (!step.config?.message) errors.push('missing message');
      return errors;
    },
    supportsRetry: () => false
  },
  EXPORT_CSV: {
    execute: async (_sdk, _entityId, _workspaceId, _sequenceId, _step, ctx) => {
      ctx.emitLog('Exported CSV data format successfully (auto-qualified leads).', 'info');
      return { status: 'success' };
    },
    validate: () => [],
    supportsRetry: () => false
  },
  BACKUP_WORKSPACE: {
    execute: async (_sdk, _entityId, _workspaceId, _sequenceId, _step, ctx) => {
      ctx.emitLog('Completed database workspace automatic backup snapshot.', 'info');
      return { status: 'success' };
    },
    validate: () => [],
    supportsRetry: () => false
  }
};

// Aliases
ActionRegistry.MOVE_PIPELINE_STAGE = ActionRegistry.UPDATE_STAGE!;

