/** Pure observation boundary: adapters supply evidence; this module performs no I/O. */
export type Availability = 'running' | 'idle' | 'paused' | 'offline' | 'unknown' | 'stale';
export type RunState = 'queued' | 'running' | 'waiting_for_approval' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';
export type TaskState = 'backlog' | 'ready' | 'in_progress' | 'awaiting_review' | 'completed' | 'blocked' | 'cancelled' | 'unknown';
export interface AssignmentInput {
  taskId: string;
  runId: string;
  label?: string;
  provenance: { kind: 'run' | 'lease'; id: string; evidenceRef: string; observedAt: string; expiresAt?: string };
}
export interface AdapterObservation {
  schemaVersion: 1;
  eventId: string;
  agentId: string;
  runtime: 'hermes' | 'claude' | 'codex';
  source: string;
  checkedAt?: string;
  /** Time the runtime evidence was observed, distinct from polling completion. */
  observedAt?: string;
  lastSuccessfulAt?: string;
  expiresAt?: string;
  staleAfterMs: number;
  evidenceRef?: string;
  connector: { status: 'ok' | 'partial' | 'failed'; coverage: 'complete' | 'partial' | 'none'; confidence: 'observed' | 'reported' | 'unknown'; error?: string };
  availability?: string;
  runState?: string;
  taskState?: string;
  assignment?: AssignmentInput;
  usage?: { tokens?: number; cost?: { amount: number; currency: string } };
}
export interface Observation {
  agentId: string;
  runtime: AdapterObservation['runtime'];
  source: string;
  checkedAt: string | null;
  lastSuccessfulAt: string | null;
  availability: Availability;
  runState: RunState;
  taskState: TaskState;
  currentAssignment: AssignmentInput | null;
  historicalAssignment: AssignmentInput | null;
  /** Latest accepted source event; retained even when a later poll fails. */
  lastKnown: AdapterObservation | null;
  connector: AdapterObservation['connector'];
  expiresAt: string | null;
  evidenceRef: string | null;
  usage: AdapterObservation['usage'] | null;
  issues: string[];
}

/** Accept explicit RFC3339 offsets only; reject normalized impossible calendar dates. */
export function utcTimestamp(value?: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, offset] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
const availabilityStates: readonly string[] = ['running', 'idle', 'paused', 'offline', 'unknown'];
const runStates: readonly string[] = ['queued', 'running', 'waiting_for_approval', 'succeeded', 'failed', 'cancelled', 'interrupted', 'unknown'];
const taskStates: readonly string[] = ['backlog', 'ready', 'in_progress', 'awaiting_review', 'completed', 'blocked', 'cancelled', 'unknown'];
const activeRuns: readonly string[] = ['queued', 'running', 'waiting_for_approval'];

