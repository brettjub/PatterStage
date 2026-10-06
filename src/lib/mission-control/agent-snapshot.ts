/** Server-side SSH adapter. Never import this module into client components. */
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { utcTimestamp } from './observations';

const safeText = z.string().min(1).max(256).regex(/^[\x20-\x7e]+$/);
const timestamp = z.string().refine((value) => utcTimestamp(value) !== null);
const agentSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  name: safeText,
  runtime: z.enum(['claude', 'codex', 'hermes']),
  availability: z.enum(['running', 'idle', 'paused', 'offline', 'unknown']),
  run: z.null(),
  note: safeText.optional(),
  stamp: z.object({ source: safeText, kind: z.literal('live'), checkedAt: timestamp, staleAfterMinutes: z.literal(1) }).strict(),
}).strict();
const snapshotSchema = z.object({ schemaVersion: z.literal(1), checkedAt: timestamp, source: safeText, agents: z.array(agentSchema).min(1).max(16) }).strict();
export type AgentSnapshot = z.infer<typeof snapshotSchema>;

export function validateSnapshot(raw: string, now = Date.now()): AgentSnapshot {
  const result = snapshotSchema.parse(JSON.parse(raw));
  const checked = Date.parse(result.checkedAt);
  // A small bounded clock skew is tolerated; the UI applies the same 30s allowance.
  if (checked > now + 30_000 || now - checked >= 60_000 || new Set(result.agents.map(a => a.id)).size !== result.agents.length) throw new Error('Invalid snapshot');
  for (const agent of result.agents) {
    if (agent.stamp.source !== result.source || agent.stamp.checkedAt !== result.checkedAt) throw new Error('Invalid snapshot');
  }
  return result;
}

export function sshArguments(target: string | undefined, script: string | undefined): string[] {
  if (!target || !script) throw new Error('Bridge disabled');
  if (target.length > 253 || !/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*$/.test(target)) throw new Error('Invalid bridge configuration');
  // Remote ssh commands pass through a shell: permit only literal safe path segments.
  if (script.length > 512 || !/^\/(?:[A-Za-z0-9_][A-Za-z0-9_.-]*\/)*export-agent-snapshot\.py$/.test(script) || script.split('/').some(p => p === '.' || p === '..')) throw new Error('Invalid bridge configuration');
  return ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', '-o', 'ClearAllForwardings=yes', target, script];
}

export function readAgentSnapshot(target: string | undefined, script: string | undefined, launch: typeof spawn = spawn): Promise<AgentSnapshot> {
  const args = sshArguments(target, script);
  return new Promise((resolve, reject) => {
    const child = launch('ssh', args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let bytes = 0;
    let settled = false;
    const finish = (value?: AgentSnapshot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (value) resolve(value); else reject(new Error('Agent snapshot unavailable'));
    };
    const stop = () => { child.kill('SIGKILL'); finish(); };
    const timer = setTimeout(stop, 8000);
    child.stdout?.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 32768) { stop(); return; }
      output += chunk.toString('utf8');
    });
    // Consume stderr without retaining or logging it; bound combined output.
    child.stderr?.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 32768) stop(); });
    child.on('error', () => finish());
    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) { finish(); return; }
      try { finish(validateSnapshot(output)); } catch { finish(); }
    });
  });
}
