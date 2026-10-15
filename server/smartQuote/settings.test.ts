import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSmartQuoteSettingsStore, SmartQuoteSettingsConflict, SMART_QUOTE_SETTINGS_KEY } from './settingsStore';
import { createSmartQuoteSettingsRouter } from './settingsRouter';
import { defaultSmartQuoteSettings, type SmartQuoteSettings } from '../../src/lib/smartQuoteSettings';
import { isPublicApiRoute } from '../middleware/publicRoutes';

let localValue: SmartQuoteSettings | undefined;
const local = { read: () => localValue, write: (v: SmartQuoteSettings) => { localValue = v; } };
const localStore = createSmartQuoteSettingsStore(local, () => null);
assert.equal((await localStore.read()).revision, 0);
const first = await localStore.save(defaultSmartQuoteSettings());
assert.equal(first.revision, 1);
await assert.rejects(localStore.save(defaultSmartQuoteSettings()), SmartQuoteSettingsConflict);
const localRace = await Promise.allSettled([localStore.save(first), localStore.save(first)]);
assert.equal(localRace.filter(r => r.status === 'fulfilled').length, 1);
assert.equal((await localStore.read()).revision, 2);

let persisted: SmartQuoteSettings | null = null;
let fail = false;
let localWrites = 0;
const client = createClient('https://smartquote-test.supabase.co', 'test-key', {
  auth: { persistSession: false },
  global: { fetch: async (url: any, init?: RequestInit) => {
    if (fail) return new Response('{"message":"unavailable"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
    const u = new URL(String(url));
    assert.equal(u.pathname, '/rest/v1/settings');
    const method = init?.method || 'GET';
    const respond = (v: any, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'GET') {
      assert.equal(u.searchParams.get('key'), 'eq.' + SMART_QUOTE_SETTINGS_KEY);
      return respond(persisted ? [{ value: persisted }] : []);
    }
    const body = JSON.parse(String(init?.body));
    if (method === 'POST') {
      assert.equal(body.key, SMART_QUOTE_SETTINGS_KEY);
      if (persisted) return respond({ code: '23505', message: 'duplicate' }, 409);
      persisted = body.value; return respond(null, 201);
    }
    assert.equal(method, 'PATCH');
    const match = u.searchParams.get('value');
    assert.ok(match?.startsWith('eq.{'), 'compare original JSON value for atomic update');
    if (JSON.stringify(persisted) !== match!.slice(3)) return respond([]);
    persisted = body.value; return respond([{ key: SMART_QUOTE_SETTINGS_KEY }]);
  } },
});
const dbStore = createSmartQuoteSettingsStore({ read: () => null, write: () => { localWrites++; } }, () => client);
const saved = await dbStore.save(defaultSmartQuoteSettings());
assert.equal((await dbStore.read()).revision, 1);
assert.equal(saved.revision, 1);
const race = await Promise.allSettled([dbStore.save(saved), dbStore.save(saved)]);
assert.equal(race.filter(r => r.status === 'fulfilled').length, 1, 'only one concurrent edit wins');
assert.equal((await dbStore.read()).revision, 2);
fail = true;
await assert.rejects(dbStore.read());
await assert.rejects(dbStore.save(saved));
assert.equal(localWrites, 0, 'data API failure must never silently save to local fallback');
fail = false;

const router = createSmartQuoteSettingsRouter(localStore);
async function request(method: string, url: string, actor?: any, body?: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    let code = 200;
    const res: any = { setHeader() {}, status(n: number) { code = n; return this; }, json(data: unknown) { resolve({ status: code, body: data }); return this; } };
    router({ method, url, originalUrl: url, headers: {}, actor, body } as any, res, (e: any) => e ? reject(e) : resolve({ status: 404, body: null }));
  });
}
assert.ok(isPublicApiRoute('GET', '/api/public/smart-quote-settings'));
assert.ok(!isPublicApiRoute('PUT', '/api/public/smart-quote-settings'));
assert.ok(!isPublicApiRoute('PUT', '/api/admin/smart-quote-settings'));
assert.equal((await request('GET', '/api/public/smart-quote-settings')).status, 200);
assert.equal((await request('PUT', '/api/admin/smart-quote-settings?username=allauddin&role=Super%20Admin', undefined, first)).status, 401);
assert.equal((await request('PUT', '/api/admin/smart-quote-settings', { username: 'sales', role: 'Sales Executive' }, first)).status, 403);
const admin = { username: 'admin', role: 'Admin' };
assert.equal((await request('GET', '/api/admin/smart-quote-settings', admin)).status, 200);
assert.equal((await request('PUT', '/api/admin/smart-quote-settings', admin, first)).status, 409);
assert.equal((await request('PUT', '/api/admin/smart-quote-settings', admin, { invalid: true })).status, 400);
assert.equal((await request('PUT', '/api/admin/smart-quote-settings', admin, await localStore.read())).status, 200);
console.log('PASS settings persistence, no fallback on failure, concurrent edits, reload revisions, public read and admin-only write');
