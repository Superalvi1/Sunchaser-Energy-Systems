/**
 * Production dependency wiring for WhatsApp Shared Inbox (RC-1.2.1).
 * Composes CRM/user ports — no inbox service business-rule changes beyond port contract.
 *
 * Duplicate phone lookup limitation:
 * Schema has no normalized_phone column. Lookup uses exact match against a bounded
 * set of canonical Pakistan mobile forms (92… / 03… / +92… / 0092…). Leads stored
 * with atypical formatting may not be detected as duplicates.
 */
import { randomUUID } from "node:crypto";
import {
  getSupabase,
  isSupabaseActive,
  type Database,
} from "../../dbManager.ts";
import { isActiveLead } from "../../src/lib/leadSoftDelete.ts";
import {
  normalizePakistanPhone,
  pakistanMobileLookupForms,
  phonesMatch,
} from "../../src/lib/phoneNormalize.ts";
import type { PersistedPublicLead } from "../publicLeads/publicLeadService.ts";
import { mapUserRow } from "../../userAuthDb.ts";
import { DEFAULT_COMPANY_ID } from "./whatsappConstants.ts";
import { InboxServiceError } from "./whatsappInboxServiceErrors.ts";
import type { CreateWhatsAppInboxServicesOptions } from "./whatsappInboxServices.ts";
import type {
  InboxAssigneeCandidate,
  InboxAssigneeDirectory,
  InboxCreateLeadCallback,
  InboxCrmDuplicateLookup,
  InboxCrmDuplicateSuggestion,
} from "./whatsappInboxServicePorts.ts";
import {
  createDefaultWhatsAppRepository,
  type WhatsAppRepository,
} from "./whatsappRepository.ts";

export type ProductionInboxWiringDeps = {
  resolveLocalDb: () => Database;
  persistLead: (lead: PersistedPublicLead) => Promise<{ leadId: string }>;
  /** Optional override for tests; production uses createDefaultWhatsAppRepository(). */
  whatsappRepo?: WhatsAppRepository;
  /** Override default company for users without an explicit company_id (tests). */
  defaultUserCompanyId?: string;
};

function resolveUserCompanyId(
  row: Record<string, unknown>,
  fallbackCompanyId: string
): string {
  const raw = row.company_id ?? row.companyId;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return fallbackCompanyId;
}

function infrastructureError(message: string): InboxServiceError {
  return new InboxServiceError("service_unavailable", message);
}

async function lookupAssigneeCandidate(
  userId: string,
  _companyId: string,
  resolveLocalDb: () => Database,
  defaultUserCompanyId: string
): Promise<InboxAssigneeCandidate | null> {
  const id = String(userId || "").trim();
  if (!id) return null;

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("users")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw infrastructureError("Assignee lookup failed");
    }
    if (!data) return null;
    const mapped = mapUserRow(data as Record<string, unknown>);
    return {
      id: mapped.id,
      role: mapped.role,
      accountStatus: mapped.accountStatus,
      companyId: resolveUserCompanyId(
        data as Record<string, unknown>,
        defaultUserCompanyId
      ),
    };
  }

  try {
    const row = (resolveLocalDb().users || []).find(
      (u: { id?: string }) => u.id === id
    );
    if (!row) return null;
    const mapped = mapUserRow(row as Record<string, unknown>);
    return {
      id: mapped.id,
      role: mapped.role,
      accountStatus: mapped.accountStatus,
      companyId: resolveUserCompanyId(
        row as Record<string, unknown>,
        defaultUserCompanyId
      ),
    };
  } catch {
    throw infrastructureError("Assignee lookup failed");
  }
}

/**
 * Deterministic duplicate lead lookup by normalized Pakistan mobile.
 * Active leads only (deleted_at / deletedAt null).
 * Throws on database/infrastructure failure — never returns “no duplicate” on error.
 */
