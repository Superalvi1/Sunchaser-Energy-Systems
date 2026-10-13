import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSmartQuoteLeadPayload, toPublicLeadInput, type SmartQuoteLeadInput } from "./smartQuoteLead.ts";
import {
  deterministicSmartQuoteLeadId,
  possibleExistingClientNoteLine,
  saveSmartQuoteSubmission,
  sharedPhoneNoteLine,
  type SmartQuoteSource,
  type SmartQuoteVersion,
  type SmartQuoteVersionStore,
} from "./smartQuoteVersions.ts";
import { parseSmartQuoteLeadNotes, quoteSnapshot } from "../../src/lib/smartQuoteLead.ts";

function quote(quoteNumber: string, total: number, overrides: Partial<SmartQuoteLeadInput> = {}): SmartQuoteLeadInput {
  const result = validateSmartQuoteLeadPayload({
    name: "Synthetic Client",
    phone: "0300-4415484",
    city: "Lahore",
    quoteNumber,
    systemCapacityKw: 8,
    estimatedTotalPkr: total,
    panel: "14 × Test 585W",
    inverter: "1 × Test 8kW",
    battery: "Not included",
    structure: "Standard L2",
    generatedAt: "2026-10-09T05:00:00Z",
    snapshot: { lines: [{ category: "Equipment", description: "Panels", specification: "585W", unit: "pcs", quantity: 14, unitPricePkr: total / 14, totalPkr: total }], subtotalPkr: total, discountPkr: 0 },
    ...overrides,
  });
  assert.ok(result.ok);
  return result.value;
}

function memoryStore() {
  const versions: SmartQuoteVersion[] = [];
  const leads = new Map<string, { id: string; phone: string; customerId: string | null; notes: string; name: string }>();
  let failNextInsertAs: "duplicate_quote" | "duplicate_version" | null = null;
  const store: SmartQuoteVersionStore = {
    async findByQuoteNumber(quoteNumber) {
      return versions.find((v) => v.quoteNumber === quoteNumber) || null;
    },
    async findActiveLeadByPhone(phone) {
      return (await store.findActiveLeadsByPhone!(phone))[0] ?? null;
    },
    async findActiveLeadsByPhone(phone) {
      // Newest first, like the production query.
      return [...leads.values()].reverse().filter((l) => l.phone === phone).map((lead) => ({ id: lead.id, customerId: lead.customerId, notes: lead.notes, name: lead.name, phone: lead.phone, city: null }));
    },
    async getActiveLead(leadId) {
      const lead = leads.get(leadId);
      return lead ? { id: lead.id, customerId: lead.customerId, notes: lead.notes, name: lead.name, phone: lead.phone, city: null } : null;
    },
    async latestVersionNumber(leadId) {
      return Math.max(0, ...versions.filter((v) => v.leadId === leadId).map((v) => v.versionNumber));
    },
    async insert(version) {
      if (failNextInsertAs) {
        const kind = failNextInsertAs;
        failNextInsertAs = null;
        return kind;
      }
      if (versions.some((v) => v.quoteNumber === version.quoteNumber)) return "duplicate_quote";
      if (versions.some((v) => v.leadId === version.leadId && v.versionNumber === version.versionNumber)) return "duplicate_version";
      versions.push(structuredClone(version));
      return "inserted";
    },
    async listByLead(leadId) {
      return versions.filter((v) => v.leadId === leadId).sort((a, b) => b.versionNumber - a.versionNumber);
    },
    async setPdf(quoteNumber, pdf) {
      const version = versions.find((v) => v.quoteNumber === quoteNumber);
      if (version) version.pdf = pdf;
    },
    async replaceLeadNotes(leadId, expected, next) {
      const lead = leads.get(leadId);
      if (!lead || lead.notes !== expected) return false;
      lead.notes = next;
      return true;
    },
    async readLeadNotes(leadId) {
      return leads.get(leadId)?.notes ?? null;
    },
  };
  const createLead = async (input: SmartQuoteLeadInput, leadId: string, context?: { extraNoteLines: string[]; phoneAlreadyInCrm: boolean }) => {
    const notes = [String(toPublicLeadInput(input).notes), ...(context?.extraNoteLines ?? [])].join("\n");
    leads.set(leadId, { id: leadId, phone: input.phone, customerId: `cust-${leads.size + 1}`, notes, name: input.name });
    return { leadId, customerId: `cust-${leads.size}` };
  };
  return { store, versions, leads, createLead, failNext: (kind: "duplicate_quote" | "duplicate_version") => { failNextInsertAs = kind; } };
}

