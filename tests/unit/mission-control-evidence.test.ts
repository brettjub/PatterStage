/** @jest-environment node */
import { execFile } from 'node:child_process';
import { evidenceSchema, readEvidence, sshArguments, MAX_BYTES, TIMEOUT_MS } from '@/lib/mission-control/evidence';
jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
const time = '2026-01-01T00:00:00.000Z';
const fixture = () => ({ schemaVersion: 1, checkedAt: time, sources: ['hermes', 'github', 'drive'].map(id => ({ id, status: 'unavailable', checkedAt: null, items: [] })) });
it('accepts exactly the agreed contract', () => expect(evidenceSchema.parse(fixture())).toEqual(fixture()));
it.each(['-oProxyCommand=evil', 'user@host;id', 'user@host/path', 'user@host\n'])('rejects target %s before execution', target => {
  expect(() => sshArguments(target, '/opt/export-mission-evidence.py')).toThrow();
});
it.each(['/tmp/a;id/export-mission-evidence.py', '/tmp/../export-mission-evidence.py', 'relative', '/tmp/export-mission-evidence.py x'])('rejects command %s', script => {
  expect(() => sshArguments('reader@vps.example', script)).toThrow();
});
it('disabled without configuration', async () => expect(readEvidence(undefined, undefined)).rejects.toThrow());
it('uses bounded no-shell SSH and validates returned JSON', async () => {
  jest.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args[3] as (error: null, stdout: string) => void;
    callback(null, JSON.stringify(fixture()));
    return {} as ReturnType<typeof execFile>;
  });
  await expect(readEvidence('reader@vps.example', '/opt/export-mission-evidence.py')).resolves.toEqual(fixture());
  expect(execFile).toHaveBeenCalledWith('/usr/bin/ssh', expect.arrayContaining(['BatchMode=yes', 'StrictHostKeyChecking=yes', '--']),
    expect.objectContaining({ shell: false, timeout: TIMEOUT_MS, maxBuffer: MAX_BYTES, killSignal: 'SIGKILL' }), expect.any(Function));
});
it('rejects duplicate sources, unknown fields, future timestamps and inconsistent unavailable state', () => {
  const value = fixture();
  value.sources[1].id = 'hermes';
  expect(evidenceSchema.safeParse(value).success).toBe(false);
  expect(evidenceSchema.safeParse({ ...fixture(), secret: 'bad' }).success).toBe(false);
  expect(evidenceSchema.safeParse({ ...fixture(), checkedAt: '2099-01-01T00:00:00Z' }).success).toBe(false);
  value.sources[0].checkedAt = time;
  expect(evidenceSchema.safeParse(value).success).toBe(false);
});
it('rejects excessive records, duplicate IDs, invalid kinds, URLs and timestamps', () => {
  const record = { id: 'github-pr-1', kind: 'pull_request', title: 'Title', status: 'open', observedAt: time, url: 'https://github.com/brettjub/PatterStage/pull/1' };
  const parse = (items: unknown[]) => evidenceSchema.safeParse({ ...fixture(), sources: [fixture().sources[0], { id: 'github', status: 'live', checkedAt: time, items }, fixture().sources[2]] }).success;
  expect(parse([record])).toBe(true);
  for (const patch of [{ url: 'https://evil.example/' }, { observedAt: 'invalid' }, { kind: 'document' }, { status: 'a'.repeat(65) }, { title: 'bad\nname' }]) expect(parse([{ ...record, ...patch }])).toBe(false);
  expect(parse([record, record])).toBe(false);
  expect(parse(Array(101).fill(record))).toBe(false);
});
it('sanitizes transport errors', async () => {
  jest.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args[3] as (error: Error) => void;
    callback(new Error('private remote error'));
    return {} as ReturnType<typeof execFile>;
  });
  await expect(readEvidence('reader@vps.example', '/opt/export-mission-evidence.py')).rejects.toThrow('Evidence unavailable');
});
