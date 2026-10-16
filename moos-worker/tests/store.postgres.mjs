/** Run only against disposable CI Postgres, never Railway. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
const url = process.env.MOOS_TEST_DATABASE_URL;
test('Postgres dedup preserves latest same-timestamp message and provider evidence', { skip: !url }, async () => {
  const store = new Store(url);
  const a = {messageId:'wamid.pg-a',phone:'923000000001',sentAt:Date.now(),text:'Synthetic',type:'text'};
  const b = {...a,messageId:'wamid.pg-b'};
  try {
    await store.add(a); await store.add(b); await store.add(a);
    assert.equal(await store.preflight(a), false);
    assert.equal(await store.preflight(b), true);
    assert.equal((await store.query('SELECT count(*)::int AS n FROM wa_inbound')).rows[0].n, 2);
    assert.equal(await store.reserve('pg-send', b, 'text'), true);
    assert.equal(await store.reserve('pg-send', b, 'text'), false);
    await store.sent('pg-send', {providerMessageId:'wamid.synthetic-provider'});
    assert.equal((await store.query('SELECT provider_message_id FROM wa_outbound WHERE send_key=$1',['pg-send'])).rows[0].provider_message_id, 'wamid.synthetic-provider');
    assert.ok(await store.claim());
    assert.equal((await store.recovered()).length, 1);
    assert.equal(await store.preflight(b), false);
  } finally { await store.close(); }
});
