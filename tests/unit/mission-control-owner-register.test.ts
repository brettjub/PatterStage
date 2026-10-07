/** @jest-environment node */
import { execFile } from 'node:child_process';
import { ownerRegisterSchema, readOwnerRegister, registerSshArguments } from '@/lib/mission-control/owner-register';
jest.mock('node:child_process', () => ({ execFile: jest.fn() }));
const id = '1YOKOBjrY-matyNcaSEg8-NFJAR7433ntas7UKG_jYzI';
const at = '2026-10-06T10:00:00.000Z';
const body = () => ({ schemaVersion: 1, checkedAt: at,
  sheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, decisions: [],
  projects: [{ id: 'ngm', name: 'New Growth Media', outcome: '', recordedState: 'unknown', position: '', blocker: '', nextMove: '' },
    { id: 'launchhost', name: 'Launchhost', outcome: '', recordedState: 'unknown', position: '', blocker: '', nextMove: '' }] });

it('accepts the exact seeded manual source without making it verified', () => {
  expect(ownerRegisterSchema.parse(body())).toEqual(body());
});
it('requires an explicit owner review for a non-unknown project status', () => {
  const b = body();
  expect(ownerRegisterSchema.safeParse({ ...b, projects: [{ ...b.projects[0], recordedState: 'active' }] }).success).toBe(false);
  expect(ownerRegisterSchema.safeParse({ ...b, projects: [{ ...b.projects[0], recordedState: 'active', ownerReviewedAt: at }] }).success).toBe(true);
});
it('rejects duplicate rows, orphaned decisions, unsafe links, extra fields and future data', () => {
  const b = body();
  const decision = { id: 'decision-1', projectId: 'ngm', title: 'Budget', target: 'Exact budget', impact: '', raisedAt: at };
  expect(ownerRegisterSchema.safeParse({ ...b, decisions: [decision] }).success).toBe(true);
  for (const item of [
    { ...b, projects: [b.projects[0], b.projects[0]] },
    { ...b, decisions: [{ ...decision, projectId: 'other' }] },
    { ...b, decisions: [decision, decision] },
    { ...b, sheetUrl: 'https://evil.example/' },
    { ...b, decisions: [{ ...decision, sourceUrl: 'javascript:alert(1)' }] },
    { ...b, decisions: [{ ...decision, sourceUrl: 'https://user:pass@docs.google.com/spreadsheets/d/x/edit' }] },
    { ...b, decisions: [{ ...decision, title: '=IMPORTDATA("x")' }] },
    { ...b, checkedAt: '2099-01-01T00:00:00Z' },
    { ...b, secret: 'should not be emitted' },
  ]) expect(ownerRegisterSchema.safeParse(item).success).toBe(false);
});
it.each(['-oProxyCommand=evil', 'reader@vps.example;id', 'reader@vps.example/path', 'reader@vps.example\n'])('rejects malicious SSH target %s', target => {
  expect(() => registerSshArguments(target)).toThrow();
});
it('does not run without a target', async () => {
  await expect(readOwnerRegister(undefined)).rejects.toThrow('Owner register unavailable');
});
it('uses bounded, no-shell read-only SSH and validates the result', async () => {
  jest.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args[3] as (err: null, output: string) => void;
    callback(null, JSON.stringify(body()));
    return {} as ReturnType<typeof execFile>;
  });
  await expect(readOwnerRegister('reader@vps.example')).resolves.toEqual(body());
  expect(execFile).toHaveBeenCalledWith('/usr/bin/ssh', expect.arrayContaining(['--', 'reader@vps.example', '/home/brettjubinville/bin/export-owner-register.py']),
    expect.objectContaining({ shell: false, maxBuffer: 131072, timeout: 19000, killSignal: 'SIGKILL' }), expect.any(Function));
});
it('sanitizes failed transport', async () => {
  jest.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args[3] as (err: Error) => void;
    callback(new Error('private remote error'));
    return {} as ReturnType<typeof execFile>;
  });
  await expect(readOwnerRegister('reader@vps.example')).rejects.toThrow('Owner register unavailable');
});
