import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import {
  issueSmartQuoteLinkToken,
  resolveSmartQuoteLinkKey,
  SMART_QUOTE_LINK_MAX_TTL_SECONDS,
  SmartQuoteLinkUnavailableError,
  verifySmartQuoteLinkToken,
} from "./smartQuoteLinkToken.ts";
import { createPublicLeadRouter, SMART_QUOTE_LINK_HEADER } from "./publicLeadRoutes.ts";
import { deterministicSmartQuoteLeadId, saveSmartQuoteSubmission, type SmartQuoteSource, type SmartQuoteVersion, type SmartQuoteVersionStore } from "./smartQuoteVersions.ts";
import { toPublicLeadInput, type SmartQuoteLeadInput } from "./smartQuoteLead.ts";
import { readSmartQuoteLinkToken, publicSmartQuoteHeaders } from "../../src/lib/smartQuoteLinkClient.ts";

const ENV = { NODE_ENV: "test", JWT_SECRET: "unit-test-jwt-secret-for-smart-quote-link-0001" } as NodeJS.ProcessEnv;
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const LEAD = "lead-11111111-2222-3333-4444-555555555555";
const PHONE = "03004415484";

// ---- Token ----

test("a token round-trips with its lead, phone and expiry", () => {
  const { token, expiresAt } = issueSmartQuoteLinkToken({ leadId: LEAD, phone: "0300-4415484", ttlSeconds: 3600 }, { env: ENV, now: NOW });
  const verified = verifySmartQuoteLinkToken(token, { env: ENV, now: NOW + 1000 });
  assert.ok(verified.ok);
  assert.equal(verified.claims.leadId, LEAD);
  assert.equal(verified.claims.phone, "923004415484");
  assert.equal(verified.claims.expiresAt * 1000, expiresAt);
  assert.equal(expiresAt, NOW + 3600_000);
  assert.match(token, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
  assert.ok(!token.includes(PHONE), "the payload is not plain text phone digits in the clear");
});

test("expired, not-yet-valid, forged, tampered, truncated and cross-secret tokens are all refused", () => {
  const { token } = issueSmartQuoteLinkToken({ leadId: LEAD, phone: PHONE, ttlSeconds: 3600 }, { env: ENV, now: NOW });
  assert.equal(verifySmartQuoteLinkToken(token, { env: ENV, now: NOW + 3601_000 }).ok, false);
  assert.deepEqual(verifySmartQuoteLinkToken(token, { env: ENV, now: NOW + 3601_000 }), { ok: false, reason: "expired" });
  const future = issueSmartQuoteLinkToken({ leadId: LEAD, ttlSeconds: 3600 }, { env: ENV, now: NOW + 10 * 60_000 }).token;
  assert.deepEqual(verifySmartQuoteLinkToken(future, { env: ENV, now: NOW }), { ok: false, reason: "not_yet_valid" });

  const [v, body, sig] = token.split(".");
  const swapped = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), l: "lead-other" })).toString("base64url");
  assert.deepEqual(verifySmartQuoteLinkToken(`${v}.${swapped}.${sig}`, { env: ENV, now: NOW }), { ok: false, reason: "bad_signature" }, "changing the lead id breaks the signature");
  assert.equal(verifySmartQuoteLinkToken(`${v}.${body}.${sig.slice(0, -2)}AA`, { env: ENV, now: NOW }).ok, false);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const lastBits = alphabet.indexOf(sig.at(-1)!);
  const malleable = `${v}.${body}.${sig.slice(0, -1)}${alphabet[lastBits ^ 1]}`;
  assert.deepEqual(verifySmartQuoteLinkToken(malleable, { env: ENV, now: NOW }), { ok: false, reason: "bad_signature" }, "a non-canonical encoding of the same MAC bytes is refused");
  for (const junk of ["", "x", "v1..", "v1.a.b", `${token}.extra`, token.slice(0, 40), "v2" + token.slice(2), "A".repeat(2000), undefined, null, 42, {}]) {
    assert.equal(verifySmartQuoteLinkToken(junk, { env: ENV, now: NOW }).ok, false, String(junk).slice(0, 20));
  }
  const other = { ...ENV, JWT_SECRET: "a-completely-different-jwt-secret-for-the-other-server-9" } as NodeJS.ProcessEnv;
  assert.equal(verifySmartQuoteLinkToken(token, { env: other, now: NOW }).ok, false, "another deployment's secret does not verify it");
});

