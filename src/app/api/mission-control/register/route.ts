import { NextResponse } from 'next/server';
import { readOwnerRegister } from '@/lib/mission-control/owner-register';
import { logApiError } from '@/lib/api-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const register = await readOwnerRegister(process.env.MC_EVIDENCE_SSH_TARGET);
    return NextResponse.json(register, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    logApiError('GET /api/mission-control/register', 'reading owner register', new Error('Owner register unavailable'));
    return NextResponse.json({ error: 'Owner register unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
