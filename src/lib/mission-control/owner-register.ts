import { execFile } from 'node:child_process';
import { z } from 'zod';

const SCRIPT = '/home/brettjubinville/bin/export-owner-register.py';
const MAX_BYTES = 131072;
const TIMEOUT_MS = 19000;
const safeText = (max: number) => z.string().max(max).regex(/^[^\x00-\x1f\x7f]*$/).refine(value => !/^\s*=/.test(value));
const id = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/);
const utc = z.string().datetime({ offset: false }).refine(value => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= 0 && ms <= Date.now() + 60000;
});
const sourceUrl = z.string().max(512).refine(value => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return false;
    if (url.hostname === 'docs.google.com') return /^\/(?:document|spreadsheets)\/d\/[A-Za-z0-9_-]+\/edit$/.test(url.pathname);
    if (url.hostname === 'drive.google.com') return /^\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(url.pathname);
    return url.hostname === 'github.com' && /^\/brettjub\/PatterStage\/(?:issues|pull)\/[1-9][0-9]*$/.test(url.pathname);
  } catch { return false; }
});
const decision = z.object({
  id, projectId: id, title: safeText(160).min(1), target: safeText(200).min(1),
  impact: safeText(200), raisedAt: utc, ownerReviewedAt: utc.optional(), sourceUrl: sourceUrl.optional(),
}).strict();
const project = z.object({
  id, name: safeText(160).min(1), outcome: safeText(200),
  recordedState: z.enum(['active', 'paused', 'idea', 'unknown']),
  position: safeText(200), blocker: safeText(200), nextMove: safeText(200),
  ownerReviewedAt: utc.optional(), sourceUrl: sourceUrl.optional(),
}).strict().refine(row => row.recordedState === 'unknown' || Boolean(row.ownerReviewedAt), 'Status requires owner review');
export const ownerRegisterSchema = z.object({
  schemaVersion: z.literal(1), checkedAt: utc,
  sheetUrl: z.string().max(150).regex(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,100}\/edit$/),
  decisions: z.array(decision).max(100), projects: z.array(project).max(50),
}).strict().superRefine((value, ctx) => {
  const projectIds = new Set(value.projects.map(row => row.id));
  if (projectIds.size !== value.projects.length || new Set(value.decisions.map(row => row.id)).size !== value.decisions.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate register IDs' });
  if (value.decisions.some(row => !projectIds.has(row.projectId)))
    ctx.addIssue({ code: 'custom', message: 'Decision missing project' });
  if (value.decisions.some(row => Date.parse(row.raisedAt) > Date.parse(value.checkedAt) + 60000) ||
      [...value.decisions, ...value.projects].some(row => row.ownerReviewedAt && Date.parse(row.ownerReviewedAt) > Date.parse(value.checkedAt) + 60000))
    ctx.addIssue({ code: 'custom', message: 'Row timestamp after read' });
});

export function registerSshArguments(target: string | undefined): string[] {
  if (!target || target.length > 253 ||
      !/^[a-z_][a-z0-9_-]*@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(target) || target.includes('..'))
    throw new Error('Owner register unavailable');
  return ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=5',
    '-o', 'ServerAliveCountMax=2', '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no',
    '-o', 'IdentitiesOnly=yes', '--', target, SCRIPT];
}

export async function readOwnerRegister(target: string | undefined) {
  const args = registerSshArguments(target);
  const output = await new Promise<string>((resolve, reject) => {
    execFile('/usr/bin/ssh', args, { timeout: TIMEOUT_MS, maxBuffer: MAX_BYTES, encoding: 'utf8',
      shell: false, killSignal: 'SIGKILL' }, (error, stdout) => {
      if (error) reject(new Error('Owner register unavailable'));
      else resolve(stdout);
    });
  });
  if (Buffer.byteLength(output) > MAX_BYTES) throw new Error('Owner register unavailable');
  return ownerRegisterSchema.parse(JSON.parse(output));
}