test("a token signed with the right key but the wrong purpose, or an over-long lifetime, is refused", () => {
  const key = resolveSmartQuoteLinkKey(ENV)!;
  const forge = (payload: object, purpose = "smart-quote-link") => {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `v1.${body}.${createHmac("sha256", key).update(`${purpose}\n${body}`).digest("base64url")}`;
  };
  const nowSec = Math.floor(NOW / 1000);
  const good = { p: "smart-quote-link", l: LEAD, i: nowSec, e: nowSec + 600, n: "x" };
  assert.ok(verifySmartQuoteLinkToken(forge(good), { env: ENV, now: NOW }).ok, "the harness can mint a valid token");
  assert.equal(verifySmartQuoteLinkToken(forge({ ...good, p: "pdf-upload" }), { env: ENV, now: NOW }).ok, false, "payload purpose");
  assert.equal(verifySmartQuoteLinkToken(forge(good, "other-purpose"), { env: ENV, now: NOW }).ok, false, "HMAC purpose domain");
  assert.deepEqual(verifySmartQuoteLinkToken(forge({ ...good, e: nowSec + SMART_QUOTE_LINK_MAX_TTL_SECONDS + 5 }), { env: ENV, now: NOW }), { ok: false, reason: "ttl_too_long" });
  assert.equal(verifySmartQuoteLinkToken(forge({ ...good, l: "../../etc/passwd" }), { env: ENV, now: NOW }).ok, false);
  assert.equal(verifySmartQuoteLinkToken(forge({ ...good, ph: "not a phone" }), { env: ENV, now: NOW }).ok, false);
  assert.throws(() => issueSmartQuoteLinkToken({ leadId: LEAD, ttlSeconds: SMART_QUOTE_LINK_MAX_TTL_SECONDS + 1 }, { env: ENV, now: NOW }), /30 days/);
  assert.throws(() => issueSmartQuoteLinkToken({ leadId: LEAD, ttlSeconds: 5 }, { env: ENV, now: NOW }));
  assert.ok(issueSmartQuoteLinkToken({ leadId: LEAD, ttlSeconds: SMART_QUOTE_LINK_MAX_TTL_SECONDS }, { env: ENV, now: NOW }).token);
});

test("the signing key is purpose-derived, never the raw JWT secret, and production fails closed without a strong secret", () => {
  const derived = resolveSmartQuoteLinkKey(ENV)!;
  assert.notEqual(derived.toString("utf8"), ENV.JWT_SECRET);
  assert.equal(derived.length, 32);
  const dedicated = resolveSmartQuoteLinkKey({ ...ENV, SMART_QUOTE_LINK_SECRET: "dedicated-link-secret-at-least-32-characters-long" })!;
  assert.notDeepEqual(dedicated, derived);
  assert.equal(resolveSmartQuoteLinkKey({ NODE_ENV: "production" } as NodeJS.ProcessEnv), null);
  assert.equal(resolveSmartQuoteLinkKey({ NODE_ENV: "production", JWT_SECRET: "short" } as NodeJS.ProcessEnv), null);
  assert.equal(resolveSmartQuoteLinkKey({ NODE_ENV: "production", SMART_QUOTE_LINK_SECRET: "short" } as NodeJS.ProcessEnv), null);
  assert.equal(resolveSmartQuoteLinkKey({ NODE_ENV: "development" } as NodeJS.ProcessEnv), null, "no secret, no signing, in any mode");
  const noSecret = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  assert.throws(() => issueSmartQuoteLinkToken({ leadId: LEAD }, { env: noSecret, now: NOW }), SmartQuoteLinkUnavailableError);
  const { token } = issueSmartQuoteLinkToken({ leadId: LEAD }, { env: ENV, now: NOW });
  assert.deepEqual(verifySmartQuoteLinkToken(token, { env: noSecret, now: NOW }), { ok: false, reason: "no_secret" });
});

// ---- Client helpers ----

