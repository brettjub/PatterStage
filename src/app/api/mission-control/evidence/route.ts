import { NextResponse } from 'next/server';
import { readEvidence } from '@/lib/mission-control/evidence';
import { logApiError } from '@/lib/api-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const evidence = await readEvidence(process.env.MC_EVIDENCE_SSH_TARGET, process.env.MC_EVIDENCE_SSH_REMOTE_SCRIPT);
    return NextResponse.json(evidence, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    logApiError('GET /api/mission-control/evidence', 'reading evidence', new Error('Evidence unavailable'));
    return NextResponse.json({ error: 'Evidence unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
