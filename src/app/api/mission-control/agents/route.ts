import { NextResponse } from 'next/server';
import { readAgentSnapshot } from '@/lib/mission-control/agent-snapshot';
import { logApiError } from '@/lib/api-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await readAgentSnapshot(process.env.MC_AGENT_SSH_TARGET, process.env.MC_AGENT_SSH_REMOTE_SCRIPT);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    logApiError('GET /api/mission-control/agents', 'reading snapshot', new Error('Agent snapshot unavailable'));
    return NextResponse.json({ error: 'Agent snapshot unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
