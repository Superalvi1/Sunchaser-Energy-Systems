/** Synthetic acceptance only. Never contacts Meta or an AI provider. */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import pg from "pg";
import { getSupabase } from "../dbManager.ts";
import { SupabaseWhatsAppRepository } from "../server/whatsappTransport/whatsappRepository.ts";
import { createDefaultWhatsAppInboxRepositories } from "../server/whatsappTransport/whatsappInboxRepository.ts";
import { createWhatsAppWebhookRouter } from "../server/whatsappTransport/whatsappWebhookRoutes.ts";
import { installWhatsAppRawBodyMiddleware } from "../server/whatsappTransport/index.ts";
import { readWhatsAppConfig } from "../server/whatsappTransport/whatsappConfig.ts";
import { createMoosRouter } from "../server/moos/moosRouter.ts";
import { SupabaseMoosRelayOutboxStore, drainMoosRelayOutbox, setDefaultMoosRelayOutboxStoreForTests } from "../server/moos/moosRelayOutbox.ts";

const env = process.env;
assert.equal(env.MUSE_DISPOSABLE_ACCEPTANCE, "true", "explicit disposable-test opt-in required");
const dbUrl = new URL(env.DATABASE_URL!);
assert.equal(dbUrl.hostname, "postgres.railway.internal");
assert.equal(dbUrl.pathname, "/muse_disposable");
assert.equal(env.CRM_BASE_URL, "http://moos-crm-isolated-staging.railway.internal:8080");
assert.equal(env.MOOS_WORKER_URL, "http://moos-worker-isolated-staging.railway.internal:3000");
assert.equal(env.RAILWAY_POSTGREST_URL, "http://muse-postgrest-disposable.railway.internal:3000");
for (const name of ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "XAI_API_KEY", "OPENAI_API_KEY"]) {
  assert.ok(!env[name], "verifier must hold no live provider credentials");
}
// Defense in depth: this process cannot make HTTP calls to Meta or model APIs.
const rawFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.ok(u.hostname === "127.0.0.1" || u.hostname.endsWith(".railway.internal"), "external HTTP blocked");
  return rawFetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(10000) });
};
const client = new pg.Client({ connectionString: env.DATABASE_URL });
const run = "wamid.muse-synthetic-" + randomUUID();
const appSecret = "synthetic-not-a-meta-credential";
const phone = String(env.MOOS_TEST_ONLY_RECIPIENT_E164).replace(/\D/g, "");
assert.equal(phone, "923218486752");
const outbox = new SupabaseMoosRelayOutboxStore();
const claimDue = outbox.claimDue.bind(outbox);
outbox.claimDue = async (now, limit) => (await claimDue(now, limit)).filter(row => row.messageId.startsWith(run));
const repo = new SupabaseWhatsAppRepository();
const inbox = createDefaultWhatsAppInboxRepositories();
const checks: string[] = [];
const pass = (name: string) => { checks.push(name); console.log("PASS " + name); };
let server: import("http").Server | undefined;
let conversationId = "";
let textCalls = 0;
try {
  await client.connect();
  assert.equal((await client.query("select current_database() as db")).rows[0].db, "muse_disposable");
  // Authenticate data access; anonymous callers must not read customer text.
  const anon = await fetch(env.RAILWAY_POSTGREST_URL + "/whatsapp_messages?select=id&limit=1");
  assert.ok([401, 403].includes(anon.status)); pass("anonymous_data_denied");
  assert.ok(getSupabase());
  process.env.MOOS_RELAY_ENABLED = "true"; // verifier process only, hosted CRM stays OFF
  setDefaultMoosRelayOutboxStoreForTests(outbox);
  const app = express();
  installWhatsAppRawBodyMiddleware(app); app.use(express.json());
  app.use("/api/whatsapp", createWhatsAppWebhookRouter({ repo, config: readWhatsAppConfig({
    WHATSAPP_CONVERSATIONS_ENABLED: "true", WHATSAPP_WEBHOOK_VERIFY_TOKEN: "synthetic",
    WHATSAPP_APP_SECRET: appSecret, WHATSAPP_ACCESS_TOKEN: "synthetic-never-used",
    WHATSAPP_PHONE_NUMBER_ID: env.MOOS_PHONE_NUMBER_ID,
  }) }));
  app.use("/api/moos", createMoosRouter({
    conversationRepo: () => repo, inboxRepos: () => inbox,
    createQuote: async () => { throw Error("quote forbidden"); },
    sendOutboundText: async () => { textCalls++; throw Error("Meta sending forbidden"); },
    deliverDocument: async () => { throw Error("PDF forbidden"); },
    metaFetch: async () => { throw Error("Meta HTTP forbidden"); },
    checkLegacyAi: async () => false,
  }));
  server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const local = "http://127.0.0.1:" + (server.address() as import("net").AddressInfo).port;
  const headers = { "content-type": "application/json", authorization: "Bearer " + env.MOOS_SERVICE_TOKEN };
  for (const [i, text] of ["Synthetic English enquiry", "یہ ایک فرضی سوال ہے", "Yeh aik farzi sawal hai"].entries()) {
    const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "synthetic-waba", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: env.MOOS_PHONE_NUMBER_ID },
      contacts: [{ wa_id: phone, profile: { name: "Synthetic test" } }],
      messages: [{ from: phone, id: run + "-" + i, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
    } }] }] });
    const signature = "sha256=" + createHmac("sha256", appSecret).update(payload).digest("hex");
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(local + "/api/whatsapp/webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: payload });
      assert.equal(r.status, 200, "synthetic webhook must persist before acknowledgement");
    }
  }
  const rows = await client.query("select conversation_id,text_body from whatsapp_messages where wa_message_id like $1", [run + "%"]);
  assert.equal(rows.rowCount, 3); conversationId = rows.rows[0].conversation_id;
  assert.ok(rows.rows.some(r => r.text_body.includes("فرضی"))); pass("signed_webhook_multilingual_persistence_and_duplicate_suppression");
  assert.equal((await client.query("select count(*)::int as n from moos_relay_outbox where wamid like $1", [run + "%"])).rows[0].n, 3);
  assert.equal((await new SupabaseMoosRelayOutboxStore().get(run + "-0"))?.conversationId, conversationId);
  pass("outbox_survives_store_recreation");
  const relay = await drainMoosRelayOutbox({ store: outbox, env, loadSettings: async () => ({ settings: { enabled: false } }) });
  assert.equal(relay.delivered, 3); pass("actual_private_signed_relay_to_disabled_worker");
  for (const [phoneOverride, status] of [[phone, 401], ["923000000000", 403]] as const) {
    const event = { conversationId, messageId: run + "-denied", phone: phoneOverride, phoneNumberId: env.MOOS_PHONE_NUMBER_ID, type: "text", text: "Synthetic denied test", sentAt: Date.now() };
    const body = JSON.stringify(event);
    const r = await fetch(env.MOOS_WORKER_URL + "/webhooks/crm", { method: "POST", headers: { "content-type": "application/json", "x-relay-signature-256": status === 401 ? "sha256=bad" : "sha256=" + createHmac("sha256", env.RELAY_SECRET!).update(body).digest("hex") }, body });
    assert.equal(r.status, status);
  }
  pass("worker_bad_signature_and_other_recipient_denied");
  for (const route of ["send-text", "send-approved-pdf", "custom-quote-draft", "handoff"]) {
    const r = await fetch(env.CRM_BASE_URL + "/api/moos/" + route, { method: "POST", headers, body: JSON.stringify({ conversationId, text: "synthetic", idempotencyKey: run }) });
    assert.equal(r.status, 503);
  }
  pass("deployed_crm_all_mutations_disabled");
  const ownership = await fetch(env.CRM_BASE_URL + "/api/moos/ownership?conversationId=" + conversationId, { headers });
  assert.equal(ownership.status, 200);
  const stored = (await client.query("select ai_ownership_state,status,assigned_user_id from whatsapp_conversations where id=$1", [conversationId])).rows[0];
  const observed = await ownership.json();
  assert.equal(observed.state, stored.ai_ownership_state);
  assert.equal(observed.humanOwned, !(["AI_SHADOW", "AI_ACTIVE"].includes(stored.ai_ownership_state) && !stored.assigned_user_id && ["open", "pending"].includes(stored.status)));
  pass("deployed_crm_reads_persistent_ownership");
  // Only this local test router enables handoff, backed by the disposable DB.
  env.MOOS_ENABLED = "true";
  for (const route of ["send-approved-pdf", "custom-quote-draft"]) {
    const r = await fetch(local + "/api/moos/" + route, { method: "POST", headers, body: JSON.stringify({ conversationId }) });
    assert.equal(r.status, 403);
  }
  pass("text_only_blocks_pdf_and_quote_even_when_local_router_enabled");
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(local + "/api/moos/handoff", { method: "POST", headers, body: JSON.stringify({ conversationId, reason: "synthetic acceptance" }) });
    assert.equal(r.status, 200); assert.equal((await r.json()).state, "HUMAN_HANDLING");
  }
  assert.equal((await inbox.conversations.getById(conversationId))?.aiOwnershipState, "HUMAN_HANDLING");
  const afterHandoff = await fetch(env.CRM_BASE_URL + "/api/moos/ownership?conversationId=" + conversationId, { headers });
  assert.equal((await afterHandoff.json()).humanOwned, true);
  pass("persistent_handoff_and_repeat_idempotency");
  env.MOOS_ENABLED = "false";
  const blocked = await fetch(local + "/api/moos/send-text", { method: "POST", headers, body: JSON.stringify({ conversationId, text: "synthetic", idempotencyKey: run }) });
  assert.equal(blocked.status, 503); assert.equal(textCalls, 0); pass("rollback_prevents_dispatch");
  const unseen = await client.query("select count(*)::int as n from moos_worker.wa_outbound where message_id like $1", [run + "%"]);
  assert.equal(unseen.rows[0].n, 0); pass("zero_worker_outbound_attempts");
  console.log(JSON.stringify({ check: "muse_staging_persistence", ok: true, checks, modelInferenceTested: false, realWhatsAppSends: 0 }));
} finally {
  env.MOOS_ENABLED = "false"; env.MOOS_RELAY_ENABLED = "false";
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  setDefaultMoosRelayOutboxStoreForTests(null);
  // Quarantine synthetic jobs so a later pilot activation cannot replay them.
  await client.query("update moos_worker.wa_inbound set state='needs_review',error_code='synthetic_acceptance_quarantine' where message_id like $1", [run + "%"]).catch(() => {});
  await client.query("update moos_relay_outbox set status='suppressed',last_error='synthetic_acceptance_quarantine' where wamid like $1 and status='queued'", [run + "%"]).catch(() => {});
  await client.end();
}
