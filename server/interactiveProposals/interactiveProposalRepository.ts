import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  InteractiveProposalCalculation,
  InteractiveProposalConfig,
  InteractiveProposalDefinition,
  InteractiveProposalStatus,
} from "../../src/lib/interactiveProposal.ts";

export type InteractiveProposalRecord = {
  id: string;
  tokenHash: string;
  leadId: string;
  quotationId: string;
  status: InteractiveProposalStatus;
  definition: InteractiveProposalDefinition;
  currentConfig: InteractiveProposalConfig;
  acceptedCalculation: InteractiveProposalCalculation | null;
  acceptedByName: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  viewedAt: string | null;
  modifiedAt: string | null;
  acceptedAt: string | null;
  expiresAt: string;
};

export type InteractiveProposalCreateInput = {
  leadId: string;
  quotationId: string;
  definition: InteractiveProposalDefinition;
  initialConfig: InteractiveProposalConfig;
  createdBy: string;
  expiresAt: string;
};

export type InteractiveProposalStore = {
  create(input: InteractiveProposalCreateInput): Promise<{ record: InteractiveProposalRecord; token: string }>;
  findByToken(token: string): Promise<InteractiveProposalRecord | null>;
  findById(id: string): Promise<InteractiveProposalRecord | null>;
  listForQuote(leadId: string, quotationId: string): Promise<InteractiveProposalRecord[]>;
  markViewed(record: InteractiveProposalRecord): Promise<InteractiveProposalRecord>;
  savePreview(
    record: InteractiveProposalRecord,
    config: InteractiveProposalConfig,
    calculation: InteractiveProposalCalculation
  ): Promise<InteractiveProposalRecord>;
  accept(
    record: InteractiveProposalRecord,
    calculation: InteractiveProposalCalculation,
    acceptedByName: string
  ): Promise<InteractiveProposalRecord>;
  revoke(record: InteractiveProposalRecord): Promise<InteractiveProposalRecord>;
};

export class InteractiveProposalSchemaError extends Error {
  constructor(message = "Interactive proposal database migration has not been applied.") {
    super(message);
    this.name = "InteractiveProposalSchemaError";
  }
}

export class InteractiveProposalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InteractiveProposalConflictError";
  }
}

export function hashInteractiveProposalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createPublicToken(): string {
  return randomBytes(32).toString("base64url");
}

function isExpired(record: InteractiveProposalRecord): boolean {
  return new Date(record.expiresAt).getTime() <= Date.now();
}

function effectiveRecord(record: InteractiveProposalRecord): InteractiveProposalRecord {
  if (
    isExpired(record) &&
    record.status !== "Accepted" &&
    record.status !== "Revoked"
  ) {
    return { ...record, status: "Expired" };
  }
  return record;
}

function mapRow(row: any): InteractiveProposalRecord {
  return effectiveRecord({
    id: String(row.id),
    tokenHash: String(row.token_hash),
    leadId: String(row.lead_id),
    quotationId: String(row.quotation_id),
    status: row.status as InteractiveProposalStatus,
    definition: row.definition,
    currentConfig: row.current_config,
    acceptedCalculation: row.accepted_calculation || null,
    acceptedByName: row.accepted_by_name || null,
    createdBy: String(row.created_by || ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    viewedAt: row.viewed_at ? String(row.viewed_at) : null,
    modifiedAt: row.modified_at ? String(row.modified_at) : null,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
    expiresAt: String(row.expires_at),
  });
}

function isMissingTableError(error: any): boolean {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || message.includes("interactive_proposals");
}

async function appendEvent(
  supabase: any,
  proposalId: string,
  eventType: string,
  configuration?: InteractiveProposalConfig,
  calculation?: InteractiveProposalCalculation
) {
  const { error } = await supabase.from("interactive_proposal_events").insert({
    proposal_id: proposalId,
    event_type: eventType,
    configuration: configuration || null,
    calculation: calculation || null,
  });
  if (error && !isMissingTableError(error)) {
    console.warn("[InteractiveProposal] Event insert failed:", error.message);
  }
}

export function createSupabaseInteractiveProposalStore(
  supabase: any
): InteractiveProposalStore {
  return {
    async create(input) {
      const token = createPublicToken();
      const now = new Date().toISOString();
      const row = {
        id: randomUUID(),
        token_hash: hashInteractiveProposalToken(token),
        lead_id: input.leadId,
        quotation_id: input.quotationId,
        status: "Sent",
        definition: input.definition,
        current_config: input.initialConfig,
        accepted_calculation: null,
        accepted_by_name: null,
        created_by: input.createdBy,
        created_at: now,
        updated_at: now,
        expires_at: input.expiresAt,
      };
      const { data, error } = await supabase
        .from("interactive_proposals")
        .insert(row)
        .select("*")
        .single();
      if (error) {
        if (isMissingTableError(error)) throw new InteractiveProposalSchemaError();
        throw new Error(error.message);
      }
      await appendEvent(supabase, data.id, "created", input.initialConfig);
      return { record: mapRow(data), token };
    },

    async findByToken(token) {
      const { data, error } = await supabase
        .from("interactive_proposals")
        .select("*")
        .eq("token_hash", hashInteractiveProposalToken(token))
        .maybeSingle();
      if (error) {
        if (isMissingTableError(error)) throw new InteractiveProposalSchemaError();
        throw new Error(error.message);
      }
      return data ? mapRow(data) : null;
    },

    async findById(id) {
      const { data, error } = await supabase
        .from("interactive_proposals")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        if (isMissingTableError(error)) throw new InteractiveProposalSchemaError();
        throw new Error(error.message);
      }
      return data ? mapRow(data) : null;
    },

    async listForQuote(leadId, quotationId) {
      const { data, error } = await supabase
        .from("interactive_proposals")
        .select("*")
        .eq("lead_id", leadId)
        .eq("quotation_id", quotationId)
        .order("created_at", { ascending: false });
      if (error) {
        if (isMissingTableError(error)) throw new InteractiveProposalSchemaError();
        throw new Error(error.message);
      }
      return (data || []).map(mapRow);
    },

    async markViewed(record) {
      if (record.status !== "Sent") return effectiveRecord(record);
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("interactive_proposals")
        .update({ status: "Viewed", viewed_at: now, updated_at: now })
        .eq("id", record.id)
        .eq("status", "Sent")
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) await appendEvent(supabase, record.id, "viewed", record.currentConfig);
      return data ? mapRow(data) : record;
    },

    async savePreview(record, config, calculation) {
      if (["Accepted", "Revoked", "Expired"].includes(record.status)) {
        throw new InteractiveProposalConflictError(
          `This proposal is already ${record.status.toLowerCase()}.`
        );
      }
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("interactive_proposals")
        .update({
          status: "Modified",
          current_config: config,
          modified_at: now,
          updated_at: now,
        })
        .eq("id", record.id)
        .in("status", ["Sent", "Viewed", "Modified"])
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new InteractiveProposalConflictError("Proposal state changed. Please refresh.");
      await appendEvent(supabase, record.id, "modified", config, calculation);
      return mapRow(data);
    },

    async accept(record, calculation, acceptedByName) {
      if (record.status === "Accepted") {
        throw new InteractiveProposalConflictError("This proposal has already been accepted.");
      }
      if (["Revoked", "Expired"].includes(record.status)) {
        throw new InteractiveProposalConflictError(
          `This proposal is ${record.status.toLowerCase()} and cannot be accepted.`
        );
      }
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("interactive_proposals")
        .update({
          status: "Accepted",
          current_config: calculation.configuration,
          accepted_calculation: calculation,
          accepted_by_name: acceptedByName,
          accepted_at: now,
          updated_at: now,
        })
        .eq("id", record.id)
        .in("status", ["Sent", "Viewed", "Modified"])
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new InteractiveProposalConflictError("Proposal state changed. Please refresh.");
      await appendEvent(
        supabase,
        record.id,
        "accepted",
        calculation.configuration,
        calculation
      );
      return mapRow(data);
    },

    async revoke(record) {
      if (record.status === "Accepted") {
        throw new InteractiveProposalConflictError("An accepted proposal cannot be revoked.");
      }
      if (record.status === "Revoked") return effectiveRecord(record);
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("interactive_proposals")
        .update({ status: "Revoked", updated_at: now })
        .eq("id", record.id)
        .neq("status", "Accepted")
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new InteractiveProposalConflictError("Proposal state changed. Please refresh.");
      await appendEvent(supabase, record.id, "revoked", record.currentConfig);
      return mapRow(data);
    },
  };
}