test("a client's revised quotation joins their lead as version 2 only through a verified source", async () => {
  const m = memoryStore();
  const first = await saveSmartQuoteSubmission(quote("SES-20261009-1001", 900000), m);
  assert.ok(first.kind === "created");
  const second = await saveSmartQuoteSubmission(quote("SES-20261009-1002", 950000), m, { kind: "verified-lead", leadId: first.leadId, via: "staff-link-token" });
  assert.equal(second.kind, "created");
  assert.ok(second.kind !== "conflict");
  assert.equal(first.leadId, second.leadId);
  assert.equal(m.leads.size, 1);
  assert.deepEqual(m.versions.map((v) => [v.quoteNumber, v.versionNumber, v.totalPkr]), [["SES-20261009-1001", 1, 900000], ["SES-20261009-1002", 2, 950000]]);
  const notes = m.leads.get(first.leadId)!.notes;
  assert.equal(parseSmartQuoteLeadNotes(notes)?.quoteNumber, "SES-20261009-1002", "the lead summary shows the latest quotation");
  assert.match(notes, /^Version: 2$/m);
  assert.equal(m.versions[0].totalPkr, 900000, "the earlier version is not overwritten");
});

test("the same anonymous visitor submitting a second, different quotation gets a second lead (no phone-only attachment)", async () => {
  const m = memoryStore();
  const first = await saveSmartQuoteSubmission(quote("SES-20261009-1011", 900000), m);
  const second = await saveSmartQuoteSubmission(quote("SES-20261009-1012", 950000), m);
  assert.ok(first.kind === "created" && second.kind === "created");
  assert.notEqual(first.leadId, second.leadId);
  assert.equal(m.leads.size, 2);
});

test("a retry of the same quotation replays without a duplicate lead or version", async () => {
  const m = memoryStore();
  const input = quote("SES-20261009-2001", 900000);
  const first = await saveSmartQuoteSubmission(input, m);
  const retry = await saveSmartQuoteSubmission({ ...input, generatedAt: "2026-10-09T05:01:00.000Z" }, m);
  assert.equal(retry.kind, "replay");
  assert.ok(first.kind !== "conflict" && retry.kind !== "conflict");
  assert.equal(retry.leadId, first.leadId);
  assert.equal(m.leads.size, 1);
  assert.equal(m.versions.length, 1);
});

test("a different quotation reusing a quote number is rejected, not merged", async () => {
  const m = memoryStore();
  await saveSmartQuoteSubmission(quote("SES-20261009-3001", 900000), m);
  const clash = await saveSmartQuoteSubmission(quote("SES-20261009-3001", 1, { phone: "03011234567" }), m);
  assert.equal(clash.kind, "conflict");
  assert.equal(m.versions.length, 1);
  assert.equal(m.versions[0].totalPkr, 900000);
});

test("a concurrent identical request that wins the insert race is treated as a replay", async () => {
  const m = memoryStore();
  const input = quote("SES-20261009-4001", 900000);
  await saveSmartQuoteSubmission(input, m);
  const winner = m.versions[0];
  m.versions.length = 0;
  m.failNext("duplicate_quote");
  const original = m.store.findByQuoteNumber;
  let calls = 0;
  m.store.findByQuoteNumber = async (n) => (calls++ === 0 ? null : winner.quoteNumber === n ? winner : original(n));
  const result = await saveSmartQuoteSubmission(input, m);
  assert.equal(result.kind, "replay");
});

test("version numbers retry when two revisions race", async () => {
  const m = memoryStore();
  const first = await saveSmartQuoteSubmission(quote("SES-20261009-5001", 900000), m);
  assert.ok(first.kind === "created");
  m.failNext("duplicate_version");
  const result = await saveSmartQuoteSubmission(quote("SES-20261009-5002", 910000), m, { kind: "verified-lead", leadId: first.leadId, via: "staff-link-token" });
  assert.equal(result.kind, "created");
  assert.equal(m.versions.at(-1)?.versionNumber, 2);
});

