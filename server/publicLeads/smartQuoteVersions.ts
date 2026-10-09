import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicQuoteLine } from "../../src/lib/publicQuotationBuilder.ts";
import { normalizePakistanMobile, parseSmartQuoteLeadNotes, parseSmartQuotePdfArchive, quoteSnapshot, replaceSmartQuoteBlock } from "../../src/lib/smartQuoteLead.ts";
import { toPublicLeadInput, type SmartQuoteLeadInput } from "./smartQuoteLead.ts";

export type SmartQuoteVersionPdf = { fileName: string; fileUrl: string; storagePath: string; sha256: string; sizeBytes: number; savedAt: string };

export type SmartQuoteVersion = {
  id: string;
  quoteNumber: string;
  leadId: string;
  customerId: string | null;
  versionNumber: number;
  source: string;
  clientName: string;
  clientPhone: string;
  clientCity: string | null;
  systemCapacityKw: number;
  panel: string;
  inverter: string;
  battery: string;
  structure: string;
  lines: PublicQuoteLine[] | null;
  subtotalPkr: number | null;
  discountPkr: number | null;
  totalPkr: number;
  payloadSha256: string;
  generatedAt: string;
  createdAt: string;
  pdf: SmartQuoteVersionPdf | null;
};

export type SmartQuoteLeadMatch = { id: string; customerId: string | null; notes: string; name: string; phone: string; city: string | null };
export type SmartQuoteInsertResult = "inserted" | "duplicate_quote" | "duplicate_version";

export type SmartQuoteVersionStore = {
  findByQuoteNumber(quoteNumber: string): Promise<SmartQuoteVersion | null>;
  findActiveLeadByPhone(phone: string): Promise<SmartQuoteLeadMatch | null>;
  latestVersionNumber(leadId: string): Promise<number>;
  insert(version: SmartQuoteVersion): Promise<SmartQuoteInsertResult>;
  listByLead(leadId: string): Promise<SmartQuoteVersion[]>;
  setPdf(quoteNumber: string, pdf: SmartQuoteVersionPdf): Promise<void>;
  /** Compare-and-swap on the lead notes; false when another writer changed them. */
  replaceLeadNotes(leadId: string, expected: string, next: string): Promise<boolean>;
  readLeadNotes(leadId: string): Promise<string | null>;
};

/** Thrown when the smart_quote_versions migration has not been applied yet. */
export class SmartQuoteVersionsUnavailableError extends Error {
  constructor() {
    super("Smart Quote version history is not installed.");
  }
}

export type SaveSmartQuoteResult =
  | { kind: "created" | "replay"; leadId: string; versionNumber: number; leadCreated: boolean }
  | { kind: "conflict" };