export function createMemoryInteractiveProposalStore(
  records: InteractiveProposalRecord[]
): InteractiveProposalStore {
  return {
    async create(input) {
      const token = createPublicToken();
      const now = new Date().toISOString();
      const record: InteractiveProposalRecord = {
        id: randomUUID(),
        tokenHash: hashInteractiveProposalToken(token),
        leadId: input.leadId,
        quotationId: input.quotationId,
        status: "Sent",
        definition: input.definition,
        currentConfig: input.initialConfig,
        acceptedCalculation: null,
        acceptedByName: null,
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
        viewedAt: null,
        modifiedAt: null,
        acceptedAt: null,
        expiresAt: input.expiresAt,
      };
      records.push(record);
      return { record, token };
    },

    async findByToken(token) {
      const record = records.find((item) => item.tokenHash === hashInteractiveProposalToken(token));
      return record ? effectiveRecord(record) : null;
    },

    async findById(id) {
      const record = records.find((item) => item.id === id);
      return record ? effectiveRecord(record) : null;
    },

    async listForQuote(leadId, quotationId) {
      return records
        .filter((item) => item.leadId === leadId && item.quotationId === quotationId)
        .map(effectiveRecord)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async markViewed(record) {
      if (record.status !== "Sent") return effectiveRecord(record);
      record.status = "Viewed";
      record.viewedAt = new Date().toISOString();
      record.updatedAt = record.viewedAt;
      return record;
    },

    async savePreview(record, config) {
      const effective = effectiveRecord(record);
      if (["Accepted", "Revoked", "Expired"].includes(effective.status)) {
        throw new InteractiveProposalConflictError(
          `This proposal is already ${effective.status.toLowerCase()}.`
        );
      }
      const now = new Date().toISOString();
      record.status = "Modified";
      record.currentConfig = config;
      record.modifiedAt = now;
      record.updatedAt = now;
      return record;
    },

    async accept(record, calculation, acceptedByName) {
      const effective = effectiveRecord(record);
      if (["Accepted", "Revoked", "Expired"].includes(effective.status)) {
        throw new InteractiveProposalConflictError(
          `This proposal is ${effective.status.toLowerCase()} and cannot be accepted.`
        );
      }
      const now = new Date().toISOString();
      record.status = "Accepted";
      record.currentConfig = calculation.configuration;
      record.acceptedCalculation = calculation;
      record.acceptedByName = acceptedByName;
      record.acceptedAt = now;
      record.updatedAt = now;
      return record;
    },

    async revoke(record) {
      const effective = effectiveRecord(record);
      if (effective.status === "Accepted") {
        throw new InteractiveProposalConflictError("An accepted proposal cannot be revoked.");
      }
      if (effective.status === "Revoked") return effective;
      record.status = "Revoked";
      record.updatedAt = new Date().toISOString();
      return record;
    },
  };
}
