import assert from 'node:assert/strict';
import { authorizedFetch, persistAuthSession, getStoredAuthToken } from './api';
import { SESSION_EXPIRED_EVENT } from '../lib/sessionRecovery';
import type { User } from '../types';
const storage = new Map<string, string>();
const events: CustomEvent[] = [];
const requests: RequestInit[] = [];
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
  window: { dispatchEvent: (event: CustomEvent) => { events.push(event); return true; } },
  fetch: async (_url: string, init: RequestInit) => { requests.push(init); return new Response('{"error":"Unauthorized"}', { status: 401 }); },
});
const user = { id: 'admin-id', username: 'admin', role: 'Super Admin' } as User;
persistAuthSession(user, 'expired-token');
const response = await authorizedFetch('/api/admin/smart-quote-settings', { method: 'PUT', body: '{}' });
assert.equal(response.status, 401);
assert.equal(getStoredAuthToken(), null);
assert.equal(storage.get('sunchaser_user'), undefined);
assert.equal(requests.length, 1, 'a rejected price update is not replayed');
assert.equal(new Headers(requests[0].headers).get('Authorization'), 'Bearer expired-token');
assert.equal(events.length, 1);
assert.equal(events[0].type, SESSION_EXPIRED_EVENT);
assert.deepEqual(events[0].detail, { id: user.id, username: user.username, role: user.role });
assert.ok(!JSON.stringify(events[0].detail).includes('expired-token'), 'UI event never exposes the token');
await authorizedFetch('/api/admin/parties');
assert.equal(events.length, 1, 'concurrent failures do not create repeated sign-in prompts');
console.log('PASS API authentication header, rejected token removal, one recovery event, and no write replay');
