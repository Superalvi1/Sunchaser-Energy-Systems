import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent } from '../src/agent.mjs';

// Mocks: the CRM executes every privileged action; the worker only emits them.
const defaultCatalog = () => ({
  panels: [
    { id: 'panel-aiko-640', brand: 'AIKO', watts: 640 },
    { id: 'panel-jinko-645', brand: 'Jinko', watts: 645 },
  ],
  inverters: [
    { id: 'inv-solis-10', brand: 'Solis', capacityKw: 10, phase: 'single', voltageClass: 'LV', bundleBatteryId: null },
    { id: 'inv-goodwe-10', brand: 'GoodWe', capacityKw: 10, phase: 'single', voltageClass: 'HV', bundleBatteryId: 'bat-dyness-5' },
  ],
  batteries: [
    { id: 'bat-dyness-5', brand: 'Dyness', capacityKwh: 5.12, voltageClass: 'LV', bundleOnly: false },
    { id: 'bat-soluna-10', brand: 'Soluna', capacityKwh: 10, voltageClass: 'HV', bundleOnly: false },
  ],
});

function mocks(quotes, catalog) {
  const events = [];
  const sentKeys = new Set();
  const state = { pending: null, handoff: null, owned: false, handoffs: [], drafts: [] };
  const store = {
    preflight: async () => true,
    reserve: async k => !sentKeys.has(k) && !!sentKeys.add(k),
    sent: async () => {}, unknown: async () => {}, shadow: async () => {},
    handoff: async (m, why) => { state.handoff = why; },
    pending: async () => state.pending,
    setPending: async (p, v) => { state.pending = v; },
    history: async () => [],
  };
  const crm = {
    approvedQuotes: async () => ({ quotes }),
    catalog: async () => catalog || defaultCatalog(),
    ownership: async (cid) => ({ conversationId: cid, state: state.owned ? 'HUMAN_HANDLING' : 'AI_ACTIVE', humanOwned: state.owned }),
    sendText: async ({ conversationId, text, idempotencyKey }) => {
      events.push({ type: 'text', conversationId, text, idempotencyKey });
      return { ok: true, providerMessageId: 'wamid.reply' };
    },
    sendApprovedPdf: async ({ conversationId, quoteId, idempotencyKey }) => {
      events.push({ type: 'document', conversationId, quoteId, idempotencyKey });
      return { ok: true, providerMessageId: 'wamid.doc' };
    },
    customQuoteDraft: async ({ conversationId, inboundMessageId, requirements }) => {
      state.drafts.push({ conversationId, inboundMessageId, requirements });
      return { draftId: 'SES-20261015-0001', quoteNumber: 'SES-20261015-0001', totalPkr: 1234567, url: 'https://crm.example/q.pdf', status: 'draft_pending_staff_approval' };
    },
    handoff: async (cid, reason, summary) => { state.handoffs.push({ cid, reason, summary }); return { ok: true }; },
  };
  const env = { ENABLE_AUTOSEND: 'true', NODE_ENV: 'development', FAQ_FILE: '/nonexistent-faqs.json' };
  const agent = new Agent(store, crm, env);
  return { agent, events, state, crm };
}

const q = (capacityKw, title, id, systemType) => ({
  id, capacityKw, title, description: title, systemType,
  expiresAt: '2030-12-31T00:00:00Z',
});
const msg = (text, id = 'wamid.1') => ({ messageId: id, conversationId: 'conv-1', phone: '923001111111', type: 'text', text });

test('two approved sizes send two distinct document actions in order', async () => {
  const { agent, events } = mocks([q(6, '6kW Hybrid', 'six', 'hybrid'), q(10, '10kW Hybrid', 'ten', 'hybrid')]);
  const r = await agent.process(msg('Send 6kw and 10kw hybrid quotations'));
  assert.equal(r.review, false);
  const docs = events.filter(e => e.type === 'document');
  assert.equal(docs.length, 2);
  assert.deepEqual(docs.map(d => d.quoteId), ['six', 'ten']);
  // Idempotency keys are distinct per quote and CRM-safe (no dots).
  assert.notEqual(docs[0].idempotencyKey, docs[1].idempotencyKey);
  assert.ok(docs.every(d => /^[A-Za-z0-9:_-]+$/.test(d.idempotencyKey)));
});

test('custom battery spec starts incremental collection, never a generic PDF', async () => {
  const { agent, events, state } = mocks([q(10, '10kW Hybrid', 'ten', 'hybrid')]);
  const r = await agent.process(msg('10kW hybrid with 16kWh battery price'));
  assert.equal(events.some(e => e.type === 'document'), false);
  assert.equal(events.filter(e => e.type === 'text').length, 1); // asks for name
  assert.equal(state.pending.kind, 'custom_name');
  assert.equal(state.handoff, null);
  assert.equal(r.review, false);
});