test("a quotation recorded before version history is preserved as version 1 when a verified source revises it", async () => {
  const m = memoryStore();
  const legacy = quote("SES-20261001-6001", 880000);
  const legacyNotes = `${toPublicLeadInput(legacy).notes}\nPdfArchive: ${JSON.stringify({ quoteNumber: "SES-20261001-6001", fileName: "q.pdf", fileUrl: `/api/storage/object/customer-documents/${Buffer.from("smart-quotes/lead-legacy/q.pdf").toString("base64url")}?sig=x`, sha256: "a".repeat(64), savedAt: "2026-10-01T05:00:00Z", sizeBytes: 1000 })}\nStaff: called client`;
  m.leads.set("lead-legacy", { id: "lead-legacy", phone: legacy.phone, customerId: "cust-legacy", notes: legacyNotes, name: "Synthetic Client" });
  const result = await saveSmartQuoteSubmission(quote("SES-20261009-6002", 920000), m, { kind: "verified-lead", leadId: "lead-legacy", via: "portal-session" });
  assert.ok(result.kind === "created");
  assert.equal(result.leadId, "lead-legacy");
  assert.deepEqual(m.versions.map((v) => [v.quoteNumber, v.versionNumber]), [["SES-20261001-6001", 1], ["SES-20261009-6002", 2]]);
  assert.equal(m.versions[0].totalPkr, 880000);
  assert.deepEqual(m.versions[0].lines, quoteSnapshot(legacyNotes)?.lines, "historical line prices are kept as originally quoted");
  assert.equal(m.versions[0].pdf?.storagePath, "smart-quotes/lead-legacy/q.pdf");
  assert.match(m.leads.get("lead-legacy")!.notes, /Staff: called client/, "staff notes survive the summary update");
});

