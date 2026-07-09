import type { Database } from "../../dbManager";
import { getSupabase, isSupabaseActive } from "../../dbManager";
import { filterActiveLeads } from "../../src/lib/leadSoftDelete.ts";
import { isTechnicalStaffRole } from "../../src/lib/technicalStaff.ts";
import type { RequestActor } from "../middleware/actor.ts";

export type TechnicianOwnedResourceType =
  | "technical_job"
  | "survey"
  | "installation_job"
  | "service_request"
  | "support_ticket"
  | "delivery_record";

export class TechnicianOwnershipError extends Error {
  statusCode: 401 | 403;

  constructor(message: string, statusCode: 401 | 403 = 403) {
    super(message);
    this.name = "TechnicianOwnershipError";
    this.statusCode = statusCode;
  }
}

function normalizeAssigneeToken(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function readField(row: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!row) return "";
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

/** Durable assignee user id — never match on name alone when this is set. */
export function readAssignedUserId(row: Record<string, unknown> | null | undefined): string {
  return readField(
    row,
    "assigned_user_id",
    "assignedUserId",
    "assigned_technician_user_id",
    "assignedTechnicianUserId"
  );
}

/** Legacy text assignee — temporary fallback only when user id is absent. */
export function readAssignedTechnicianName(row: Record<string, unknown> | null | undefined): string {
  return readField(row, "assigned_technician", "assignedTechnician");
}

/**
 * Temporary legacy fallback when assigned_user_id is absent.
 * Exact match only: normalized display name or username.
 */
export function legacyAssigneeNameMatches(actor: RequestActor, assigneeName: string): boolean {
  const assignee = normalizeAssigneeToken(assigneeName);
  if (!assignee) return false;
  const displayName = normalizeAssigneeToken(actor.name);
  const username = normalizeAssigneeToken(actor.username);
  return assignee === displayName || assignee === username;
}

export function assertAssigneeOwnedByActor(
  actor: RequestActor,
  row: Record<string, unknown> | null | undefined
): void {
  const assigneeUserId = readAssignedUserId(row);
  if (assigneeUserId) {
    if (assigneeUserId !== actor.id) {
      throw new TechnicianOwnershipError("You cannot access another technician's assignment.");
    }
    return;
  }
  const assigneeName = readAssignedTechnicianName(row);
  if (!assigneeName || !legacyAssigneeNameMatches(actor, assigneeName)) {
    throw new TechnicianOwnershipError("You cannot access another technician's assignment.");
  }
}

export function isRowAssignedToActor(
  actor: RequestActor,
  row: Record<string, unknown> | null | undefined
): boolean {
  try {
    assertAssigneeOwnedByActor(actor, row);
    return true;
  } catch {
    return false;
  }
}

export function parseTechnicalJobId(jobId: string):
  | { kind: "survey"; leadId: string }
  | { kind: "installation"; leadId: string }
  | { kind: "service_request"; id: string }
  | { kind: "support_ticket"; id: string }
  | null {
  const id = String(jobId || "").trim();
  if (id.startsWith("lead-surv-")) return { kind: "survey", leadId: id.slice("lead-surv-".length) };
  if (id.startsWith("lead-inst-")) return { kind: "installation", leadId: id.slice("lead-inst-".length) };
  if (id.startsWith("svc-")) return { kind: "service_request", id: id.slice(4) };
  if (id.startsWith("sup-")) return { kind: "support_ticket", id: id.slice(4) };
  return null;
}

async function loadLeadRow(leadId: string, localDb?: Database): Promise<Record<string, unknown> | null> {
  const id = String(leadId || "").trim();
  if (!id) return null;
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("leads").select("*").eq("id", id).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const lead = filterActiveLeads(localDb?.leads || []).find((l: any) => l.id === id);
  return (lead as Record<string, unknown>) || null;
}

function assertSurveyLeadOwnedByActor(actor: RequestActor, lead: Record<string, unknown>): void {
  if (actor.role !== "Survey Engineer") {
    throw new TechnicianOwnershipError("Survey not assigned to you.");
  }
  const surveyDone = !!(
    (lead.survey as Record<string, unknown> | undefined)?.completed ||
    lead.survey_completed
  );
  const status = String(lead.status || "");
  if (surveyDone) {
    throw new TechnicianOwnershipError("Survey not assigned to you.");
  }
  if (status === "New" || status === "Lost") {
    throw new TechnicianOwnershipError("Survey not assigned to you.");
  }
}

function assertInstallationLeadOwnedByActor(actor: RequestActor, lead: Record<string, unknown>): void {
  if (actor.role !== "Installation Team") {
    throw new TechnicianOwnershipError("Installation job not assigned to you.");
  }
  const status = String(lead.status || "");
  if (!["Contracted", "Installation", "In Progress"].includes(status)) {
    throw new TechnicianOwnershipError("Installation job not assigned to you.");
  }
  const inst = (lead.installation as Record<string, unknown> | undefined) || {};
  const progress = Number(inst.progress ?? inst.installationProgress ?? lead.installationProgress ?? 0);
  if (progress >= 100) {
    throw new TechnicianOwnershipError("Installation job not assigned to you.");
  }
}

async function loadServiceRequestRow(
  requestId: string,
  localDb?: Database
): Promise<Record<string, unknown> | null> {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("service_requests").select("*").eq("id", requestId).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = (localDb?.serviceRequests || []).find((r: any) => r.id === requestId);
  return (row as Record<string, unknown>) || null;
}

async function loadSupportTicketRow(
  ticketId: string,
  localDb?: Database
): Promise<Record<string, unknown> | null> {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("support_tickets").select("*").eq("id", ticketId).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = (localDb?.tickets || []).find((t: any) => t.id === ticketId);
  return (row as Record<string, unknown>) || null;
}

async function loadDeliveryRow(
  deliveryId: string,
  localDb?: Database
): Promise<Record<string, unknown> | null> {
  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data } = await supabase.from("project_deliveries").select("*").eq("id", deliveryId).maybeSingle();
    return (data as Record<string, unknown>) || null;
  }
  const row = (localDb?.projectDeliveries || []).find((d: any) => d.id === deliveryId);
  return (row as Record<string, unknown>) || null;
}

