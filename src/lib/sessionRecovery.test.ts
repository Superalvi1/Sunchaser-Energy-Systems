import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchWithSessionRecovery } from './sessionRecovery';

function fixture(status = 401, token: string | null = 'expired') {
  let current = token, recoveries = 0, requests = 0;
  const deps = {
    fetch: (async () => { requests++; return new Response('{"error":"Unauthorized"}', { status }); }) as typeof fetch,
    getToken: () => current,
    onUnauthorized: () => { recoveries++; current = null; },
  };
  return { deps, changeToken: (t: string) => { current = t; }, counts: () => ({ recoveries, requests }) };
}
const headers = { Authorization: 'Bearer expired' };
test('current rejected credential opens recovery once and never repeats a write', async () => {
  const f = fixture();
  const response = await fetchWithSessionRecovery('/api/admin/smart-quote-settings', { method: 'PUT', headers, body: '{}' }, f.deps);
  assert.equal(response.status, 401);
  assert.deepEqual(f.counts(), { recoveries: 1, requests: 1 });
  await fetchWithSessionRecovery('/api/admin/parties', { headers }, f.deps);
  assert.deepEqual(f.counts(), { recoveries: 1, requests: 2 });
});
test('a delayed 401 from an old request does not invalidate a new login', async () => {
  let resolve!: (r: Response) => void;
  const f = fixture();
  f.deps.fetch = () => new Promise(r => { resolve = r; });
  const pending = fetchWithSessionRecovery('/api/admin/smart-quote-settings', { headers }, f.deps);
  f.changeToken('new-session'); resolve(new Response('', { status: 401 }));
  await pending;
  assert.equal(f.counts().recoveries, 0);
});
for (const status of [200, 403, 404, 429, 500, 503]) test(`${status} does not clear credentials`, async () => {
  const f = fixture(status);
  await fetchWithSessionRecovery('/api/admin/smart-quote-settings', { headers }, f.deps);
  assert.equal(f.counts().recoveries, 0);
});
for (const path of ['/api/auth/login', '/api/auth/me', '/api/auth/register', '/api/public/smart-quotes', '/api/marketplace/cart']) test(`${path} errors do not interrupt the workspace`, async () => {
  const f = fixture();
  await fetchWithSessionRecovery(path, { headers }, f.deps);
  assert.equal(f.counts().recoveries, 0);
});
test('network failure preserves the session', async () => {
  const f = fixture(); f.deps.fetch = async () => { throw new TypeError('Offline'); };
  await assert.rejects(fetchWithSessionRecovery('/api/admin/parties', { headers }, f.deps), /Offline/);
  assert.equal(f.counts().recoveries, 0);
});
test('cached workspace with no token can request recovery', async () => {
  const f = fixture(401, null);
  await fetchWithSessionRecovery('/api/admin/parties', {}, f.deps);
  assert.equal(f.counts().recoveries, 1);
});
