import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent.mjs';
import { CrmClient } from '../src/crm.mjs';

// The worker never touches Meta: sending a PDF means one CRM action call.
// The CRM fetches the PDF bytes server-side and sends the native document.
function mocks() {
  const calls = [];
  const sentKeys = new Set();
  const store = {
    preflight: async () => true,
    reserve: async k => !sentKeys.has(k) && !!sentKeys.add(k),
    sent: async () => {}, unknown: async () => {},
    handoff: async () => {}, pending: async () => null,
    setPending: async () => {}, history: async () => [],
  };
  const crm = {
    approvedQuotes: async () => ({ quotes: [] }),
    catalog: async () => ({}),
    ownership: async (cid) => ({ conversationId: cid, state: 'AI_ACTIVE', humanOwned: false }),
    sendText: async () => ({ ok: true }),
    sendApprovedPdf: async (args) => { calls.push(args); return { ok: true, providerMessageId: 'wamid.doc1' }; },
    customQuoteDraft: async () => ({ draftId: 'd1' }),
    handoff: async () => ({ ok: true }),
  };
  const agent = new Agent(store, crm, { ENABLE_AUTOSEND: 'true' });
  return { agent, calls };
}

test('pdf() emits exactly one CRM sendApprovedPdf action with a CRM-safe key', async () => {
  const { agent, calls } = mocks();
  const msg = { messageId: 'wamid.HBgMNTIz...', conversationId: 'conv-9', phone: '923001111111', type: 'text', text: 'x' };
  await agent.pdf(msg, { id: 'quote-abc', capacityKw: 10 });
  assert.equal(calls.length, 1);
  assert.deepEqual(
    { conversationId: calls[0].conversationId, quoteId: calls[0].quoteId },
    { conversationId: 'conv-9', quoteId: 'quote-abc' }
  );
  // CRM-safe: no dots from the wamid survive in the idempotency key.
  assert.ok(/^[A-Za-z0-9:_-]+$/.test(calls[0].idempotencyKey));
  assert.ok(!calls[0].idempotencyKey.includes('.'));
});

test('CrmClient.sendApprovedPdf posts to /api/moos/send-approved-pdf', async () => {
  const seen = [];
  const old = global.fetch;
  global.fetch = async (url, opts) => {
    seen.push({ url, method: opts.method, auth: opts.headers.Authorization, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ ok: true, providerMessageId: 'wamid.x' }) };
  };
  try {
    const crm = new CrmClient({ CRM_BASE_URL: 'https://crm.example', MOOS_SERVICE_TOKEN: 'tok' });
    const r = await crm.sendApprovedPdf({ conversationId: 'c1', quoteId: 'q1', idempotencyKey: 'moos_k1' });
    assert.equal(r.providerMessageId, 'wamid.x');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://crm.example/api/moos/send-approved-pdf');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].auth, 'Bearer tok');
    assert.deepEqual(seen[0].body, { conversationId: 'c1', quoteId: 'q1', idempotencyKey: 'moos_k1' });
  } finally {
    global.fetch = old;
  }
});

test('CrmClient surfaces CRM failures with status (no silent success)', async () => {
  const old = global.fetch;
  global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ error: 'Outside the 24h customer-service window' }) });
  try {
    const crm = new CrmClient({ CRM_BASE_URL: 'https://crm.example', MOOS_SERVICE_TOKEN: 'tok' });
    await assert.rejects(
      () => crm.sendText({ conversationId: 'c1', text: 'hi', idempotencyKey: 'k' }),
      (e) => { assert.equal(e.status, 422); assert.match(e.message, /24h/); return true; }
    );
  } finally {
    global.fetch = old;
  }
});
