/**
 * Moos worker integration test — real HTTP relay → real Agent → real
 * CrmClient → stub CRM (node:http). The ONLY fake is the Store, implemented
 * in-memory with the same semantics as the pg Store (insert-if-absent dedup,
 * FIFO claim, idempotent reserve).
 *
 * Covers: HMAC verification, phone-number binding, relay dedup on retry
 * (same wamid delivered twice → one job → one action), the approved-PDF
 * end-to-end action sequence, and the full custom-quote recommendation
 * flow through relayed messages.
 *
 * Run: node --test tests/relay.integration.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHmac } from "node:crypto";
import { createWorkerServer } from "../src/index.mjs";
import { Agent } from "../src/agent.mjs";
import { CrmClient } from "../src/crm.mjs";

const RELAY_SECRET = "test-relay-secret";
const SERVICE_TOKEN = "test-service-token";
const PHONE_NUMBER_ID = "243825222156651";

const sign = (body) => "sha256=" + createHmac("sha256", RELAY_SECRET).update(body, "utf8").digest("hex");

// ---------- in-memory Store with pg-Store semantics ----------
function fakeStore() {
  const inbound = new Map(); // messageId -> { state, payload }
  const chats = new Map(); // phone -> { human_owned, latest_message_id, last_inbound_at }
  const outbound = new Map(); // send_key -> state
  const pending = new Map();
  return {
    _inbound: inbound,
    async add(event) {
      const chat = chats.get(event.phone) || { human_owned: false, latest_message_id: null, last_inbound_at: 0 };
      if (event.sentAt >= chat.last_inbound_at) {
        chat.latest_message_id = event.messageId;
        chat.last_inbound_at = event.sentAt;
      }
      chats.set(event.phone, chat);
      if (!inbound.has(event.messageId)) inbound.set(event.messageId, { state: "queued", payload: event });
    },
    async claim() {
      for (const [id, row] of inbound) {
        if (row.state === "queued") { row.state = "processing"; return { message_id: id, payload: row.payload }; }
      }
      return null;
    },
    async finish(messageId, review = false, code = null) {
      const row = inbound.get(messageId);
      if (row) { row.state = review ? "needs_review" : "done"; row.code = code; }
    },
    async preflight(msg) {
      const chat = chats.get(msg.phone);
      return Boolean(chat && !chat.human_owned && chat.latest_message_id === msg.messageId && Date.now() - chat.last_inbound_at < 24 * 3600 * 1000);
    },
    async reserve(key) { if (outbound.has(key)) return false; outbound.set(key, "attempted"); return true; },
    async sent(key) { outbound.set(key, "accepted"); },
    async unknown(key) { outbound.set(key, "outcome_unknown"); },
    async shadow(key) { outbound.set(key, "shadow_skipped"); },
    async pending(phone) { return pending.get(phone) || null; },
    async setPending(phone, v) { pending.set(phone, v); },
    async history() { return []; },
    async handoff(msg, reason) {
      const chat = chats.get(msg.phone) || {};
      chat.human_owned = true;
      chats.set(msg.phone, chat);
    },
    async close() {},
  };
}

// ---------- stub CRM ----------
function stubCrm(quotes) {
  const calls = { texts: [], pdfs: [], handoffs: [], drafts: [] };
  const catalog = {
    panels: [{ id: "panel-jinko-645", brand: "Jinko", watts: 645 }],
    inverters: [{ id: "inv-goodwe-10", brand: "GoodWe", model: "GW10K", capacityKw: 10, phase: "single", voltageClass: "HV", bundleBatteryId: "bat-dyness-5", bundleBatteryQuantity: 1 }],
    batteries: [{ id: "bat-dyness-5", brand: "Dyness", model: "B4850", capacityKwh: 5.12, voltageClass: "HV", bundleOnly: false }],
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (req.headers.authorization !== `Bearer ${SERVICE_TOKEN}`) { res.writeHead(401); res.end("{}"); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const json = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      const data = body ? JSON.parse(body) : {};
      if (u.pathname === "/api/moos/approved-quotes") return json({ quotes });
      if (u.pathname === "/api/moos/catalog") return json(catalog);
      if (u.pathname === "/api/moos/ownership") return json({ conversationId: data.conversationId || u.searchParams.get("conversationId"), state: "AI_ACTIVE", humanOwned: false });
      if (u.pathname === "/api/moos/send-text" && req.method === "POST") { calls.texts.push(data); return json({ ok: true, providerMessageId: "wamid.t" }); }
      if (u.pathname === "/api/moos/send-approved-pdf" && req.method === "POST") { calls.pdfs.push(data); return json({ ok: true, providerMessageId: "wamid.d", quoteId: data.quoteId }); }
      if (u.pathname === "/api/moos/custom-quote-draft" && req.method === "POST") { calls.drafts.push(data); return json({ draftId: "SES-1", quoteNumber: "SES-1", status: "draft_pending_staff_approval" }); }
      if (u.pathname === "/api/moos/handoff" && req.method === "POST") { calls.handoffs.push(data); return json({ ok: true }); }
      res.writeHead(404); res.end("{}");
    });
  });
  return { server, calls };
}

const QUOTES = [{ id: "q10", capacityKw: 10, title: "10kW Hybrid", description: "10kW Hybrid", systemType: "hybrid", expiresAt: "2030-01-01T00:00:00Z" }];

async function setup(envOverrides = {}) {
  const store = fakeStore();
  const { server: crmServer, calls } = stubCrm(QUOTES);
  await new Promise((r) => crmServer.listen(0, "127.0.0.1", r));
  const crmPort = crmServer.address().port;
  const env = {
    RELAY_SECRET,
    CRM_BASE_URL: `http://127.0.0.1:${crmPort}`,
    MOOS_SERVICE_TOKEN: SERVICE_TOKEN,
    ENABLE_AUTOSEND: "true",
    MOOS_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    FAQ_FILE: "/nonexistent-faqs.json",
    NODE_ENV: "test",
    ...envOverrides,
  };
  const crm = new CrmClient(env);
  const agent = new Agent(store, crm, env);
  const { server, tick } = createWorkerServer({ store, crm, agent, env });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const relay = async (text, messageId, { badSig = false, numberId = PHONE_NUMBER_ID } = {}) => {
    const event = {
      conversationId: "conv-1",
      messageId,
      phone: "923001234567",
      phoneNumberId: numberId,
      type: "text",
      text,
      sentAt: Date.now(),
    };
    const body = JSON.stringify(event);
    const res = await fetch(`http://127.0.0.1:${port}/webhooks/crm`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-signature-256": badSig ? "sha256=bad" : sign(body) },
      body,
    });
    return res.status;
  };

  const close = async () => {
    await new Promise((r) => server.close(r));
    await new Promise((r) => crmServer.close(r));
  };
  return { store, calls, tick, relay, close };
}

test("relay → queue → agent → CRM: 10kW quote request ends in one approved-PDF action", async () => {
  const { calls, tick, relay, close } = await setup();
  try {
    assert.equal(await relay("10kw hybrid quotation bhej dein", "wamid.i1"), 200);
    await tick();
    assert.equal(calls.pdfs.length, 1);
    assert.equal(calls.pdfs[0].quoteId, "q10");
    assert.equal(calls.pdfs[0].conversationId, "conv-1");
    assert.ok(/^[A-Za-z0-9:_-]+$/.test(calls.pdfs[0].idempotencyKey));
    assert.equal(calls.handoffs.length, 0);
  } finally { await close(); }
});

test("duplicate relay delivery (retry) is deduplicated: one job, one action", async () => {
  const { store, calls, tick, relay, close } = await setup();
  try {
    assert.equal(await relay("10kw quotation", "wamid.dup"), 200);
    assert.equal(await relay("10kw quotation", "wamid.dup"), 200); // Meta/CRM retry
    assert.equal([...store._inbound.values()].filter((r) => r.state === "queued").length, 1);
    await tick();
    await tick(); // second tick finds nothing queued
    assert.equal(calls.pdfs.length, 1);
    assert.equal(calls.texts.length, 0);
  } finally { await close(); }
});

test("bad HMAC signature → 401, nothing queued", async () => {
  const { store, tick, relay, close } = await setup();
  try {
    assert.equal(await relay("10kw quotation", "wamid.bad", { badSig: true }), 401);
    assert.equal(store._inbound.size, 0);
    await tick();
  } finally { await close(); }
});

test("wrong phone_number_id → 422, nothing queued", async () => {
  const { store, relay, close } = await setup();
  try {
    assert.equal(await relay("10kw quotation", "wamid.wrong", { numberId: "999" }), 422);
    assert.equal(store._inbound.size, 0);
  } finally { await close(); }
});

test("full custom flow over relay: requirements → recommended package → confirm → draft + holding + handoff", async () => {
  const { calls, tick, relay, close } = await setup();
  const convo = async (text, id) => {
    assert.equal(await relay(text, id), 200);
    await tick();
  };
  try {
    await convo("custom quotation chahiye", "wamid.f1");
    await convo("Ali Raza", "wamid.f2");
    await convo("Lahore", "wamid.f3");
    await convo("10", "wamid.f4");
    await convo("Ji", "wamid.f5");
    await convo("Standard", "wamid.f6");
    await convo("Single phase", "wamid.f7");
    // The recommendation text went out via the stub CRM (no manual picking).
    const recText = calls.texts.at(-1).text;
    assert.ok(recText.includes("recommend karta hoon"), recText.slice(0, 80));
    assert.ok(recText.includes("GoodWe"), recText.slice(0, 200));
    await convo("Ji", "wamid.f8");
    assert.equal(calls.drafts.length, 1);
    // Draft is bound to the verified conversation + inbound wamid (P0).
    assert.equal(calls.drafts[0].conversationId, "conv-1");
    assert.equal(calls.drafts[0].inboundMessageId, "wamid.f8");
    assert.ok(!("phone" in calls.drafts[0]));
    const req = calls.drafts[0].requirements;
    assert.equal(req.name, "Ali Raza");
    assert.equal(req.inverterId, "inv-goodwe-10");
    assert.equal(req.panelId, "panel-jinko-645");
    assert.equal(req.batteryId, "bat-dyness-5");
    assert.equal(req.confirmed, true);
    // Holding reply + staff handoff (drafts are never auto-sent).
    assert.ok(calls.texts.some((t) => t.text.includes("technical team")));
    assert.equal(calls.handoffs.length, 1);
    assert.equal(calls.handoffs[0].reason, "custom_quote_draft_ready");
    assert.equal(calls.pdfs.length, 0); // no PDF invented or sent
  } finally { await close(); }
});


test("restricted pilot rejects signed events outside approved recipient", async () => {
  const { store, relay, close } = await setup({
    NODE_ENV: "production",
    MOOS_TEST_ONLY_RECIPIENT_E164: "+923218486752"
  });
  try {
    assert.equal(await relay("10kw hybrid quotation", "wamid.not-approved"), 403);
    assert.equal(store._inbound.size, 0);
  } finally { await close(); }
});