/** Content identity of a quotation; the client timestamp is excluded so a retry is a replay. */
export function smartQuoteFingerprint(input: SmartQuoteLeadInput): string {
  const { generatedAt: _generatedAt, ...content } = input;
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/** A new client's lead id derives from the first quote number, so concurrent retries converge. */
export function deterministicSmartQuoteLeadId(quoteNumber: string): string {
  const h = createHash("sha256").update(`smart-quote-lead\n${quoteNumber}`).digest("hex");
  return `lead-${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function smartQuoteVersionNotes(input: SmartQuoteLeadInput, versionNumber: number): string {
  const lines = String(toPublicLeadInput(input).notes || "").split("\n");
  const quoteIndex = lines.findIndex((line) => line.startsWith("Quote: "));
  lines.splice(quoteIndex + 1, 0, `Version: ${versionNumber}`);
  return lines.join("\n");
}

function blockVersion(notes: string): number {
  const match = String(notes).match(/^Version: (\d+)$/m);
  return match ? Number(match[1]) : parseSmartQuoteLeadNotes(notes) ? 1 : 0;
}

export async function saveSmartQuoteSubmission(
  input: SmartQuoteLeadInput,
  deps: {
    store: SmartQuoteVersionStore;
    createLead(input: SmartQuoteLeadInput, leadId: string): Promise<{ leadId: string; customerId: string | null }>;
    now?: () => Date;
  },
): Promise<SaveSmartQuoteResult> {
  const { store } = deps;
  const fingerprint = smartQuoteFingerprint(input);
  const replayOrConflict = (existing: SmartQuoteVersion): SaveSmartQuoteResult =>
    existing.payloadSha256 === fingerprint
      ? { kind: "replay", leadId: existing.leadId, versionNumber: existing.versionNumber, leadCreated: false }
      : { kind: "conflict" };

  const existing = await store.findByQuoteNumber(input.quoteNumber);
  if (existing) return replayOrConflict(existing);

  let lead = await store.findActiveLeadByPhone(input.phone);
  let leadCreated = false;
  if (!lead) {
    const created = await deps.createLead(input, deterministicSmartQuoteLeadId(input.quoteNumber));
    lead = { id: created.leadId, customerId: created.customerId, notes: "", name: input.name, phone: input.phone, city: input.city ?? null };
    leadCreated = true;
  } else {
    await preserveLegacyQuotation(store, lead, input.quoteNumber);
  }

  const createdAt = (deps.now?.() ?? new Date()).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const versionNumber = (await store.latestVersionNumber(lead.id)) + 1;
    const result = await store.insert({
      id: `sqv-${createHash("sha256").update(input.quoteNumber).digest("hex").slice(0, 32)}`,
      quoteNumber: input.quoteNumber,
      leadId: lead.id,
      customerId: lead.customerId,
      versionNumber,
      source: "Smart Quote",
      clientName: input.name,
      clientPhone: input.phone,
      clientCity: input.city ?? null,
      systemCapacityKw: input.systemCapacityKw,
      panel: input.panel,
      inverter: input.inverter,
      battery: input.battery,
      structure: input.structure,
      lines: input.snapshot?.lines ?? null,
      subtotalPkr: input.snapshot?.subtotalPkr ?? null,
      discountPkr: input.snapshot?.discountPkr ?? null,
      totalPkr: input.estimatedTotalPkr,
      payloadSha256: fingerprint,
      generatedAt: input.generatedAt,
      createdAt,
      pdf: null,
    });
    if (result === "duplicate_quote") {
      const winner = await store.findByQuoteNumber(input.quoteNumber);
      return winner ? replayOrConflict(winner) : { kind: "conflict" };
    }
    if (result === "duplicate_version") continue;
    await promoteLatestBlock(store, lead.id, smartQuoteVersionNotes(input, versionNumber), versionNumber);
    return { kind: "created", leadId: lead.id, versionNumber, leadCreated };
  }
  throw new Error("Could not allocate a quotation version. Please retry.");
}

/** A pre-history quotation kept only in lead notes becomes version 1 before a newer quote replaces the summary. */
async function preserveLegacyQuotation(store: SmartQuoteVersionStore, lead: SmartQuoteLeadMatch, incomingQuoteNumber: string) {
  const summary = parseSmartQuoteLeadNotes(lead.notes);
  // The incoming quote may already be the lead's block when an earlier attempt created the lead but failed later.
  if (!summary || summary.quoteNumber === incomingQuoteNumber || !/^SES-\d{8}-\d{4}$/.test(summary.quoteNumber) || (await store.latestVersionNumber(lead.id)) > 0) return;
  if (await store.findByQuoteNumber(summary.quoteNumber)) return;
  const snapshot = quoteSnapshot(lead.notes);
  const archive = parseSmartQuotePdfArchive(lead.notes);
  const generatedAt = Number.isFinite(Date.parse(summary.generatedAt)) ? new Date(summary.generatedAt).toISOString() : new Date().toISOString();
  const result = await store.insert({
    id: `sqv-${createHash("sha256").update(summary.quoteNumber).digest("hex").slice(0, 32)}`,
    quoteNumber: summary.quoteNumber,
    leadId: lead.id,
    customerId: lead.customerId,
    versionNumber: 1,
    source: "Smart Quote (recorded before version history)",
    clientName: lead.name,
    clientPhone: normalizePakistanMobile(lead.phone) || lead.phone,
    clientCity: lead.city,
    systemCapacityKw: Number(summary.system.match(/[\d.]+/)?.[0]) || 0,
    panel: summary.panel,
    inverter: summary.inverter,
    battery: summary.battery,
    structure: summary.structure,
    lines: snapshot?.lines ?? null,
    subtotalPkr: snapshot?.subtotalPkr ?? null,
    discountPkr: snapshot?.discountPkr ?? null,
    totalPkr: summary.estimatePkr,
    payloadSha256: `legacy-${createHash("sha256").update(lead.notes).digest("hex")}`,
    generatedAt,
    createdAt: generatedAt,
    pdf: null,
  });
  if (result === "inserted" && archive) {
    const encodedKey = archive.fileUrl.match(/\/api\/storage\/object\/customer-documents\/([A-Za-z0-9_-]+)/)?.[1];
    const storagePath = encodedKey ? Buffer.from(encodedKey, "base64url").toString("utf8") : "";
    await store.setPdf(summary.quoteNumber, { fileName: archive.fileName, fileUrl: archive.fileUrl, storagePath, sha256: archive.sha256, sizeBytes: archive.sizeBytes, savedAt: archive.savedAt });
  }
}

/** Keep the CRM lead's summary pointing at its newest version without touching staff notes. */
async function promoteLatestBlock(store: SmartQuoteVersionStore, leadId: string, block: string, versionNumber: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await store.readLeadNotes(leadId);
    if (current === null) return;
    const currentQuote = parseSmartQuoteLeadNotes(current)?.quoteNumber;
    if (currentQuote && blockVersion(current) > versionNumber) return;
    if (currentQuote && currentQuote === parseSmartQuoteLeadNotes(block)?.quoteNumber && /^Version: /m.test(current)) return;
    if (await store.replaceLeadNotes(leadId, current, replaceSmartQuoteBlock(current, block))) return;
  }
  throw new Error("Lead changed repeatedly while saving the quotation summary. Please retry.");
}

type VersionRow = Record<string, any>;

function fromRow(row: VersionRow): SmartQuoteVersion {
  return {
    id: row.id,
    quoteNumber: row.quote_number,
    leadId: row.lead_id,
    customerId: row.customer_id ?? null,
    versionNumber: Number(row.version_number),
    source: row.source,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    clientCity: row.client_city ?? null,
    systemCapacityKw: Number(row.system_capacity_kw),
    panel: row.panel,
    inverter: row.inverter,
    battery: row.battery,
    structure: row.structure,
    lines: Array.isArray(row.lines) ? row.lines : null,
    subtotalPkr: row.subtotal_pkr === null || row.subtotal_pkr === undefined ? null : Number(row.subtotal_pkr),
    discountPkr: row.discount_pkr === null || row.discount_pkr === undefined ? null : Number(row.discount_pkr),
    totalPkr: Number(row.total_pkr),
    payloadSha256: row.payload_sha256,
    generatedAt: row.generated_at,
    createdAt: row.created_at,
    pdf: row.pdf_file_url
      ? { fileName: row.pdf_file_name, fileUrl: row.pdf_file_url, storagePath: row.pdf_storage_path, sha256: row.pdf_sha256, sizeBytes: Number(row.pdf_size_bytes), savedAt: row.pdf_saved_at }
      : null,
  };
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  const message = String(error?.message || "");
  return error?.code === "PGRST205" || error?.code === "42P01" || (message.includes("smart_quote_versions") && message.includes("schema cache"));
}

function check<T>(result: { data: T; error: any }): T {
  if (isMissingTable(result.error)) throw new SmartQuoteVersionsUnavailableError();
  if (result.error) throw new Error(result.error.message || "Smart Quote version storage failed.");
  return result.data;
}

export function createPostgrestSmartQuoteVersionStore(client: SupabaseClient): SmartQuoteVersionStore {
  const table = () => client.from("smart_quote_versions");
  return {
    async findByQuoteNumber(quoteNumber) {
      const row = check(await table().select("*").eq("quote_number", quoteNumber).maybeSingle());
      return row ? fromRow(row) : null;
    },
    async findActiveLeadByPhone(phone) {
      const canonical = normalizePakistanMobile(phone);
      if (!canonical) return null;
      const rows = check(
        await client
          .from("leads")
          .select("id,name,phone,location,customer_id,notes,created_at")
          .is("deleted_at", null)
          .ilike("phone", `%${canonical.slice(-4)}%`)
          .order("created_at", { ascending: false })
          .limit(200),
      ) as VersionRow[];
      const match = (rows || []).find((row) => normalizePakistanMobile(String(row.phone || "")) === canonical);
      return match
        ? { id: match.id, customerId: match.customer_id ?? null, notes: String(match.notes || ""), name: String(match.name || ""), phone: String(match.phone || ""), city: match.location || null }
        : null;
    },
    async latestVersionNumber(leadId) {
      const row = check(await table().select("version_number").eq("lead_id", leadId).order("version_number", { ascending: false }).limit(1).maybeSingle()) as VersionRow | null;
      return row ? Number(row.version_number) : 0;
    },
    async insert(version) {
      const { error } = await table().insert({
        id: version.id,
        quote_number: version.quoteNumber,
        lead_id: version.leadId,
        customer_id: version.customerId,
        version_number: version.versionNumber,
        source: version.source,
        client_name: version.clientName,
        client_phone: version.clientPhone,
        client_city: version.clientCity,
        system_capacity_kw: version.systemCapacityKw,
        panel: version.panel,
        inverter: version.inverter,
        battery: version.battery,
        structure: version.structure,
        lines: version.lines,
        subtotal_pkr: version.subtotalPkr,
        discount_pkr: version.discountPkr,
        total_pkr: version.totalPkr,
        payload_sha256: version.payloadSha256,
        generated_at: version.generatedAt,
        created_at: version.createdAt,
      });
      if (!error) return "inserted";
      if (isMissingTable(error)) throw new SmartQuoteVersionsUnavailableError();
      const detail = `${error.message || ""} ${error.details || ""}`;
      if (error.code === "23505" && /lead_id, version_number|version_number/.test(detail)) return "duplicate_version";
      if (error.code === "23505") return "duplicate_quote";
      throw new Error(error.message || "Could not save the quotation version.");
    },
    async listByLead(leadId) {
      const rows = check(await table().select("*").eq("lead_id", leadId).order("version_number", { ascending: false })) as VersionRow[];
      return (rows || []).map(fromRow);
    },
    async setPdf(quoteNumber, pdf) {
      check(
        await table()
          .update({ pdf_file_name: pdf.fileName, pdf_file_url: pdf.fileUrl, pdf_storage_path: pdf.storagePath, pdf_sha256: pdf.sha256, pdf_size_bytes: pdf.sizeBytes, pdf_saved_at: pdf.savedAt })
          .eq("quote_number", quoteNumber)
          .select("id"),
      );
    },
    async replaceLeadNotes(leadId, expected, next) {
      const data = check(await client.from("leads").update({ notes: next }).eq("id", leadId).eq("notes", expected).is("deleted_at", null).select("id")) as VersionRow[];
      return Boolean(data?.length);
    },
    async readLeadNotes(leadId) {
      const row = check(await client.from("leads").select("notes,deleted_at").eq("id", leadId).maybeSingle()) as VersionRow | null;
      return row && !row.deleted_at ? String(row.notes || "") : null;
    },
  };
}
