/** @jest-environment node */
import { GET } from '@/app/api/mission-control/evidence/route';
import { readEvidence } from '@/lib/mission-control/evidence';
jest.mock('@/lib/mission-control/evidence', () => ({ readEvidence: jest.fn() }));
jest.mock('@/lib/api-logger', () => ({ logApiError: jest.fn() }));
it('returns the raw contract with no-store', async () => {
  const payload = { schemaVersion: 1, checkedAt: '2026-01-01T00:00:00Z', sources: [] };
  jest.mocked(readEvidence).mockResolvedValue(payload as Awaited<ReturnType<typeof readEvidence>>);
  const response = await GET();
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual(payload);
});
it('returns only a sanitized 503 on failure', async () => {
  jest.mocked(readEvidence).mockRejectedValue(new Error('private secret'));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ error: 'Evidence unavailable' });
});
