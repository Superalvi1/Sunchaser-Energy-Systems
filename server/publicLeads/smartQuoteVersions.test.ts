import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSmartQuoteLeadPayload, toPublicLeadInput, type SmartQuoteLeadInput } from "./smartQuoteLead.ts";
import {
  deterministicSmartQuoteLeadId,
  saveSmartQuoteSubmission,
  sharedPhoneNoteLine,
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
  const createLead = async (input: SmartQuoteLeadInput, leadId: string) => {
    leads.set(leadId, { id: leadId, phone: input.phone, customerId: `cust-${leads.size + 1}`, notes: String(toPublicLeadInput(input).notes), name: input.name });
    return { leadId, customerId: `cust-${leads.size}` };
  };
  return { store, versions, leads, createLead, failNext: (kind: "duplicate_quote" | "duplicate_version") => { failNextInsertAs = kind; } };
}

test("a returning client's revised quotation becomes version 2 of the same lead", async () => {
  const m = memoryStore();
  const first = await saveSmartQuoteSubmission(quote("SES-20261009-1001", 900000), m);
  const second = await saveSmartQuoteSubmission(quote("SES-20261009-1002", 950000), m);
  assert.equal(first.kind, "created");
  assert.equal(second.kind, "created");
  assert.ok(first.kind !== "conflict" && second.kind !== "conflict");
  assert.equal(first.leadId, second.leadId, "the same phone must not create a second lead");
  assert.equal(m.leads.size, 1);
  assert.deepEqual(m.versions.map((v) => [v.quoteNumber, v.versionNumber, v.totalPkr]), [["SES-20261009-1001", 1, 900000], ["SES-20261009-1002", 2, 950000]]);
  const notes = m.leads.get(first.leadId)!.notes;
  assert.equal(parseSmartQuoteLeadNotes(notes)?.quoteNumber, "SES-20261009-1002", "the lead summary shows the latest quotation");
  assert.match(notes, /^Version: 2$/m);
  assert.equal(m.versions[0].totalPkr, 900000, "the earlier version is not overwritten");
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
  await saveSmartQuoteSubmission(quote("SES-20261009-5001", 900000), m);
  m.failNext("duplicate_version");
  const result = await saveSmartQuoteSubmission(quote("SES-20261009-5002", 910000), m);
  assert.equal(result.kind, "created");
  assert.equal(m.versions.at(-1)?.versionNumber, 2);
});