test('expired or missing quote is never sent; staff follow-up created', async () => {
  const expired = { ...q(8, '8kW On-Grid', 'eight', 'on_grid'), expiresAt: '2020-01-01T00:00:00Z' };
  const { agent, events, state } = mocks([expired]);
  const r = await agent.process(msg('8kw on grid quotation'));
  assert.equal(events.some(e => e.type === 'document'), false);
  assert.equal(state.handoff, 'approved_pdf_missing_or_expired');
  assert.equal(r.review, true);
});

test('ambiguous on-grid vs hybrid asks, then remembers the size', async () => {
  const { agent, events, state } = mocks([q(10, '10kW On-Grid', 'ten-grid', 'on_grid'), q(10, '10kW Hybrid', 'ten-hybrid', 'hybrid')]);
  await agent.process(msg('10kw quotation', 'wamid.4'));
  assert.equal(events[0].type, 'text');
  assert.equal(state.pending.kind, 'need_type');
  await agent.process(msg('hybrid', 'wamid.5'));
  const docs = events.filter(e => e.type === 'document');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].quoteId, 'ten-hybrid');
});

test('human ownership blocks every send', async () => {
  const { agent, events, state } = mocks([q(6, '6kW On-Grid', 'six', 'on_grid')]);
  state.owned = true;
  const r = await agent.process(msg('6kw on grid quotation'));
  assert.equal(events.length, 0);
  assert.equal(r.reason, 'crm_human_owned');
});

test('duplicate send key never sends twice (idempotent reserve)', async () => {
  const { agent, events } = mocks([q(6, '6kW Hybrid', 'six', 'hybrid')]);
  await agent.process(msg('6kw quotation'));
  await agent.process(msg('6kw quotation')); // same wamid → same send keys
  assert.equal(events.filter(e => e.type === 'document').length, 1);
});

test('Urdu and Roman Urdu requests are classified', async () => {
  const { agent, events } = mocks([q(10, '10kW Hybrid', 'ten', 'hybrid')]);
  await agent.process(msg('10 کلو واٹ ہائبرڈ کوٹیشن بھیج دیں', 'wamid.7'));
  assert.equal(events.filter(e => e.type === 'document').length, 1);
  const { agent: a2, events: e2 } = mocks([q(12, '12kW Hybrid', 'twelve', 'hybrid')]);
  await a2.process(msg('12kw hybrid quotation bhej dein', 'wamid.8'));
  assert.equal(e2.filter(e => e.type === 'document').length, 1);
});

test('CRM library outage fails closed with handoff, no send', async () => {
  const { agent, events, state } = mocks([]);
  agent.crm.approvedQuotes = async () => { throw new Error('CRM down'); };
  const r = await agent.process(msg('10kw quotation'));
  assert.equal(events.length, 0);
  assert.equal(state.handoff, 'crm_quote_library_unavailable');
  assert.equal(r.review, true);
});

test('off-grid request gets an ack and a consultant handoff, never a PDF', async () => {
  const { agent, events, state } = mocks([q(10, '10kW Off-Grid', 'ten-off', 'off_grid')]);
  const r = await agent.process(msg('10kw off grid quotation'));
  assert.equal(events.some(e => e.type === 'document'), false);
  assert.equal(state.handoff, 'off_grid_requires_consultant');
  assert.equal(r.review, true);
});