export const TechnicianOwnershipResolver = {
  assertTechnicianActor(actor: RequestActor | undefined): string {
    if (!actor) {
      throw new TechnicianOwnershipError("Unauthorized", 401);
    }
    if (!isTechnicalStaffRole(actor.role)) {
      throw new TechnicianOwnershipError("Not authorized for technical staff portal.");
    }
    return actor.id;
  },

  async assertTechnicalJobOwnedByActor(
    actor: RequestActor | undefined,
    jobId: string,
    localDb?: Database
  ): Promise<void> {
    this.assertTechnicianActor(actor);
    const parsed = parseTechnicalJobId(jobId);
    if (!parsed) {
      throw new TechnicianOwnershipError("Job not found or not assigned to you.");
    }
    switch (parsed.kind) {
      case "survey":
        await this.assertResourceOwnedByActor(actor, "survey", parsed.leadId, localDb);
        return;
      case "installation":
        await this.assertResourceOwnedByActor(actor, "installation_job", parsed.leadId, localDb);
        return;
      case "service_request":
        await this.assertResourceOwnedByActor(actor, "service_request", parsed.id, localDb);
        return;
      case "support_ticket":
        await this.assertResourceOwnedByActor(actor, "support_ticket", parsed.id, localDb);
        return;
      default:
        throw new TechnicianOwnershipError("Job not found or not assigned to you.");
    }
  },

  async assertResourceOwnedByActor(
    actor: RequestActor | undefined,
    resourceType: TechnicianOwnedResourceType,
    resourceId: string,
    localDb?: Database
  ): Promise<void> {
    this.assertTechnicianActor(actor);
    const id = String(resourceId || "").trim();
    if (!id) {
      throw new TechnicianOwnershipError("Resource not found or not assigned to you.");
    }

    switch (resourceType) {
      case "technical_job":
        await this.assertTechnicalJobOwnedByActor(actor, id, localDb);
        return;
      case "survey": {
        const lead = await loadLeadRow(id, localDb);
        if (!lead) throw new TechnicianOwnershipError("Survey not assigned to you.");
        assertSurveyLeadOwnedByActor(actor!, lead);
        return;
      }
      case "installation_job": {
        const lead = await loadLeadRow(id, localDb);
        if (!lead) throw new TechnicianOwnershipError("Installation job not assigned to you.");
        assertInstallationLeadOwnedByActor(actor!, lead);
        return;
      }
      case "service_request": {
        const row = await loadServiceRequestRow(id, localDb);
        if (!row) throw new TechnicianOwnershipError("Service request not assigned to you.");
        assertAssigneeOwnedByActor(actor!, row);
        return;
      }
      case "support_ticket": {
        const row = await loadSupportTicketRow(id, localDb);
        if (!row) throw new TechnicianOwnershipError("Support ticket not assigned to you.");
        assertAssigneeOwnedByActor(actor!, row);
        return;
      }
      case "delivery_record": {
        const row = await loadDeliveryRow(id, localDb);
        if (!row) throw new TechnicianOwnershipError("Delivery not assigned to you.");
        const assigneeUserId = readAssignedUserId(row);
        if (!assigneeUserId || assigneeUserId !== actor!.id) {
          throw new TechnicianOwnershipError("Delivery not assigned to you.");
        }
        return;
      }
      default:
        throw new TechnicianOwnershipError("Resource not found or not assigned to you.");
    }
  },

  async isTechnicalJobOwnedByActor(
    actor: RequestActor | undefined,
    jobId: string,
    localDb?: Database
  ): Promise<boolean> {
    try {
      await this.assertTechnicalJobOwnedByActor(actor, jobId, localDb);
      return true;
    } catch {
      return false;
    }
  },

  async filterOwnedTechnicalJobs<T extends { id: string }>(
    actor: RequestActor | undefined,
    jobs: T[],
    localDb?: Database
  ): Promise<T[]> {
    this.assertTechnicianActor(actor);
    const owned: T[] = [];
    for (const job of jobs) {
      if (await this.isTechnicalJobOwnedByActor(actor, job.id, localDb)) {
        owned.push(job);
      }
    }
    return owned;
  },
};
