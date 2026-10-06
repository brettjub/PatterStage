/** @jest-environment node */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { readAgentSnapshot, sshArguments, validateSnapshot } from '@/lib/mission-control/agent-snapshot';
import { GET } from '@/app/api/mission-control/agents/route';

const snapshot = () => {
  const checkedAt = new Date().toISOString();
  return { schemaVersion: 1, checkedAt, source: 'vps-agent-snapshot', agents: [{ id: 'codex', name: 'Codex', runtime: 'codex', availability: 'unknown', run: null, stamp: { source: 'vps-agent-snapshot', kind: 'live', checkedAt, staleAfterMinutes: 1 } }] };
};
function fakeLaunch(action: (child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: jest.Mock }) => void) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: jest.fn() });
  const launch = jest.fn(() => { queueMicrotask(() => action(child)); return child; });
  return { launch: launch as unknown as typeof spawn, child, mock: launch };
}
const target = 'observer@vps-alias';
const script = '/opt/mission-control/export-agent-snapshot.py';

test('configuration is disabled by default and rejects shell syntax', () => {
  expect(() => sshArguments(undefined, undefined)).toThrow();
  for (const bad of ['-host', 'host;id', 'host x', '$(id)', 'user@host\n']) expect(() => sshArguments(bad, script)).toThrow();
  for (const bad of ['relative.py', '/opt/../export-agent-snapshot.py', '/tmp/$(id)/export-agent-snapshot.py', '/tmp/other.py']) expect(() => sshArguments(target, bad)).toThrow();
});
test('strict schema, timestamps, identity and freshness', () => {
  expect(validateSnapshot(JSON.stringify(snapshot())).agents[0].run).toBeNull();
  const smallSkew = snapshot();
  smallSkew.checkedAt = new Date(Date.now() + 20_000).toISOString();
  smallSkew.agents[0].stamp.checkedAt = smallSkew.checkedAt;
  expect(validateSnapshot(JSON.stringify(smallSkew))).toHaveProperty('schemaVersion', 1);
  for (const change of [{ checkedAt: new Date(Date.now() + 60000).toISOString() }, { checkedAt: '2026-02-30T00:00:00Z' }, { checkedAt: new Date(Date.now() - 60000).toISOString() }, { secret: 'no' }, { agents: [] }]) expect(() => validateSnapshot(JSON.stringify({ ...snapshot(), ...change }))).toThrow();
  const value = snapshot();
  value.agents.push(value.agents[0]);
  expect(() => validateSnapshot(JSON.stringify(value))).toThrow();
});
test('spawn uses literal arguments and safe SSH options', async () => {
  const fake = fakeLaunch(c => { c.stdout.write(JSON.stringify(snapshot())); c.emit('close', 0); });
  await expect(readAgentSnapshot(target, script, fake.launch)).resolves.toHaveProperty('schemaVersion', 1);
  expect(fake.mock).toHaveBeenCalledWith('ssh', sshArguments(target, script), { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
});
test.each(['malformed', 'exit', 'error', 'overflow', 'stderr'])('rejects %s without remote details', async mode => {
  const fake = fakeLaunch(c => {
    if (mode === 'error') c.emit('error', new Error('secret'));
    else { (mode === 'stderr' ? c.stderr : c.stdout).write(mode === 'overflow' || mode === 'stderr' ? 'x'.repeat(32769) : 'secret'); c.emit('close', mode === 'exit' ? 1 : 0); }
  });
  await expect(readAgentSnapshot(target, script, fake.launch)).rejects.toThrow('Agent snapshot unavailable');
});
test('hard timeout kills hung SSH', async () => {
  jest.useFakeTimers();
  const fake = fakeLaunch(() => {});
  const promise = readAgentSnapshot(target, script, fake.launch);
  const rejected = expect(promise).rejects.toThrow('Agent snapshot unavailable');
  jest.advanceTimersByTime(8000);
  await rejected;
  expect(fake.child.kill).toHaveBeenCalledWith('SIGKILL');
  jest.useRealTimers();
});
test('disabled route returns sanitized no-store 503', async () => {
  const prior = process.env.MC_AGENT_SSH_TARGET;
  delete process.env.MC_AGENT_SSH_TARGET;
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Agent snapshot unavailable' });
  } finally { if (prior !== undefined) process.env.MC_AGENT_SSH_TARGET = prior; log.mockRestore(); }
});