test("the page reads ?link= and sends it as a header; without it the request is plain anonymous", () => {
  assert.equal(readSmartQuoteLinkToken("?link=v1.abc.def"), "v1.abc.def");
  assert.equal(readSmartQuoteLinkToken("?x=1&link=v1.abc.def&y=2"), "v1.abc.def");
  assert.equal(readSmartQuoteLinkToken(""), null);
  assert.equal(readSmartQuoteLinkToken("?link="), null);
  assert.equal(readSmartQuoteLinkToken("?link=<script>"), null);
  assert.equal(readSmartQuoteLinkToken(`?link=${"a".repeat(2000)}`), null);
  assert.deepEqual(publicSmartQuoteHeaders("SES-20261009-0001", null, null), { "Content-Type": "application/json", "Idempotency-Key": "smart-quote:SES-20261009-0001" });
  assert.equal(publicSmartQuoteHeaders("SES-20261009-0001", "v1.a.b", null)["X-Smart-Quote-Link"], "v1.a.b");
  assert.equal(publicSmartQuoteHeaders("SES-20261009-0001", null, "jwt")["Authorization"], "Bearer jwt");
});

// ---- Route: source resolution, response parity, nothing leaked ----

function memory() {
  const versions: SmartQuoteVersion[] = [];
  const leads = new Map<string, { id: string; phone: string; customerId: string | null; notes: string; name: string }>();
  const store: SmartQuoteVersionStore = {
    async findByQuoteNumber(q) { return versions.find((v) => v.quoteNumber === q) || null; },
    async findActiveLeadByPhone(phone) { return (await store.findActiveLeadsByPhone!(phone))[0] ?? null; },
    async findActiveLeadsByPhone(phone) { return [...leads.values()].reverse().filter((l) => l.phone === phone).map((l) => ({ id: l.id, customerId: l.customerId, notes: l.notes, name: l.name, phone: l.phone, city: null })); },
    async getActiveLead(id) { const l = leads.get(id); return l ? { id: l.id, customerId: l.customerId, notes: l.notes, name: l.name, phone: l.phone, city: null } : null; },
    async latestVersionNumber(id) { return Math.max(0, ...versions.filter((v) => v.leadId === id).map((v) => v.versionNumber)); },
    async insert(v) {
      if (versions.some((x) => x.quoteNumber === v.quoteNumber)) return "duplicate_quote";
      if (versions.some((x) => x.leadId === v.leadId && x.versionNumber === v.versionNumber)) return "duplicate_version";
      versions.push(structuredClone(v));
      return "inserted";
    },
    async listByLead(id) { return versions.filter((v) => v.leadId === id).sort((a, b) => b.versionNumber - a.versionNumber); },
    async setPdf() {},
    async replaceLeadNotes(id, expected, next) { const l = leads.get(id); if (!l || l.notes !== expected) return false; l.notes = next; return true; },
    async readLeadNotes(id) { return leads.get(id)?.notes ?? null; },
  };
  const createLead = async (input: SmartQuoteLeadInput, leadId: string, ctx?: { extraNoteLines: string[] }) => {
    leads.set(leadId, { id: leadId, phone: input.phone, customerId: `cust-${leads.size + 1}`, notes: [String(toPublicLeadInput(input).notes), ...(ctx?.extraNoteLines ?? [])].join("\n"), name: input.name });
    return { leadId, customerId: `cust-${leads.size}` };
  };
  return { store, versions, leads, createLead };
}

function body(quoteNumber: string, overrides: Record<string, unknown> = {}) {
  return {
    name: "Ahmed Khan", phone: "0300-4415484", city: "Lahore", quoteNumber, systemCapacityKw: 8, estimatedTotalPkr: 900000,
    panel: "14 x Test 585W", inverter: "1 x Test 8kW", battery: "Not included", structure: "Standard L2", generatedAt: "2026-10-09T05:00:00Z",
    ...overrides,
  };
}