test('custom collection happy path: name→city→size→battery→structure→phase→recommended package→confirm→draft', async () => {
  const { agent, events, state } = mocks([]);
  const convo = async (text, id) => agent.process(msg(text, id));
  await convo('custom quotation chahiye', 'wamid.c1');
  assert.equal(state.pending.kind, 'custom_name');
  await convo('Ali Raza', 'wamid.c2');
  assert.equal(state.pending.kind, 'custom_city');
  await convo('Lahore', 'wamid.c3');
  assert.equal(state.pending.kind, 'custom_capacity');
  await convo('10', 'wamid.c4');
  assert.equal(state.pending.kind, 'custom_battery');
  await convo('Ji', 'wamid.c5');
  assert.equal(state.pending.kind, 'custom_structure');
  await convo('Standard', 'wamid.c6');
  assert.equal(state.pending.kind, 'custom_phase');
  await convo('Single phase', 'wamid.c7');
  // Recommendation (no manual equipment picking): smallest adequate single-phase
  // inverter (GoodWe 10kW, bundled battery), highest-watt panel (Jinko 645W).
  assert.equal(state.pending.kind, 'custom_confirm');
  const rec = state.pending.recommendation;
  assert.equal(rec.ok, true);
  assert.equal(rec.inverterId, 'inv-goodwe-10');
  assert.equal(rec.panelId, 'panel-jinko-645');
  assert.equal(rec.batteryId, 'bat-dyness-5');
  assert.ok(events.at(-1).text.includes('recommend karta hoon'));
  assert.ok(events.at(-1).text.includes('GoodWe'));
  const r = await convo('Ji', 'wamid.c8');
  assert.equal(state.drafts.length, 1);
  // Draft call is bound to the verified CRM conversation + inbound wamid;
  // the worker never supplies the recipient phone (CRM derives it).
  assert.equal(state.drafts[0].conversationId, 'conv-1');
  assert.equal(state.drafts[0].inboundMessageId, 'wamid.c8');
  assert.ok(!('phone' in state.drafts[0]) || state.drafts[0].phone === undefined);
  const req = state.drafts[0].requirements;
  assert.equal(req.name, 'Ali Raza');
  assert.equal(req.city, 'Lahore');
  assert.equal(req.systemCapacityKw, 10);
  assert.equal(req.inverterId, 'inv-goodwe-10');
  assert.equal(req.panelId, 'panel-jinko-645');
  assert.equal(req.batteryId, 'bat-dyness-5');
  assert.equal(req.structureType, 'standard-l2');
  assert.equal(req.confirmed, true);
  assert.ok(req.panelQuantity >= 1 && req.panelQuantity <= 80);
  assert.equal(state.handoff, 'custom_quote_draft_ready');
  assert.equal(r.review, true);
  assert.ok(events.some(e => e.type === 'text' && e.text.includes('SES-20261015-0001')));
});

test('custom collection without battery: recommendation has no battery', async () => {
  const { agent, events, state } = mocks([]);
  const convo = async (text, id) => agent.process(msg(text, id));
  await convo('custom', 'wamid.n1');
  await convo('Ali', 'wamid.n2');
  await convo('Lahore', 'wamid.n3');
  await convo('6', 'wamid.n4');
  await convo('Nahi', 'wamid.n5');
  await convo('Elevated', 'wamid.n6');
  await convo('Single', 'wamid.n7');
  assert.equal(state.pending.kind, 'custom_confirm');
  const rec = state.pending.recommendation;
  assert.equal(rec.ok, true);
  assert.equal(rec.batteryId, null);
  assert.equal(rec.batteryLabel, 'Nahi');
  await convo('Ji', 'wamid.n8');
  const req = state.drafts[0].requirements;
  assert.equal(req.batteryId, null);
  assert.equal(req.batteryQuantity, 0);
});

test('custom collection with incompatible phase hands off, no draft', async () => {
  const { agent, events, state } = mocks([]);
  const convo = async (text, id) => agent.process(msg(text, id));
  await convo('custom', 'wamid.p1');
  await convo('Ali', 'wamid.p2');
  await convo('Lahore', 'wamid.p3');
  await convo('10', 'wamid.p4');
  await convo('Nahi', 'wamid.p5');
  await convo('Standard', 'wamid.p6');
  const r = await convo('Three phase', 'wamid.p7'); // catalog only has single-phase 10kW
  assert.equal(state.drafts.length, 0);
  assert.equal(state.handoff, 'custom_no_compatible_package');
  assert.equal(r.review, true);
});

test('custom collection decline of recommendation hands off, no draft', async () => {
  const { agent, events, state } = mocks([]);
  const convo = async (text, id) => agent.process(msg(text, id));
  await convo('custom', 'wamid.r1');
  await convo('Ali', 'wamid.r2');
  await convo('Lahore', 'wamid.r3');
  await convo('10', 'wamid.r4');
  await convo('Ji', 'wamid.r5');
  await convo('Standard', 'wamid.r6');
  await convo('Single', 'wamid.r7');
  assert.equal(state.pending.kind, 'custom_confirm');
  const r = await convo('Nahi', 'wamid.r8');
  assert.equal(state.drafts.length, 0);
  assert.equal(state.handoff, 'custom_customer_rejected_summary');
  assert.equal(r.review, true);
});

test('shadow mode: moos_disabled stays silent — no send, no handoff, latched', async () => {
  const { agent, events, state } = mocks([q(10, '10kW Hybrid', 'ten', 'hybrid')]);
  const dis = () => {
    const e = new Error('CRM POST → 503: moos_disabled');
    e.status = 503;
    e.body = { error: 'moos_disabled', message: 'Moos agent is disabled (MOOS_ENABLED=false)' };
    throw e;
  };
  agent.crm.sendText = dis;
  agent.crm.sendApprovedPdf = dis;
  const r1 = await agent.process(msg('10kw quotation', 'wamid.s1'));
  assert.equal(events.length, 0); // nothing sent
  assert.equal(state.handoff, null); // no handoff, no ownership change
  assert.equal(agent.shadowMode, true); // latched
  assert.equal(r1.review, false);
  // Second message: short-circuits without even calling the CRM.
  let calls = 0;
  agent.crm.sendText = async () => { calls++; throw new Error('should not be called'); };
  const r2 = await agent.process(msg('10kw quotation', 'wamid.s2'));
  assert.equal(calls, 0);
  assert.equal(events.length, 0);
  assert.equal(r2.review, false);
});