/** Caller supplies now and the prior result for the same agent/source. No implicit clock. */
export function normalizeObservation(input: AdapterObservation, now: string, previous?: Observation): Observation {
  const clock = utcTimestamp(now);
  if (!clock) throw new Error('now must be an explicit RFC3339 timestamp');
  if (previous && (previous.agentId !== input.agentId || previous.source !== input.source || previous.runtime !== input.runtime)) throw new Error('Previous observation must belong to the same agent/runtime/source');
  const issues: string[] = [];
  const timestamp = (name: string, value?: string): string | null => {
    const parsed = utcTimestamp(value);
    if (value !== undefined && !parsed) issues.push('invalid_' + name);
    if (parsed && parsed > clock) { issues.push('future_' + name); return null; }
    return parsed;
  };
  const checkedAt = timestamp('checkedAt', input.checkedAt);
  const observedAt = timestamp('observedAt', input.observedAt);
  const success = timestamp('lastSuccessfulAt', input.lastSuccessfulAt);
  const prior = previous?.lastKnown ?? null;
  const priorTime = utcTimestamp(prior?.observedAt);
  const ordered = !!observedAt && (!priorTime || observedAt > priorTime);
  if (priorTime && observedAt && observedAt <= priorTime) issues.push(observedAt === priorTime ? 'duplicate_or_conflicting_event' : 'out_of_order_event');
  const validTimes = !!checkedAt && !!observedAt && !!success && observedAt <= success && success <= checkedAt;
  if (!validTimes) issues.push('missing_or_inconsistent_timestamps');
  const accept = ordered && validTimes && input.connector.status !== 'failed' && input.connector.coverage !== 'none';
  const lastKnown = accept ? {
    ...input, checkedAt: checkedAt!, observedAt: observedAt!, lastSuccessfulAt: success!,
    ...(input.expiresAt ? { expiresAt: utcTimestamp(input.expiresAt) ?? input.expiresAt } : {}),
    connector: { ...input.connector },
    ...(input.assignment ? { assignment: { ...input.assignment, provenance: {
      ...input.assignment.provenance,
      observedAt: utcTimestamp(input.assignment.provenance.observedAt) ?? input.assignment.provenance.observedAt,
      ...(input.assignment.provenance.expiresAt ? { expiresAt: utcTimestamp(input.assignment.provenance.expiresAt) ?? input.assignment.provenance.expiresAt } : {}),
    } } } : {}),
    ...(input.usage ? { usage: { ...input.usage, ...(input.usage.cost ? { cost: { ...input.usage.cost } } : {}) } } : {}),
  } : prior;
  const lastSuccessfulAt = accept ? success : previous?.lastSuccessfulAt ?? null;
  const expiresAt = utcTimestamp(lastKnown?.expiresAt);
  const threshold = lastKnown?.staleAfterMs ?? input.staleAfterMs;
  const validThreshold = Number.isFinite(threshold) && threshold > 0;
  if (!validThreshold) issues.push('invalid_staleAfterMs');
  const invalidExpiry = lastKnown?.expiresAt !== undefined && !expiresAt;
  if (invalidExpiry) issues.push('invalid_expiresAt');
  const evidenceTime = utcTimestamp(lastKnown?.observedAt);
  const stale = !!evidenceTime && (!validThreshold || invalidExpiry || Date.parse(clock) - Date.parse(evidenceTime) >= threshold || (!!expiresAt && expiresAt <= clock));
  const complete = input.connector.status === 'ok' && input.connector.coverage === 'complete';
  const leaseExpiry = lastKnown?.assignment?.provenance.kind === 'lease' ? utcTimestamp(lastKnown.assignment.provenance.expiresAt) : null;
  const leaseExpired = !!leaseExpiry && leaseExpiry <= clock;
  if (leaseExpired) issues.push('expired_lease');
  const usable = !!lastKnown && validTimes && complete && !stale && !leaseExpired;
  const rawAvailability = lastKnown?.availability;
  if (rawAvailability && !availabilityStates.includes(rawAvailability)) issues.push('unexpected_availability');
  const availability: Availability = stale ? 'stale' : usable && availabilityStates.includes(rawAvailability ?? '') ? rawAvailability as Availability : 'unknown';
  const rawRun = lastKnown?.runState;
  const rawTask = lastKnown?.taskState;
  if (rawRun && !runStates.includes(rawRun)) issues.push('unexpected_runState');
  if (rawTask && !taskStates.includes(rawTask)) issues.push('unexpected_taskState');
  const runState: RunState = usable && runStates.includes(rawRun ?? '') && !(availability === 'offline' && activeRuns.includes(rawRun ?? '')) ? rawRun as RunState : 'unknown';
  const taskState: TaskState = usable && taskStates.includes(rawTask ?? '') ? rawTask as TaskState : 'unknown';
  const candidate = lastKnown?.assignment;
  let assignment: AssignmentInput | null = null;
  if (candidate) {
    const at = utcTimestamp(candidate.provenance.observedAt);
    const expiry = utcTimestamp(candidate.provenance.expiresAt);
    if (candidate.taskId && candidate.runId && candidate.provenance.id && (candidate.provenance.kind !== 'run' || candidate.provenance.id === candidate.runId) && candidate.provenance.evidenceRef && ['run', 'lease'].includes(candidate.provenance.kind) && at && evidenceTime && at <= evidenceTime && (candidate.provenance.expiresAt === undefined || expiry)) {
      assignment = { ...candidate, provenance: { ...candidate.provenance, observedAt: at, ...(expiry ? { expiresAt: expiry } : {}) } };
    } else issues.push('invalid_assignment_provenance');
  }
  const currentAssignment = usable && (availability === 'running' || availability === 'paused') && activeRuns.includes(runState) && assignment && Date.parse(clock) - Date.parse(assignment.provenance.observedAt) < threshold && (!assignment.provenance.expiresAt || assignment.provenance.expiresAt > clock) ? assignment : null;
  const usage = lastKnown?.usage;
  const tokens = usage?.tokens;
  const cost = usage?.cost;
  const validTokens = tokens !== undefined && Number.isFinite(tokens) && tokens >= 0 && Number.isInteger(tokens);
  const validCost = cost !== undefined && Number.isFinite(cost.amount) && cost.amount >= 0 && /^[A-Z]{3}$/.test(cost.currency);
  if ((tokens !== undefined && !validTokens) || (cost !== undefined && !validCost)) issues.push('invalid_usage');
  return {
    agentId: input.agentId, runtime: input.runtime, source: input.source,
    checkedAt: checkedAt && (!previous?.checkedAt || checkedAt > previous.checkedAt) ? checkedAt : previous?.checkedAt ?? null,
    lastSuccessfulAt, availability, runState, taskState, currentAssignment,
    historicalAssignment: assignment ?? previous?.historicalAssignment ?? null,
    lastKnown, connector: { ...input.connector }, expiresAt, evidenceRef: lastKnown?.evidenceRef ?? null,
    usage: validTokens || validCost ? { ...(validTokens ? { tokens } : {}), ...(validCost ? { cost: { ...cost } } : {}) } : null,
    issues,
  };
}

export const OWNER_TIME_ZONE = 'America/Edmonton';
export function formatOwnerTimestamp(value: string): string | null {
  const utc = utcTimestamp(value);
  return utc ? new Intl.DateTimeFormat('en-CA', { timeZone: OWNER_TIME_ZONE, dateStyle: 'medium', timeStyle: 'long' }).format(new Date(utc)) : null;
}
