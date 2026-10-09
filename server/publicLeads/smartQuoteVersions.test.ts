import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSmartQuoteLeadPayload, toPublicLeadInput, type SmartQuoteLeadInput } from "./smartQuoteLead.ts";
import {
  deterministicSmartQuoteLeadId,
  saveSmartQuoteSubmission,
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
      const lead = [...leads.values()].find((l) => l.phone === phone);
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
  m.leads.set("lead-legacy", { id: "lead-legacy", phone: legacy.phone, customerId: "cust-legacy", notes: legacyNotes, name: "Legacy Client" });
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