test("new client leads get a deterministic id so concurrent first submissions converge", () => {
  assert.equal(deterministicSmartQuoteLeadId("SES-20261009-7001"), deterministicSmartQuoteLeadId("SES-20261009-7001"));
  assert.notEqual(deterministicSmartQuoteLeadId("SES-20261009-7001"), deterministicSmartQuoteLeadId("SES-20261009-7002"));
  assert.match(deterministicSmartQuoteLeadId("SES-20261009-7001"), /^lead-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
});

// ---- Anonymous submissions never attach to an existing lead; only a verified source can. ----

const SHARED = "0301-2345678";
const blockLines = (notes: string) => notes.split("\n").filter((line) => /^(SMART_QUOTE_V1|Quote|Version|System|Estimate|Panel|Inverter|Battery|Structure|Generated|Snapshot): ?/.test(line) || line === "SMART_QUOTE_V1");
const possibleLines = (notes: string) => notes.split("\n").filter((line) => line.startsWith("Possible existing client:"));
const sharedLines = (notes: string) => notes.split("\n").filter((line) => line.startsWith("Shared phone number:"));
const snapshotOf = (m: ReturnType<typeof memoryStore>, leadId: string) => JSON.stringify({ lead: m.leads.get(leadId), versions: m.versions.filter((v) => v.leadId === leadId) });

test("an anonymous revision with the same name and phone is its own new lead, flagged for staff, and never touches the first lead", async () => {
  const m = memoryStore();
  const a1 = await saveSmartQuoteSubmission(quote("SES-20261009-8101", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(a1.kind === "created");
  const before = snapshotOf(m, a1.leadId);
  const a2 = await saveSmartQuoteSubmission(quote("SES-20261009-8102", 950000, { name: "AHMED KHAN", phone: SHARED }), m);
  assert.ok(a2.kind === "created");
  assert.notEqual(a2.leadId, a1.leadId, "a quotation from the public form never joins an existing lead");
  assert.equal(a2.leadId, deterministicSmartQuoteLeadId("SES-20261009-8102"));
  assert.equal(a2.versionNumber, 1);
  assert.equal(a2.leadCreated, true);
  assert.equal(a2.attached, false);
  assert.equal(snapshotOf(m, a1.leadId), before, "the existing lead and its version list are byte-identical");
  assert.deepEqual((await m.store.listByLead(a1.leadId)).map((v) => v.quoteNumber), ["SES-20261009-8101"]);
  const notes = m.leads.get(a2.leadId)!.notes;
  assert.equal(possibleLines(notes).length, 1);
  assert.ok(possibleLines(notes)[0].includes(a1.leadId) && /Ahmed Khan/.test(possibleLines(notes)[0]) && /unverified/.test(possibleLines(notes)[0]));
  assert.equal(parseSmartQuoteLeadNotes(notes)?.quoteNumber, "SES-20261009-8102", "the note does not disturb the quotation block");
  assert.equal(possibleLines(m.leads.get(a1.leadId)!.notes).length, 0, "nothing is written on the existing lead");
});

test("an attacker who knows a client's exact name and phone cannot inject a quotation, move the sort key, or learn anything", async () => {
  const m = memoryStore();
  const victim = await saveSmartQuoteSubmission(quote("SES-20261009-8401", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(victim.kind === "created");
  const before = snapshotOf(m, victim.leadId);
  const attack = await saveSmartQuoteSubmission(quote("SES-20261009-8402", 1, { name: "Ahmed Khan", phone: SHARED, generatedAt: "2099-01-01T00:00:00.000Z" }), m);
  const control = await saveSmartQuoteSubmission(quote("SES-20261009-8403", 1, { name: "Ahmed Khan", phone: "0302-7654321", generatedAt: "2099-01-01T00:00:00.000Z" }), m);
  assert.ok(attack.kind === "created" && control.kind === "created");
  assert.deepEqual(
    { versionNumber: attack.versionNumber, leadCreated: attack.leadCreated, keys: Object.keys(attack).sort() },
    { versionNumber: control.versionNumber, leadCreated: control.leadCreated, keys: Object.keys(control).sort() },
    "match and no-match results have the same shape and values",
  );
  assert.notEqual(attack.leadId, victim.leadId);
  assert.equal(snapshotOf(m, victim.leadId), before);
  assert.ok(!/Generated: 2099/.test(m.leads.get(victim.leadId)!.notes));
});

test("a different client on the same phone gets a separate lead with a weaker shared-phone hint", async () => {
  const m = memoryStore();
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-8201", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(a.kind === "created");
  const before = snapshotOf(m, a.leadId);
  const b = await saveSmartQuoteSubmission(quote("SES-20261009-8202", 1200000, { name: "Sana Malik", phone: SHARED, city: "Karachi" }), m);
  assert.ok(b.kind === "created" && b.leadCreated);
  assert.notEqual(b.leadId, a.leadId);
  assert.equal(snapshotOf(m, a.leadId), before);
  const notes = m.leads.get(b.leadId)!.notes;
  assert.deepEqual(sharedLines(notes), [sharedPhoneNoteLine([a.leadId])]);
  assert.equal(possibleLines(notes).length, 0, "a different name is not a 'possible existing client'");
  assert.ok(!/Ahmed|Khan/.test(sharedLines(notes).join("")), "the weak hint names no client, only the lead id");
});

test("the retry of an anonymous quotation replays on its own lead, however many leads share the number", async () => {
  const m = memoryStore();
  await saveSmartQuoteSubmission(quote("SES-20261009-8301", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  const input = quote("SES-20261009-8302", 910000, { name: "Ahmed Khan", phone: SHARED });
  const first = await saveSmartQuoteSubmission(input, m);
  const retry = await saveSmartQuoteSubmission({ ...input, generatedAt: "2026-10-09T05:09:00.000Z" }, m);
  assert.ok(first.kind === "created" && retry.kind === "replay");
  assert.equal(retry.leadId, first.leadId);
  assert.equal(retry.versionNumber, 1);
  assert.equal(m.leads.size, 2);
  assert.equal(m.versions.length, 2);
  // Replay ignores the source: a replay with a token for another lead still answers with the original lead.
  const withLink = await saveSmartQuoteSubmission(input, m, { kind: "verified-lead", leadId: "lead-other", via: "staff-link-token" });
  assert.ok(withLink.kind === "replay" && withLink.leadId === first.leadId);
});

test("a store with only the single-lead lookup still never attaches anonymously", async () => {
  const m = memoryStore();
  delete (m.store as { findActiveLeadsByPhone?: unknown }).findActiveLeadsByPhone;
  m.store.findActiveLeadByPhone = async (phone) => {
    const lead = [...m.leads.values()].find((l) => l.phone === phone);
    return lead ? { id: lead.id, customerId: lead.customerId, notes: lead.notes, name: lead.name, phone: lead.phone, city: null } : null;
  };
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-8801", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  const b = await saveSmartQuoteSubmission(quote("SES-20261009-8802", 1200000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(a.kind === "created" && b.kind === "created");
  assert.notEqual(a.leadId, b.leadId);
});

test("the possible-existing-client note is bounded, single-line and carries no control characters", () => {
  const line = possibleExistingClientNoteLine([
    { id: "lead-2", name: "Evil\nName: injected\r\nSMART_QUOTE_V1" },
    { id: "lead-1", name: "A".repeat(500) },
    { id: "lead-3", name: "C" }, { id: "lead-4", name: "D" }, { id: "lead-5", name: "E" },
  ]);
  assert.ok(!/[\r\n]/.test(line));
  assert.match(line, /^Possible existing client: lead-1 \(A{60}\), lead-2 \(Evil Name: injected SMART_QUOTE_V1\), lead-3 \(C\) and 2 more, unverified/);
  assert.ok(line.length < 400);
});

// ---- Verified sources ----

test("a verified link joins exactly the lead it names as the next version, keeping the lead's identity and staff notes", async () => {
  const m = memoryStore();
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-9101", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(a.kind === "created");
  m.leads.get(a.leadId)!.notes += "\nStaff: prefers evening calls";
  const link: SmartQuoteSource = { kind: "verified-lead", leadId: a.leadId, via: "staff-link-token", issuedForPhone: SHARED };
  const rev = await saveSmartQuoteSubmission(quote("SES-20261009-9102", 950000, { name: "A. Khan (typed differently)", phone: SHARED }), m, link);
  assert.ok(rev.kind === "created");
  assert.equal(rev.leadId, a.leadId);
  assert.equal(rev.versionNumber, 2);
  assert.equal(rev.attached, true);
  assert.equal(rev.leadCreated, false);
  assert.equal(m.leads.size, 1);
  const lead = m.leads.get(a.leadId)!;
  assert.equal(lead.name, "Ahmed Khan", "the lead's name is never overwritten");
  assert.match(lead.notes, /Staff: prefers evening calls/);
  assert.equal(parseSmartQuoteLeadNotes(lead.notes)?.quoteNumber, "SES-20261009-9102");
  assert.deepEqual((await m.store.listByLead(a.leadId)).map((v) => v.versionNumber), [2, 1]);
  // Retrying the joined quotation replays; it does not add version 3.
  const retry = await saveSmartQuoteSubmission(quote("SES-20261009-9102", 950000, { name: "A. Khan (typed differently)", phone: SHARED }), m, link);
  assert.ok(retry.kind === "replay" && retry.leadId === a.leadId && retry.versionNumber === 2);
});

test("a verified link is ignored (anonymous behaviour) when the lead is missing, deleted, or its phone differs from the quote or from the token", async () => {
  const m = memoryStore();
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-9201", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(a.kind === "created");
  const before = snapshotOf(m, a.leadId);
  const run = async (n: string, source: SmartQuoteSource, overrides: Partial<SmartQuoteLeadInput> = {}) => {
    const r = await saveSmartQuoteSubmission(quote(n, 1000, { name: "Ahmed Khan", phone: SHARED, ...overrides }), m, source);
    assert.ok(r.kind === "created");
    assert.notEqual(r.leadId, a.leadId, `${n} must not join`);
    assert.equal(r.versionNumber, 1);
    assert.equal(r.leadCreated, true);
    return r;
  };
  const missing = await run("SES-20261009-9202", { kind: "verified-lead", leadId: "lead-does-not-exist", via: "staff-link-token" });
  assert.equal(missing.fallback, "lead_unavailable");
  const otherPhoneQuote = await run("SES-20261009-9203", { kind: "verified-lead", leadId: a.leadId, via: "staff-link-token", issuedForPhone: SHARED }, { phone: "0302-1112223" });
  assert.equal(otherPhoneQuote.fallback, "phone_mismatch");
  // The lead's phone changed after the token was issued: the old token can no longer be replayed against it.
  m.leads.get(a.leadId)!.phone = "03045556667";
  const changed = await run("SES-20261009-9204", { kind: "verified-lead", leadId: a.leadId, via: "staff-link-token", issuedForPhone: SHARED }, { phone: "03045556667" });
  assert.equal(changed.fallback, "phone_mismatch");
  m.leads.get(a.leadId)!.phone = SHARED;
  assert.equal(snapshotOf(m, a.leadId), before.replace(/"phone":"[^"]*"/, '"phone":"' + SHARED + '"'), "the targeted lead never changed");
  // A deleted lead is not an attachment target.
  m.store.getActiveLead = async () => null;
  const gone = await run("SES-20261009-9205", { kind: "verified-lead", leadId: a.leadId, via: "portal-session" });
  assert.equal(gone.fallback, "lead_unavailable");
});

test("a verified link names one lead: it cannot attach to a different lead of the same phone", async () => {
  const m = memoryStore();
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-9301", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  const b = await saveSmartQuoteSubmission(quote("SES-20261009-9302", 800000, { name: "Sana Malik", phone: SHARED }), m);
  assert.ok(a.kind === "created" && b.kind === "created");
  const r = await saveSmartQuoteSubmission(quote("SES-20261009-9303", 850000, { name: "Sana Malik", phone: SHARED }), m, { kind: "verified-lead", leadId: a.leadId, via: "staff-link-token" });
  assert.ok(r.kind === "created");
  assert.equal(r.leadId, a.leadId, "joins the lead the token names, not the name-matching one");
  assert.deepEqual((await m.store.listByLead(b.leadId)).map((v) => v.quoteNumber), ["SES-20261009-9302"]);
});

test("a linked legacy lead keeps its pre-history quotation as version 1", async () => {
  const m = memoryStore();
  const legacy = quote("SES-20261001-6001", 880000);
  m.leads.set("lead-legacy", { id: "lead-legacy", phone: legacy.phone, customerId: "cust-legacy", notes: String(toPublicLeadInput(legacy).notes), name: "Synthetic Client" });
  const r = await saveSmartQuoteSubmission(quote("SES-20261009-9401", 920000), m, { kind: "verified-lead", leadId: "lead-legacy", via: "portal-session" });
  assert.ok(r.kind === "created" && r.leadId === "lead-legacy");
  assert.deepEqual(m.versions.map((v) => [v.quoteNumber, v.versionNumber]), [["SES-20261001-6001", 1], ["SES-20261009-9401", 2]]);
});

test("an anonymous submission never preserves or rewrites another lead's legacy quotation", async () => {
  const m = memoryStore();
  const legacy = quote("SES-20261001-6101", 880000);
  m.leads.set("lead-legacy", { id: "lead-legacy", phone: legacy.phone, customerId: "cust-legacy", notes: String(toPublicLeadInput(legacy).notes), name: "Synthetic Client" });
  const before = m.leads.get("lead-legacy")!.notes;
  const r = await saveSmartQuoteSubmission(quote("SES-20261009-9402", 920000), m);
  assert.ok(r.kind === "created" && r.leadId !== "lead-legacy");
  assert.equal(m.leads.get("lead-legacy")!.notes, before);
  assert.equal(m.versions.filter((v) => v.leadId === "lead-legacy").length, 0, "no history rows are written for the existing lead");
});

test("the WhatsApp-verified phone joins a lead only when the name also plausibly matches", async () => {
  const m = memoryStore();
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-9501", 900000, { name: "Ahmed Khan", phone: "+923012345678" }), m, { kind: "verified-phone", via: "whatsapp-sender" });
  assert.ok(a.kind === "created" && a.leadCreated, "no existing lead: a new one is created");
  const same = await saveSmartQuoteSubmission(quote("SES-20261009-9502", 910000, { name: "Mr. Ahmed Khan", phone: "03012345678" }), m, { kind: "verified-phone", via: "whatsapp-sender" });
  assert.ok(same.kind === "created" && same.leadId === a.leadId && same.versionNumber === 2);
  const other = await saveSmartQuoteSubmission(quote("SES-20261009-9503", 920000, { name: "Sana Malik", phone: "03012345678" }), m, { kind: "verified-phone", via: "whatsapp-sender" });
  assert.ok(other.kind === "created" && other.leadId !== a.leadId, "a different name on the same number stays separate");
  assert.equal(sharedLines(m.leads.get(other.leadId)!.notes).length, 1);
  assert.equal(sharedLines(m.leads.get(a.leadId)!.notes).length, 0, "the existing lead is not edited to say so");
});

// ---- Concurrency, failures ----

test("concurrent identical first submissions converge on one lead even when the losing lead insert fails", async () => {
  const m = memoryStore();
  const input = quote("SES-20261009-8901", 900000, { name: "Concurrent Newcomer", phone: "0302-1112223" });
  const winner = await saveSmartQuoteSubmission(input, m);
  assert.ok(winner.kind === "created");
  // The second request looked up the number before the winner committed, then its own lead insert hit the primary key.
  const original = m.store.findActiveLeadsByPhone!;
  let lookups = 0;
  m.store.findActiveLeadsByPhone = async (phone) => (lookups++ === 0 ? [] : original(phone));
  const loserDeps = { ...m, createLead: async () => { throw new Error("Failed to persist public lead."); } };
  m.versions.length = 0; // the winner's version is not visible to the loser yet
  const loser = await saveSmartQuoteSubmission(input, loserDeps);
  assert.ok(loser.kind === "created" || loser.kind === "replay");
  assert.equal(loser.kind === "conflict" ? "" : loser.leadId, winner.leadId, "the loser attaches to the winner's deterministic lead");
  assert.equal(m.leads.size, 1);
});

test("a crashed first attempt (lead exists, no version) is completed by the retry on the same deterministic lead", async () => {
  const m = memoryStore();
  const input = quote("SES-20261009-8903", 900000, { name: "Crash Retry", phone: "0302-3334445" });
  await m.createLead(input, deterministicSmartQuoteLeadId(input.quoteNumber));
  const r = await saveSmartQuoteSubmission(input, m);
  assert.ok(r.kind === "created" && r.leadId === deterministicSmartQuoteLeadId(input.quoteNumber) && r.versionNumber === 1);
  assert.equal(m.leads.size, 1);
  assert.equal(m.versions.length, 1);
});

test("parallel linked submissions all land on the named lead with distinct, gapless version numbers", async () => {
  const m = memoryStore();
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-9601", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(a.kind === "created");
  const link: SmartQuoteSource = { kind: "verified-lead", leadId: a.leadId, via: "staff-link-token", issuedForPhone: SHARED };
  const results = await Promise.all([2, 3, 4, 5].map((n) => saveSmartQuoteSubmission(quote(`SES-20261009-960${n}`, 900000 + n, { name: "Ahmed Khan", phone: SHARED }), m, link)));
  assert.ok(results.every((r) => r.kind === "created" && r.leadId === a.leadId));
  const numbers = (await m.store.listByLead(a.leadId)).map((v) => v.versionNumber).sort((x, y) => x - y);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5]);
});

test("a lead insert failure with no concurrent winner is still an error", async () => {
  const m = memoryStore();
  await assert.rejects(saveSmartQuoteSubmission(quote("SES-20261009-8902", 900000, { name: "Nobody Yet", phone: "0302-2223334" }), { ...m, createLead: async () => { throw new Error("db down"); } }), /db down/);
  assert.equal(m.leads.size, 0);
});

test("review notes are handed to lead creation, and the phone is flagged as already in the CRM only when another lead has it", async () => {
  const m = memoryStore();
  const seen: { extraNoteLines: string[]; phoneAlreadyInCrm: boolean }[] = [];
  const createLead = async (input: SmartQuoteLeadInput, leadId: string, context: { extraNoteLines: string[]; phoneAlreadyInCrm: boolean }) => {
    seen.push(context);
    return m.createLead(input, leadId);
  };
  await saveSmartQuoteSubmission(quote("SES-20261009-9701", 900000, { name: "Ahmed Khan", phone: SHARED }), { ...m, createLead });
  await saveSmartQuoteSubmission(quote("SES-20261009-9702", 900000, { name: "Ahmed Khan", phone: SHARED }), { ...m, createLead });
  assert.deepEqual(seen.map((c) => c.phoneAlreadyInCrm), [false, true]);
  assert.equal(seen[0].extraNoteLines.length, 0);
  assert.equal(seen[1].extraNoteLines.length, 1);
});
