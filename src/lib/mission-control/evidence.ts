import { execFile } from 'node:child_process';
import { z } from 'zod';

export const MAX_ITEMS = 100;
export const MAX_BYTES = 262144;
export const TIMEOUT_MS = 25000;
const text = (max: number) => z.string().min(1).max(max).regex(/^[^\x00-\x1f\x7f]*$/);
const timestamp = z.string().datetime({ offset: false }).refine(value => {
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.now() + 60000 && time >= 0;
});
const item = z.object({
  id: text(128).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(['task', 'run', 'pull_request', 'document']),
  title: text(160), status: text(64), observedAt: timestamp,
  url: z.string().max(512).refine(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && (
        (url.hostname === 'github.com' && /^\/brettjub\/PatterStage\/pull\/[1-9][0-9]*$/.test(url.pathname)) ||
        (url.hostname === 'drive.google.com' && /^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(url.pathname))
      );
    } catch { return false; }
  }).optional(),
  project: z.literal('PatterStage').optional(), note: text(200).optional(),
}).strict();
const source = z.object({
  id: z.enum(['hermes', 'github', 'drive']), status: z.enum(['live', 'unavailable']),
  checkedAt: timestamp.nullable(), items: z.array(item).max(MAX_ITEMS),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'unavailable' ? value.checkedAt !== null || value.items.length !== 0 : value.checkedAt === null)
    ctx.addIssue({ code: 'custom', message: 'Invalid source state' });
  if (new Set(value.items.map(entry => entry.id)).size !== value.items.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate items' });
  for (const entry of value.items) {
    if ((value.id === 'github' && entry.kind !== 'pull_request') || (value.id === 'drive' && entry.kind !== 'document') ||
        (value.id === 'hermes' && !['task', 'run'].includes(entry.kind)) ||
        (value.checkedAt && Date.parse(entry.observedAt) > Date.parse(value.checkedAt)))
      ctx.addIssue({ code: 'custom', message: 'Invalid source item' });
  }
});
export const evidenceSchema = z.object({
  schemaVersion: z.literal(1), checkedAt: timestamp, sources: z.array(source).length(3),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.sources.map(entry => entry.id)).size !== 3 ||
      new Set(value.sources.flatMap(entry => entry.items.map(record => record.id))).size !== value.sources.reduce((sum, entry) => sum + entry.items.length, 0) ||
      value.sources.some(entry => entry.checkedAt && Date.parse(entry.checkedAt) > Date.parse(value.checkedAt)))
    ctx.addIssue({ code: 'custom', message: 'Invalid snapshot' });
});

export function sshArguments(target: string | undefined, script: string | undefined): string[] {
  if (!target || !script || target.length > 253 || script.length > 256 ||
      !/^[a-z_][a-z0-9_-]*@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(target) ||
      target.includes('..') || !/^\/(?:[A-Za-z0-9_-]+\/)*export-mission-evidence\.py$/.test(script))
    throw new Error('Evidence unavailable');
  // Keep the operator's SSH config: it selects the dedicated key and pins the host.
  return ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=2', '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no',
    '-o', 'IdentitiesOnly=yes', '--', target, script];
}

export async function readEvidence(target: string | undefined, script: string | undefined) {
  const args = sshArguments(target, script);
  const output = await new Promise<string>((resolve, reject) => {
    execFile('/usr/bin/ssh', args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BYTES, encoding: 'utf8',
      shell: false, killSignal: 'SIGKILL' }, (error, stdout) => {
      if (error) reject(new Error('Evidence unavailable'));
      else resolve(stdout);
    });
  });
  if (Buffer.byteLength(output) > MAX_BYTES) throw new Error('Evidence unavailable');
  return evidenceSchema.parse(JSON.parse(output));
}
