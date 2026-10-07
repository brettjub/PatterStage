/** @jest-environment node */
import { GET } from '@/app/api/mission-control/register/route';
import { readOwnerRegister } from '@/lib/mission-control/owner-register';
jest.mock('@/lib/mission-control/owner-register', () => ({ readOwnerRegister: jest.fn() }));
jest.mock('@/lib/api-logger', () => ({ logApiError: jest.fn() }));

it('returns the read-only register contract with no-store and existing SSH target', async () => {
  const payload = { schemaVersion: 1, checkedAt: '2026-10-06T10:00:00Z', sheetUrl: 'https://docs.google.com/spreadsheets/d/abc/edit', decisions: [], projects: [] };
  jest.mocked(readOwnerRegister).mockResolvedValue(payload as Awaited<ReturnType<typeof readOwnerRegister>>);
  process.env.MC_EVIDENCE_SSH_TARGET = 'reader@vps.example';
  try {
    const response = await GET();
    expect(readOwnerRegister).toHaveBeenCalledWith('reader@vps.example');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(payload);
  } finally { delete process.env.MC_EVIDENCE_SSH_TARGET; }
});
it('returns only a sanitized unavailable response after a failed read', async () => {
  jest.mocked(readOwnerRegister).mockRejectedValue(new Error('private connector details'));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ error: 'Owner register unavailable' });
});