test('custom collection re-asks on invalid capacity', async () => {
  const { agent, events, state } = mocks([]);
  await agent.process(msg('custom quote', 'wamid.d1'));
  await agent.process(msg('Ali', 'wamid.d2'));
  await agent.process(msg('Lahore', 'wamid.d3'));
  const r = await agent.process(msg('7', 'wamid.d4'));
  assert.equal(state.pending.kind, 'custom_capacity');
  assert.equal(r.reason, 'custom_collect_capacity_retry');
  assert.equal(events.filter(e => e.type === 'text').length, 4);
});

test('custom draft validation failure → holding reply + handoff, no invented quote', async () => {
  const { agent, events, state, crm } = mocks([]);
  crm.customQuoteDraft = async () => {
    const e = new Error('CRM POST → 422: bad');
    e.status = 422;
    e.body = { error: 'Panel sizing requires a consultant review.' };
    throw e;
  };
  const convo = async (text, id) => agent.process(msg(text, id));
  await convo('custom', 'wamid.e1');
  await convo('Ali', 'wamid.e2');
  await convo('Lahore', 'wamid.e3');
  await convo('10', 'wamid.e4');
  await convo('Nahi', 'wamid.e5');
  await convo('Standard', 'wamid.e6');
  await convo('Single', 'wamid.e7');
  assert.equal(state.pending.kind, 'custom_confirm');
  const r = await convo('Ji', 'wamid.e8');
  assert.equal(state.drafts.length, 0);
  assert.equal(state.handoff, 'quotation_needs_review');
  assert.equal(r.review, true);
  assert.ok(events.at(-1).text.includes('technical team'));
});

test('unverified warranty question never sends a 10kW PDF', async () => {
  const { agent, events, state } = mocks([q(10, '10kW Hybrid', 'ten', 'hybrid')]);
  const result = await agent.process(msg('10kW hybrid ki warranty kitni hai?'));
  assert.equal(result.review, true);
  assert.equal(result.reason, 'unverified_policy_handoff');
  assert.equal(state.handoff, 'unverified_policy_requires_staff');
  assert.equal(events.some(e => e.type === 'document'), false);
});
test('LLM custom-intent classification starts requirements collection instead of handoff', async () => {
  const { agent, events, state } = mocks([]);
  agent.decideWithMoos = async () => ({action:'custom'});
  const result = await agent.process(msg('I have unique requirements for my roof'));
  assert.equal(result.review, false);
  assert.equal(state.pending.kind, 'custom_name');
  assert.equal(events.some(e=>e.type==='document'),false);
});
test('off-grid classification takes precedence over hybrid label', () => {
  const { agent } = mocks([]);
  assert.equal(agent.systemTypeOf({title:'Hybrid off-grid rural cabin'}), 'off_grid');
});

test('text-only Muse replies autonomously to greetings without a quote', async () => {
  const {agent,events,state}=mocks([q(10,'10kW Hybrid','ten','hybrid')]);
  agent.env.MUSE_TEXT_ONLY_MODE='true';
  const r=await agent.process(msg('Assalamualaikum','wamid.textonly.1'));
  assert.equal(r.reason,'text_only_greeting');
  assert.equal(events.filter(e=>e.type==='text').length,1);
  assert.equal(events.filter(e=>e.type==='document').length,0);
  assert.equal(state.handoff,null);
});
test('text-only Muse handles quotation requests with text, never sends PDFs or drafts',async()=>{
  const {agent,events,state}=mocks([q(10,'10kW Hybrid','ten','hybrid')]);
  agent.env.MUSE_TEXT_ONLY_MODE='true';
  const r=await agent.process(msg('Send 10kW hybrid quotation','wamid.textonly.2'));
  assert.equal(r.reason,'text_only_sales_handoff');
  assert.equal(events.filter(e=>e.type==='text').length,1);
  assert.equal(events.filter(e=>e.type==='document').length,0);
  assert.equal(state.drafts.length,0);
  assert.equal(state.handoff,'text_only_sales_enquiry');
});
test('text-only Muse routes policy claims to staff',async()=>{
  const {agent,events,state}=mocks([]);
  agent.env.MUSE_TEXT_ONLY_MODE='true';
  const r=await agent.process(msg('10kW warranty and installments details?','wamid.textonly.3'));
  assert.equal(r.reason,'text_only_handoff');
  assert.equal(events.filter(e=>e.type==='document').length,0);
  assert.equal(state.handoff,'text_only_staff_review');
});
