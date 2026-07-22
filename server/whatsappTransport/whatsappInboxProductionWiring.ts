/**
 * Production dependency wiring for WhatsApp Shared Inbox (RC-1.2.1).
 * Composes CRM/user ports — no inbox service business-rule changes beyond port contract.
 *
 * Duplicate phone lookup limitation:
 * Schema has no normalized_phone column. Lookup uses exact match against a bounded
 * set of canonical Pakistan mobile forms (92… / +92… / 0092… / 03… / 3…). Leads stored
 * with atypical formatting may not be detected as duplicates.
 *
 * Lead company isolation limitation:
 * Persistent `leads` rows have no company_id column today. Inbox CRM create/duplicate
 * paths therefore fail closed unless companyId === DEFAULT_COMPANY_ID. Multi-company
 * lead isolation requires a schema change in a later phase.
 *
 * Assignee company isolation limitation (single-tenant):
 * Persistent `users` rows have no company_id column (see supabase-schema.sql).
 * Assignee lookup is therefore id-only and fail-closed unless
 * companyId === DEFAULT_COMPANY_ID. Do not query users.company_id.
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
import {
  createDefaultWhatsAppInboxRepositories,
  type WhatsAppInboxRepositories,
} from "./whatsappInboxRepository.ts";
import {
  createWhatsAppInboxServices,
  type CreateWhatsAppInboxServicesOptions,
  type WhatsAppInboxServices,
} from "./whatsappInboxServices.ts";
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
};

function infrastructureError(message: string): InboxServiceError {
  return new InboxServiceError("service_unavailable", message);
}

/**
 * Leads table has no company_id — contain CRM lead ops to DEFAULT_COMPANY_ID only.
 * Fail closed for any other company rather than silently querying across tenants.
 */
function requireDefaultCompanyLeadScope(companyId: string): void {
  const id = String(companyId || "").trim();
  if (id !== DEFAULT_COMPANY_ID) {
    throw new InboxServiceError(
      "forbidden",
      "CRM lead operations are limited to the default company scope"
    );
  }
}

/**
 * Resolve assignee by user id within the supported single-tenant company scope.
 * `users` has no company_id — never filter on that column.
 */
async function lookupAssigneeCandidate(
  userId: string,
  companyId: string,
  resolveLocalDb: () => Database
): Promise<InboxAssigneeCandidate | null> {
  const id = String(userId || "").trim();
  const scopedCompanyId = String(companyId || "").trim();
  if (!id || !scopedCompanyId) return null;

  // Fail closed outside the single supported company (users are not multi-tenant).
  if (scopedCompanyId !== DEFAULT_COMPANY_ID) {
    return null;
  }

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
      companyId: DEFAULT_COMPANY_ID,
    };
  }

  try {
    const row = (resolveLocalDb().users || []).find(
      (u: Record<string, unknown>) => String(u.id || "") === id
    );
    if (!row) return null;
    const mapped = mapUserRow(row as Record<string, unknown>);
    return {
      id: mapped.id,
      role: mapped.role,
      accountStatus: mapped.accountStatus,
      companyId: DEFAULT_COMPANY_ID,
    };
  } catch {
    throw infrastructureError("Assignee lookup failed");
  }
}

type LeadDupRow = {
  id?: string;
  phone?: string;
  deleted_at?: string | null;
  deletedAt?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
};

function leadCreatedAtMs(row: LeadDupRow): number {
  const raw = row.created_at ?? row.createdAt ?? "";
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function pickDeterministicLeadId(
  rows: LeadDupRow[],
  canonicalPhone: string
): string | null {
  const matches: LeadDupRow[] = [];
  for (const row of rows) {
    if (!isActiveLead(row)) continue;
    if (!phonesMatch(String(row.phone || ""), canonicalPhone)) continue;
    const leadId = String(row.id || "").trim();
    if (leadId) matches.push(row);
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const byCreated = leadCreatedAtMs(a) - leadCreatedAtMs(b);
    if (byCreated !== 0) return byCreated;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  return String(matches[0]!.id || "").trim() || null;
}

/**
 * Deterministic duplicate lead lookup by normalized Pakistan mobile.
 * Active leads only (deleted_at / deletedAt null).
 * Throws on database/infrastructure failure — never returns “no duplicate” on error.
 *
 * Supabase: company scope enforced via DEFAULT_COMPANY_ID containment (no leads.company_id),
 * ordered by created_at asc, id asc, limit 1 after phone candidate filter.
 * Local fallback: full in-memory list (dev/test only — not used when Supabase is active).
 */
async function findActiveLeadIdByNormalizedPhone(
  canonicalPhone: string,
  companyId: string,
  resolveLocalDb: () => Database
): Promise<string | null> {
  requireDefaultCompanyLeadScope(companyId);

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
      .select("id, phone, deleted_at, created_at")
      .is("deleted_at", null)
      .in("phone", forms)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(5);
    if (error) {
      throw infrastructureError("Lead duplicate lookup failed");
    }
    return pickDeterministicLeadId(
      (data || []) as LeadDupRow[],
      canonicalPhone
    );
  }

  try {
    // Local JSON fallback only — full list scan; production uses Supabase path above.
    const leads = (resolveLocalDb().leads || []) as LeadDupRow[];
    return pickDeterministicLeadId(leads, canonicalPhone);
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
  let whatsappRepo: WhatsAppRepository | null = deps.whatsappRepo ?? null;
  const getWhatsAppRepo = (): WhatsAppRepository => {
    if (!whatsappRepo) {
      whatsappRepo = createDefaultWhatsAppRepository();
    }
    return whatsappRepo;
  };

  const assignees: InboxAssigneeDirectory = {
    async getById(userId, companyId) {
      return lookupAssigneeCandidate(userId, companyId, deps.resolveLocalDb);
    },
  };

  const createLead: InboxCreateLeadCallback = async ({
    conversationId,
    companyId,
    actor,
  }) => {
    // Trusted company from conversation/service scope — not from request DTO.
    requireDefaultCompanyLeadScope(companyId);

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
    companyId,
  }): Promise<InboxCrmDuplicateSuggestion | null> => {
    requireDefaultCompanyLeadScope(companyId);
    const { phone } = await requireConversationContactPhone(
      getWhatsAppRepo(),
      conversationId
    );
    const leadId = await findActiveLeadIdByNormalizedPhone(
      phone,
      companyId,
      deps.resolveLocalDb
    );
    if (!leadId) return null;
    return { linkedEntityType: "lead", linkedEntityId: leadId };
  };

  return { assignees, createLead, findDuplicate };
}

export function createProductionWhatsAppServices(
  deps: ProductionInboxWiringDeps,
  inboxRepos?: WhatsAppInboxRepositories
): WhatsAppInboxServices {
  const repos = inboxRepos ?? createDefaultWhatsAppInboxRepositories();
  const serviceOptions = buildProductionInboxServiceOptions(deps);
  return createWhatsAppInboxServices(repos, serviceOptions);
}

export function buildProductionWebhookAutoLinkLead(
  deps: ProductionInboxWiringDeps,
  inboxRepos?: WhatsAppInboxRepositories
): (conversationId: string) => Promise<{ leadId: string; created: boolean }> {
  const services = createProductionWhatsAppServices(deps, inboxRepos);
  return async (conversationId: string) => {
    return services.crmLinks.autoLinkInboundLead(conversationId);
  };
}