async function withServer<T>(opts: { portalLeadId?: string | null } , run: (ctx: ReturnType<typeof memory> & { post: (b: unknown, headers?: Record<string, string>) => Promise<{ status: number; json: any }> }) => Promise<T>): Promise<T> {
  const m = memory();
  const app = express();
  app.use(express.json());
  app.use("/api/public", createPublicLeadRouter({
    persistLead: async () => { throw new Error("legacy path must not be used"); },
    saveSmartQuote: (input, source: SmartQuoteSource) => saveSmartQuoteSubmission(input, m, source),
    resolvePortalLeadId: opts.portalLeadId === undefined ? undefined : async () => opts.portalLeadId ?? null,
    rateLimit: (_req, _res, next) => next(),
    env: ENV,
  }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const prevJwt = process.env.JWT_SECRET;
  process.env.JWT_SECRET = ENV.JWT_SECRET;
  try {
    const post = async (b: unknown, headers: Record<string, string> = {}) => {
      const res = await fetch(`${base}/api/public/smart-quotes`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(b) });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    return await run({ ...m, post });
  } finally {
    server.close();
    if (prevJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = prevJwt;
  }
}

const shape = (r: { status: number; json: any }) => ({ status: r.status, keys: Object.keys(r.json).sort(), ok: r.json.ok, success: r.json.success, version: r.json.versionNumber, message: r.json.message, hasUpload: "pdfUploadToken" in r.json });
const quiet = async <T>(fn: () => Promise<T>) => { const w = console.warn, i = console.info; console.warn = () => {}; console.info = () => {}; try { return await fn(); } finally { console.warn = w; console.info = i; } };

test("route: a match and a no-match produce identical status and body shape, and the existing lead is untouched", async () => {
  await quiet(() => withServer({}, async (ctx) => {
    const victim = await ctx.post(body("SES-20261009-1111"));
    assert.equal(victim.status, 201);
    const victimId = victim.json.leadId as string;
    const before = JSON.stringify([ctx.leads.get(victimId), ctx.versions.filter((v) => v.leadId === victimId)]);
    const match = await ctx.post(body("SES-20261009-1112"));
    const noMatch = await ctx.post(body("SES-20261009-1113", { phone: "0302-7654321" }));
    assert.deepEqual(shape(match), shape(noMatch));
    assert.equal(match.status, 201);
    assert.notEqual(match.json.leadId, victimId);
    assert.ok(!JSON.stringify(match.json).includes(victimId), "the response never mentions the existing lead");
    assert.equal(JSON.stringify([ctx.leads.get(victimId), ctx.versions.filter((v) => v.leadId === victimId)]), before);
    // Replays are identical in shape too.
    const replayMatch = await ctx.post(body("SES-20261009-1112"));
    const replayNoMatch = await ctx.post(body("SES-20261009-1113", { phone: "0302-7654321" }));
    assert.deepEqual(shape(replayMatch), shape(replayNoMatch));
    assert.equal(replayMatch.json.leadId, match.json.leadId);
  }));
});

test("route: a valid staff link adds the quotation to the named lead; invalid links behave exactly like anonymous", async () => {
  await quiet(() => withServer({}, async (ctx) => {
    const first = await ctx.post(body("SES-20261009-2111"));
    const leadId = first.json.leadId as string;
    const mint = (extra: Partial<Parameters<typeof issueSmartQuoteLinkToken>[0]> = {}, now = Date.now(), ttlSeconds = 3600) => issueSmartQuoteLinkToken({ leadId, phone: PHONE, ttlSeconds, ...extra }, { env: ENV, now }).token;

    const joined = await ctx.post(body("SES-20261009-2112", { estimatedTotalPkr: 950000 }), { [SMART_QUOTE_LINK_HEADER]: mint() });
    assert.equal(joined.status, 201);
    assert.equal(joined.json.leadId, leadId);
    assert.equal(joined.json.versionNumber, 2);

    const cases: [string, Record<string, string>][] = [
      ["forged signature", { [SMART_QUOTE_LINK_HEADER]: mint().replace(/^(.{30})(.)/, (_m, p, c) => p + (c === "A" ? "B" : "A")) }],
      ["expired", { [SMART_QUOTE_LINK_HEADER]: mint({}, Date.now() - 2 * 3600_000) }],
      ["other secret", { [SMART_QUOTE_LINK_HEADER]: issueSmartQuoteLinkToken({ leadId, phone: PHONE }, { env: { ...ENV, JWT_SECRET: "another-secret-another-secret-another-secret-0002" } as NodeJS.ProcessEnv }).token }],
      ["garbage", { [SMART_QUOTE_LINK_HEADER]: "not-a-token" }],
      ["token for a lead that does not exist", { [SMART_QUOTE_LINK_HEADER]: mint({ leadId: "lead-does-not-exist" }) }],
      ["token issued for another phone", { [SMART_QUOTE_LINK_HEADER]: mint({ phone: "03111234567" }) }],
    ];
    const anonymous = await ctx.post(body("SES-20261009-2200"));
    for (const [i, [label, headers]] of cases.entries()) {
      const r = await ctx.post(body(`SES-20261009-23${String(i).padStart(2, "0")}`), headers);
      assert.deepEqual(shape(r), shape(anonymous), label);
      assert.notEqual(r.json.leadId, leadId, label);
      assert.equal(r.json.versionNumber, 1, label);
    }
    assert.deepEqual((await ctx.store.listByLead(leadId)).map((v) => v.versionNumber), [2, 1], "the named lead only gained the one legitimate version");
  }));
});

test("route: the logged-in portal customer's own lead is used; no session or no match is anonymous", async () => {
  // Portal lead resolved: joins.
  const m = memory();
  const app = express();
  app.use(express.json());
  let resolved: string | null = null;
  app.use("/api/public", createPublicLeadRouter({
    persistLead: async () => { throw new Error("unused"); },
    saveSmartQuote: (input, source) => saveSmartQuoteSubmission(input, m, source),
    resolvePortalLeadId: async () => resolved,
    rateLimit: (_req, _res, next) => next(),
    env: ENV,
  }));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/smart-quotes`;
  const post = async (b: unknown) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: (await r.json()) as any }; };
  try {
    await quiet(async () => {
      const seed = await post(body("SES-20261009-3211"));
      resolved = null;
      const anon = await post(body("SES-20261009-3212"));
      assert.notEqual(anon.json.leadId, seed.json.leadId);
      resolved = seed.json.leadId;
      const joined = await post(body("SES-20261009-3213"));
      assert.equal(joined.json.leadId, seed.json.leadId);
      assert.equal(joined.json.versionNumber, 2);
      // A portal resolver that throws never breaks anonymous quoting.
      const boom = express();
      boom.use(express.json());
      boom.use("/api/public", createPublicLeadRouter({ persistLead: async () => { throw new Error("unused"); }, saveSmartQuote: (i, s) => saveSmartQuoteSubmission(i, memory(), s), resolvePortalLeadId: async () => { throw new Error("db down"); }, rateLimit: (_q, _s, n) => n(), env: ENV }));
      const s2 = boom.listen(0);
      try {
        const r = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/api/public/smart-quotes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body("SES-20261009-3214")) });
        assert.equal(r.status, 201);
      } finally { s2.close(); }
    });
  } finally { server.close(); }
});

test("route: the link token is never logged and is not part of the quotation fingerprint", async () => {
  const lines: string[] = [];
  const w = console.warn, i = console.info, e = console.error;
  console.warn = (...a: unknown[]) => { lines.push(a.join(" ")); };
  console.info = (...a: unknown[]) => { lines.push(a.join(" ")); };
  console.error = (...a: unknown[]) => { lines.push(a.join(" ")); };
  try {
    await withServer({}, async (ctx) => {
      const seed = await ctx.post(body("SES-20261009-4111"));
      const good = issueSmartQuoteLinkToken({ leadId: seed.json.leadId, phone: PHONE }, { env: ENV }).token;
      const bad = good.replace(/^(.{30})(.)/, (_m, p, c) => p + (c === "A" ? "B" : "A"));
      const a = await ctx.post(body("SES-20261009-4112"), { [SMART_QUOTE_LINK_HEADER]: good });
      const b = await ctx.post(body("SES-20261009-4113"), { [SMART_QUOTE_LINK_HEADER]: bad });
      assert.equal(a.status, 201);
      assert.equal(b.status, 201);
      // The same quotation retried without the token is a replay, not a conflict.
      const retry = await ctx.post(body("SES-20261009-4112"));
      assert.equal(retry.status, 200);
      assert.equal(retry.json.leadId, seed.json.leadId);
      for (const token of [good, bad]) assert.ok(!lines.some((l) => l.includes(token) || l.includes(token.split(".")[1])), "no log line carries a token or its payload");
      assert.ok(lines.some((l) => /link token ignored \(bad_signature\)/.test(l)), "the rejection reason is logged for operators");
    });
  } finally { console.warn = w; console.info = i; console.error = e; }
});

test("deterministic lead id is still keyed only by the quote number", () => {
  assert.equal(deterministicSmartQuoteLeadId("SES-20261009-0001"), deterministicSmartQuoteLeadId("SES-20261009-0001"));
});