async function findActiveLeadIdByNormalizedPhone(
  canonicalPhone: string,
  resolveLocalDb: () => Database
): Promise<string | null> {
  const forms = pakistanMobileLookupForms(canonicalPhone);
  if (forms.length === 0) {
    throw new InboxServiceError(
      "invalid_argument",
      "Contact phone is invalid for duplicate lookup"
    );
  }

  if (isSupabaseActive()) {
    const { data, error } = await getSupabase()!
      .from("leads")
      .select("id, phone, deleted_at")
      .is("deleted_at", null)
      .in("phone", forms)
      .limit(10);
    if (error) {
      throw infrastructureError("Lead duplicate lookup failed");
    }
    const rows = (data || []) as Array<{
      id?: string;
      phone?: string;
      deleted_at?: string | null;
    }>;
    for (const row of rows) {
      if (!isActiveLead(row)) continue;
      if (phonesMatch(String(row.phone || ""), canonicalPhone)) {
        const leadId = String(row.id || "").trim();
        if (leadId) return leadId;
      }
    }
    return null;
  }

  try {
    const leads = resolveLocalDb().leads || [];
    for (const lead of leads as Array<{
      id?: string;
      phone?: string;
      deletedAt?: string | null;
      deleted_at?: string | null;
    }>) {
      if (!isActiveLead(lead)) continue;
      if (phonesMatch(String(lead.phone || ""), canonicalPhone)) {
        const leadId = String(lead.id || "").trim();
        if (leadId) return leadId;
      }
    }
    return null;
  } catch {
    throw infrastructureError("Lead duplicate lookup failed");
  }
}

async function requireConversationContactPhone(
  repo: WhatsAppRepository,
  conversationId: string
): Promise<{ phone: string; name: string }> {
  let bundle;
  try {
    bundle = await repo.getConversationBundle(conversationId);
  } catch {
    throw infrastructureError("Conversation contact lookup failed");
  }
  if (!bundle) {
    throw new InboxServiceError(
      "invalid_argument",
      "Conversation contact bundle is missing"
    );
  }
  const rawPhone = bundle.contact.phoneE164?.trim() || "";
  const phone = normalizePakistanPhone(rawPhone);
  if (!phone) {
    throw new InboxServiceError(
      "invalid_argument",
      "Conversation contact phone is missing or invalid"
    );
  }
  const profileName = bundle.contact.profileName?.trim() || "";
  const name = profileName || `WhatsApp ${phone}`;
  return { phone, name };
}

/**
 * Build serviceOptions for createWhatsAppInboxRouter — assignees + createLead + duplicate lookup.
 * Call once at process startup when mounting `/api/inbox`.
 */
export function buildProductionInboxServiceOptions(
  deps: ProductionInboxWiringDeps
): CreateWhatsAppInboxServicesOptions {
  const defaultUserCompanyId =
    deps.defaultUserCompanyId ?? DEFAULT_COMPANY_ID;

  let whatsappRepo: WhatsAppRepository | null = deps.whatsappRepo ?? null;
  const getWhatsAppRepo = (): WhatsAppRepository => {
    if (!whatsappRepo) {
      whatsappRepo = createDefaultWhatsAppRepository();
    }
    return whatsappRepo;
  };

  const assignees: InboxAssigneeDirectory = {
    async getById(userId, companyId) {
      return lookupAssigneeCandidate(
        userId,
        companyId,
        deps.resolveLocalDb,
        defaultUserCompanyId
      );
    },
  };

  const createLead: InboxCreateLeadCallback = async ({
    conversationId,
    actor,
  }) => {
    const { phone, name } = await requireConversationContactPhone(
      getWhatsAppRepo(),
      conversationId
    );

    const lead: PersistedPublicLead = {
      id: `lead-${randomUUID()}`,
      name,
      email: "",
      phone,
      address: "",
      location: "",
      monthlyBill: 0,
      monthlyUnits: 0,
      notes: `Created from WhatsApp Shared Inbox conversation ${conversationId} by ${actor.username}.`,
      leadSource: "WhatsApp Shared Inbox",
      status: "New",
      createdAt: new Date().toISOString(),
    };

    try {
      return await deps.persistLead(lead);
    } catch (err) {
      if (err instanceof InboxServiceError) throw err;
      throw infrastructureError("Lead persistence failed");
    }
  };

  const findDuplicate: InboxCrmDuplicateLookup = async ({
    conversationId,
  }): Promise<InboxCrmDuplicateSuggestion | null> => {
    const { phone } = await requireConversationContactPhone(
      getWhatsAppRepo(),
      conversationId
    );
    const leadId = await findActiveLeadIdByNormalizedPhone(
      phone,
      deps.resolveLocalDb
    );
    if (!leadId) return null;
    return { linkedEntityType: "lead", linkedEntityId: leadId };
  };

  return { assignees, createLead, findDuplicate };
}
