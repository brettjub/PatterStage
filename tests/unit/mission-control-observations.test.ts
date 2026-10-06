import { normalizeObservation, utcTimestamp, formatOwnerTimestamp, OWNER_TIME_ZONE, type AdapterObservation } from '@/lib/mission-control/observations';

const at = '2026-10-06T21:30:00Z';
const now = '2026-10-06T21:30:10Z';
function fixture(overrides: Partial<AdapterObservation> = {}): AdapterObservation {
  return { schemaVersion: 1, eventId: 'event-1', agentId: 'synthetic-worker', runtime: 'codex', source: 'fixture', checkedAt: at, observedAt: at, lastSuccessfulAt: at, staleAfterMs: 60000, evidenceRef: 'fixture:event-1', connector: { status: 'ok', coverage: 'complete', confidence: 'observed' }, availability: 'running', runState: 'running', taskState: 'blocked', assignment: { taskId: 'task-1', runId: 'run-1', label: 'Synthetic task', provenance: { kind: 'run', id: 'run-1', evidenceRef: 'fixture:run-1', observedAt: at } }, ...overrides };
}

describe('mission control observations (synthetic only)', () => {
  test('separates runtime, run and task state without inventing usage', () => {
    const result = normalizeObservation(fixture(), now);
    expect([result.availability, result.runState, result.taskState]).toEqual(['running', 'running', 'blocked']);
    expect(result.currentAssignment?.runId).toBe('run-1');
    expect(result.usage).toBeNull();
    expect(result.lastSuccessfulAt).toBe('2026-10-06T21:30:00.000Z');
  });
  test.each(['running', 'idle', 'paused', 'offline', 'unknown'])('supports explicit %s availability', availability => {
    expect(normalizeObservation(fixture({ availability }), now).availability).toBe(availability);
  });
  test('observed worker loss does not leave an active run or task assignment', () => {
    const result = normalizeObservation(fixture({ availability: 'offline' }), now);
    expect(result.availability).toBe('offline');
    expect(result.runState).toBe('unknown');
    expect(result.currentAssignment).toBeNull();
    expect(result.historicalAssignment?.runId).toBe('run-1');
  });
  test('pausing dispatch does not cancel an observed run', () => {
    const result = normalizeObservation(fixture({ availability: 'paused' }), now);
    expect(result.runState).toBe('running');
    expect(result.currentAssignment).not.toBeNull();
  });
  test('missed polls expire at the threshold and retain historical assignment', () => {
    const result = normalizeObservation(fixture(), '2026-10-06T21:31:00Z');
    expect(result.availability).toBe('stale');
    expect(result.runState).toBe('unknown');
    expect(result.currentAssignment).toBeNull();
    expect(result.historicalAssignment?.taskId).toBe('task-1');
  });
  test.each(['partial', 'failed'] as const)('%s connector never supplies current success or idle', status => {
    const prior = normalizeObservation(fixture(), now);
    const result = normalizeObservation(fixture({ checkedAt: '2026-10-06T21:30:20Z', observedAt: '2026-10-06T21:30:20Z', lastSuccessfulAt: '2026-10-06T21:30:20Z', connector: { status, coverage: 'partial', confidence: 'unknown', error: 'synthetic failure' }, availability: 'idle', runState: 'succeeded', assignment: undefined }), '2026-10-06T21:30:25Z', prior);
    expect(result.availability).toBe('unknown');
    expect(result.runState).toBe('unknown');
    expect(result.currentAssignment).toBeNull();
    expect(result.historicalAssignment?.runId).toBe('run-1');
    if (status === 'failed') expect(result.lastSuccessfulAt).toBe(prior.lastSuccessfulAt);
  });
  test.each(['checkedAt', 'observedAt', 'lastSuccessfulAt'] as const)('missing or malformed %s cannot imply idle', key => {
    for (const value of [undefined, 'bad', '2026-10-06T21:30:00']) {
      expect(normalizeObservation(fixture({ [key]: value, availability: 'idle' }), now).availability).toBe('unknown');
    }
  });
  test('rejects future and inconsistent evidence timestamps', () => {
    expect(normalizeObservation(fixture({ observedAt: '2026-10-07T21:30:00Z' }), now).availability).toBe('unknown');
    expect(normalizeObservation(fixture({ lastSuccessfulAt: '2026-10-06T21:29:00Z' }), now).availability).toBe('unknown');
  });
  test('late and conflicting same-time events do not regress accepted state', () => {
    const prior = normalizeObservation(fixture(), now);
    for (const observedAt of ['2026-10-06T21:29:00Z', at]) {
      const result = normalizeObservation(fixture({ observedAt, availability: 'idle', assignment: undefined }), now, prior);
      expect(result.availability).toBe('running');
      expect(result.currentAssignment?.runId).toBe('run-1');
      expect(result.issues.length).toBeGreaterThan(0);
    }
    expect(normalizeObservation(fixture(), now, prior)).toEqual(normalizeObservation(fixture(), now, prior));
  });
  test('new observed idle clears current assignment without erasing history', () => {
    const prior = normalizeObservation(fixture(), now);
    const later = '2026-10-06T21:30:20Z';
    const result = normalizeObservation(fixture({ observedAt: later, checkedAt: later, lastSuccessfulAt: later, availability: 'idle', assignment: undefined }), later, prior);
    expect(result.availability).toBe('idle');
    expect(result.currentAssignment).toBeNull();
    expect(result.historicalAssignment?.runId).toBe('run-1');
  });
  test('unexpected states remain unknown, with diagnostics', () => {
    const result = normalizeObservation(fixture({ availability: 'busy-ish', taskState: 'done-ish', runState: 'victory' }), now);
    expect([result.availability, result.taskState, result.runState]).toEqual(['unknown', 'unknown', 'unknown']);
    expect(result.issues).toContain('unexpected_availability');
  });
  test('expiry and malformed expiry fail conservatively', () => {
    for (const expiresAt of [at, 'bad']) expect(normalizeObservation(fixture({ expiresAt }), now).availability).toBe('stale');
  });
  test('expired lease preserves assignment as historical only', () => {
    const input = fixture();
    input.assignment!.provenance = { ...input.assignment!.provenance, kind: 'lease', expiresAt: at };
    const result = normalizeObservation(input, now);
    expect(result.currentAssignment).toBeNull();
    expect(result.historicalAssignment?.provenance.kind).toBe('lease');
    expect(result.runState).toBe('unknown');
  });
  test('branch/task labels cannot establish assignment without observed provenance', () => {
    const input = fixture();
    input.assignment!.provenance.evidenceRef = '';
    const result = normalizeObservation(input, now);
    expect(result.currentAssignment).toBeNull();
    expect(result.historicalAssignment).toBeNull();
  });
  test('old assignment evidence and mismatched run identity are never current', () => {
    const old = fixture();
    old.assignment!.provenance.observedAt = '2026-10-06T21:28:00Z';
    expect(normalizeObservation(old, now).currentAssignment).toBeNull();
    const mismatch = fixture();
    mismatch.assignment!.provenance.id = 'different-run';
    expect(normalizeObservation(mismatch, now).historicalAssignment).toBeNull();
  });
  test('terminal run evidence does not imply task completion or current work', () => {
    const result = normalizeObservation(fixture({ runState: 'succeeded', taskState: 'awaiting_review' }), now);
    expect(result.taskState).toBe('awaiting_review');
    expect(result.currentAssignment).toBeNull();
  });
  test('missing usage differs from observed zero; invalid values are omitted', () => {
    expect(normalizeObservation(fixture({ usage: { tokens: 0, cost: { amount: 0, currency: 'CAD' } } }), now).usage?.tokens).toBe(0);
    expect(normalizeObservation(fixture({ usage: { tokens: -1, cost: { amount: NaN, currency: 'CAD' } } }), now).usage).toBeNull();
  });
  test('normalizes offsets and rejects impossible dates', () => {
    expect(utcTimestamp('2026-10-06T15:30:00-06:00')).toBe('2026-10-06T21:30:00.000Z');
    expect(utcTimestamp('2026-02-30T00:00:00Z')).toBeNull();
    expect(utcTimestamp('2026-10-06T24:00:00Z')).toBeNull();
  });
  test('owner display uses Edmonton daylight and standard time', () => {
    expect(OWNER_TIME_ZONE).toBe('America/Edmonton');
    expect(formatOwnerTimestamp('2026-07-01T18:00:00Z')).toMatch(/12:00:00/);
    expect(formatOwnerTimestamp('2026-12-01T18:00:00Z')).toMatch(/11:00:00/);
    expect(formatOwnerTimestamp('bad')).toBeNull();
  });
  test('rejects invalid clocks and cross-source history; leaves inputs unchanged', () => {
    const input = fixture();
    const snapshot = JSON.stringify(input);
    const prior = normalizeObservation(input, now);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(() => normalizeObservation(input, 'bad')).toThrow();
    expect(() => normalizeObservation({ ...input, source: 'other' }, now, prior)).toThrow();
  });
});