test("a quotation recorded before version history is preserved as version 1", async () => {
  const m = memoryStore();
  const legacy = quote("SES-20261001-6001", 880000);
  const legacyNotes = `${toPublicLeadInput(legacy).notes}\nPdfArchive: ${JSON.stringify({ quoteNumber: "SES-20261001-6001", fileName: "q.pdf", fileUrl: `/api/storage/object/customer-documents/${Buffer.from("smart-quotes/lead-legacy/q.pdf").toString("base64url")}?sig=x`, sha256: "a".repeat(64), savedAt: "2026-10-01T05:00:00Z", sizeBytes: 1000 })}\nStaff: called client`;
  m.leads.set("lead-legacy", { id: "lead-legacy", phone: legacy.phone, customerId: "cust-legacy", notes: legacyNotes, name: "Synthetic Client" });
  const result = await saveSmartQuoteSubmission(quote("SES-20261009-6002", 920000), m);
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

// ---- Shared phone numbers: a phone alone must not decide which client a quotation belongs to. ----

const SHARED = "0301-2345678";
const blockLines = (notes: string) => notes.split("\n").filter((line) => /^(SMART_QUOTE_V1|Quote|Version|System|Estimate|Panel|Inverter|Battery|Structure|Generated|Snapshot): ?/.test(line) || line === "SMART_QUOTE_V1");
const sharedLines = (notes: string) => notes.split("\n").filter((line) => line.startsWith("Shared phone number:"));

test("spelling, case, spacing and honorific variants of the same client revise the same lead", async () => {
  const m = memoryStore();
  const names = ["Ahmed Khan", "  AHMED   khan ", "Mr. Ahmed Khan.", "khan, ahmed", "Ahmed Raza Khan"];
  const results = [];
  for (const [index, name] of names.entries()) results.push(await saveSmartQuoteSubmission(quote(`SES-20261009-80${String(index).padStart(2, "0")}`, 900000 + index, { name, phone: SHARED }), m));
  assert.ok(results.every((r) => r.kind === "created"));
  assert.equal(new Set(results.map((r) => (r.kind === "conflict" ? "" : r.leadId))).size, 1);
  assert.equal(m.leads.size, 1);
  assert.deepEqual(m.versions.map((v) => v.versionNumber), [1, 2, 3, 4, 5]);
  assert.equal([...m.leads.values()][0].name, "Ahmed Khan", "the lead name is never overwritten by a variant");
  assert.equal(sharedLines([...m.leads.values()][0].notes).length, 0, "no shared-phone note for a single client");
});

test("a different client on the same phone gets a separate lead and never joins the first client's versions", async () => {
  const m = memoryStore();
  const a1 = await saveSmartQuoteSubmission(quote("SES-20261009-8101", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  const a2 = await saveSmartQuoteSubmission(quote("SES-20261009-8102", 950000, { name: "AHMED KHAN", phone: SHARED }), m);
  assert.ok(a1.kind === "created" && a2.kind === "created" && a1.leadId === a2.leadId);
  const leadA = m.leads.get(a1.leadId)!;
  const before = { name: leadA.name, phone: leadA.phone, customerId: leadA.customerId, block: blockLines(leadA.notes) };

  const b = await saveSmartQuoteSubmission(quote("SES-20261009-8103", 1200000, { name: "Sana Malik", phone: SHARED, city: "Karachi" }), m);
  assert.ok(b.kind === "created");
  assert.notEqual(b.leadId, a1.leadId, "different person, separate lead");
  assert.equal(b.leadId, deterministicSmartQuoteLeadId("SES-20261009-8103"), "the separate lead id is deterministic per first quote number");
  assert.equal(b.versionNumber, 1, "the response looks like a brand-new client's");
  assert.equal(b.leadCreated, true);
  assert.equal(m.leads.size, 2);

  assert.deepEqual((await m.store.listByLead(a1.leadId)).map((v) => v.quoteNumber), ["SES-20261009-8102", "SES-20261009-8101"], "A's version list does not contain B");
  assert.deepEqual((await m.store.listByLead(b.leadId)).map((v) => [v.quoteNumber, v.clientName, v.versionNumber]), [["SES-20261009-8103", "Sana Malik", 1]]);

  // A's identity and latest-quotation block are byte-identical; only a shared-phone line was added to the human notes.
  assert.deepEqual({ name: leadA.name, phone: leadA.phone, customerId: leadA.customerId, block: blockLines(leadA.notes) }, before);
  assert.equal(parseSmartQuoteLeadNotes(leadA.notes)?.quoteNumber, "SES-20261009-8102");
  assert.match(leadA.notes, /^Version: 2$/m);
  const leadB = m.leads.get(b.leadId)!;
  assert.deepEqual(sharedLines(leadA.notes), [sharedPhoneNoteLine([b.leadId])]);
  assert.deepEqual(sharedLines(leadB.notes), [sharedPhoneNoteLine([a1.leadId])]);
  assert.ok(![leadA.notes, leadB.notes].some((n) => /Sana|Malik|Ahmed|Khan/.test(sharedLines(n).join("\n"))), "the note names no client, only lead ids");
  assert.equal(parseSmartQuoteLeadNotes(leadB.notes)?.quoteNumber, "SES-20261009-8103");
});

test("the second client's retry replays on their own lead; the first client's later revision still finds the first lead", async () => {
  const m = memoryStore();
  const a1 = await saveSmartQuoteSubmission(quote("SES-20261009-8201", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  const bInput = quote("SES-20261009-8202", 1200000, { name: "Sana Malik", phone: SHARED });
  const b1 = await saveSmartQuoteSubmission(bInput, m);
  const b2 = await saveSmartQuoteSubmission({ ...bInput, generatedAt: "2026-10-09T05:09:00.000Z" }, m);
  assert.ok(a1.kind === "created" && b1.kind === "created" && b2.kind === "replay");
  assert.equal(b2.leadId, b1.leadId);
  assert.equal(b2.versionNumber, 1);
  assert.equal(m.leads.size, 2);
  assert.equal(m.versions.length, 2);

  const a2 = await saveSmartQuoteSubmission(quote("SES-20261009-8203", 910000, { name: "ahmed khan", phone: SHARED }), m);
  const b3 = await saveSmartQuoteSubmission(quote("SES-20261009-8204", 1250000, { name: "Ms. Sana  Malik", phone: SHARED }), m);
  assert.ok(a2.kind === "created" && b3.kind === "created");
  assert.equal(a2.leadId, a1.leadId);
  assert.equal(a2.versionNumber, 2);
  assert.equal(b3.leadId, b1.leadId, "with two leads on the number, the identity picks the right one");
  assert.equal(b3.versionNumber, 2);
  assert.equal(parseSmartQuoteLeadNotes(m.leads.get(a1.leadId)!.notes)?.quoteNumber, "SES-20261009-8203");
  assert.equal(parseSmartQuoteLeadNotes(m.leads.get(b1.leadId)!.notes)?.quoteNumber, "SES-20261009-8204");
  assert.equal(m.leads.size, 2, "no third lead was created");
});

test("a typo'd name on a shared phone is kept apart from the first client (trade-off: staff merge deliberately)", async () => {
  const m = memoryStore();
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-8301", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  const typo = await saveSmartQuoteSubmission(quote("SES-20261009-8302", 880000, { name: "Ahmad Khan", phone: SHARED }), m);
  assert.ok(a.kind === "created" && typo.kind === "created");
  assert.notEqual(typo.leadId, a.leadId);
  assert.equal(m.leads.size, 2);
  assert.equal(parseSmartQuoteLeadNotes(m.leads.get(a.leadId)!.notes)?.quoteNumber, "SES-20261009-8301", "the first client's latest quotation is untouched");
  assert.equal(sharedLines(m.leads.get(a.leadId)!.notes).length, 1);
  assert.equal(sharedLines(m.leads.get(typo.leadId)!.notes).length, 1);
});

test("a stranger who only knows the phone number cannot change the existing lead or learn that it exists", async () => {
  const m = memoryStore();
  const victim = await saveSmartQuoteSubmission(quote("SES-20261009-8401", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(victim.kind === "created");
  const victimNotes = m.leads.get(victim.leadId)!.notes;
  const probe = await saveSmartQuoteSubmission(quote("SES-20261009-8402", 1, { name: "Unrelated Prober", phone: SHARED, generatedAt: "2099-01-01T00:00:00.000Z" }), m);
  const fresh = await saveSmartQuoteSubmission(quote("SES-20261009-8403", 1, { name: "Unrelated Prober", phone: "0302-7654321", generatedAt: "2099-01-01T00:00:00.000Z" }), m);
  assert.ok(probe.kind === "created" && fresh.kind === "created");
  assert.equal(probe.versionNumber, fresh.versionNumber, "same version number as a brand-new number");
  assert.equal(probe.leadCreated, fresh.leadCreated);
  assert.notEqual(probe.leadId, victim.leadId, "the response never carries the victim's lead id");
  const after = m.leads.get(victim.leadId)!.notes;
  assert.deepEqual(blockLines(after), blockLines(victimNotes), "latest quotation, estimate and Generated (sort key) are unchanged");
  assert.ok(!/Generated: 2099/.test(after));
  assert.deepEqual((await m.store.listByLead(victim.leadId)).map((v) => v.quoteNumber), ["SES-20261009-8401"]);
});

test("the shared-phone note is idempotent, bounded, and keeps staff notes", async () => {
  const m = memoryStore();
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-8501", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(a.kind === "created");
  m.leads.get(a.leadId)!.notes += "\nStaff: client prefers evening calls";
  const others = [];
  for (let i = 0; i < 6; i++) {
    const r = await saveSmartQuoteSubmission(quote(`SES-20261009-86${String(i).padStart(2, "0")}`, 700000 + i, { name: `Other Person${"abcdef"[i]} Surname`, phone: SHARED }), m);
    assert.ok(r.kind === "created");
    others.push(r.leadId);
  }
  const notes = m.leads.get(a.leadId)!.notes;
  assert.equal(sharedLines(notes).length, 1, "one line per lead, however many clients share the number");
  assert.match(sharedLines(notes)[0], /and 3 more\./);
  assert.match(notes, /Staff: client prefers evening calls/, "staff notes survive");
  assert.equal(parseSmartQuoteLeadNotes(notes)?.quoteNumber, "SES-20261009-8501");
  // Replays and further revisions by the first client do not duplicate or lose the line.
  const again = await saveSmartQuoteSubmission(quote("SES-20261009-8509", 905000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(again.kind === "created" && again.leadId === a.leadId);
  const final = m.leads.get(a.leadId)!.notes;
  assert.equal(sharedLines(final).length, 1);
  assert.match(final, /Staff: client prefers evening calls/);
  assert.equal(parseSmartQuoteLeadNotes(final)?.quoteNumber, "SES-20261009-8509");
  assert.equal(others.length, 6);
});

test("a sibling lead created concurrently for the same number is still flagged for staff", async () => {
  const m = memoryStore();
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-8701", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  assert.ok(a.kind === "created");
  // Client B's first lookup runs before A exists in B's view (a race); the post-create lookup sees both.
  const original = m.store.findActiveLeadsByPhone!;
  let lookups = 0;
  m.store.findActiveLeadsByPhone = async (phone) => (lookups++ === 0 ? [] : original(phone));
  const b = await saveSmartQuoteSubmission(quote("SES-20261009-8702", 1200000, { name: "Sana Malik", phone: SHARED }), m);
  assert.ok(b.kind === "created" && b.leadCreated);
  assert.equal(sharedLines(m.leads.get(a.leadId)!.notes).length, 1);
  assert.equal(sharedLines(m.leads.get(b.leadId)!.notes).length, 1);
});

test("a store without the batch lookup still never merges different clients", async () => {
  const m = memoryStore();
  delete (m.store as { findActiveLeadsByPhone?: unknown }).findActiveLeadsByPhone;
  m.store.findActiveLeadByPhone = async (phone) => {
    const lead = [...m.leads.values()].find((l) => l.phone === phone);
    return lead ? { id: lead.id, customerId: lead.customerId, notes: lead.notes, name: lead.name, phone: lead.phone, city: null } : null;
  };
  const a = await saveSmartQuoteSubmission(quote("SES-20261009-8801", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  const b = await saveSmartQuoteSubmission(quote("SES-20261009-8802", 1200000, { name: "Sana Malik", phone: SHARED }), m);
  assert.ok(a.kind === "created" && b.kind === "created");
  assert.notEqual(a.leadId, b.leadId);
});

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

test("a lead insert failure with no concurrent winner is still an error", async () => {
  const m = memoryStore();
  await assert.rejects(saveSmartQuoteSubmission(quote("SES-20261009-8902", 900000, { name: "Nobody Yet", phone: "0302-2223334" }), { ...m, createLead: async () => { throw new Error("db down"); } }), /db down/);
  assert.equal(m.leads.size, 0);
});

test("a failure to write the shared-phone note never fails the quotation save", async () => {
  const m = memoryStore();
  await saveSmartQuoteSubmission(quote("SES-20261009-9001", 900000, { name: "Ahmed Khan", phone: SHARED }), m);
  const original = m.store.replaceLeadNotes;
  let blocked = true;
  m.store.replaceLeadNotes = async (leadId, expected, next) => {
    if (blocked && next.includes("Shared phone number:")) throw new Error("notes write failed");
    return original(leadId, expected, next);
  };
  const warn = console.warn; console.warn = () => {};
  try {
    const b = await saveSmartQuoteSubmission(quote("SES-20261009-9002", 1200000, { name: "Sana Malik", phone: SHARED }), m);
    assert.ok(b.kind === "created" && b.leadCreated, "the quotation is saved even though the note could not be written");
    assert.equal(m.versions.length, 2);
    blocked = false;
    // A later submission on the number writes the missing note.
    const again = await saveSmartQuoteSubmission(quote("SES-20261009-9003", 1250000, { name: "sana malik", phone: SHARED }), m);
    assert.ok(again.kind === "created" && again.leadId === b.leadId);
    assert.equal(m.leads.get(b.leadId)!.notes.split("\n").filter((l) => l.startsWith("Shared phone number:")).length, 1);
  } finally { console.warn = warn; }
});
