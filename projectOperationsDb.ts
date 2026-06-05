import {
  getSupabase,
  isSupabaseActive,
  type Database,
  verifyStaffPortalUser,
  StaffPortalAuthError,
} from "./dbManager.js";
import { listAdminProjectDeliveries } from "./projectDeliveryDb.js";
import { listAdminInvoices } from "./invoiceDb.js";
import { isExcludedFromLedgerTotals } from "./src/lib/invoices.ts";
import type { ProjectDeliveryRecord } from "./src/lib/projectDelivery.ts";
import {
  canViewProjectOperations,
  daysSince,
  delayTone,
  type KanbanColumnKey,
  type OperationsProjectCard,
  type PipelineStageKey,
  type ProjectOperationsDashboard,
  type ProjectOperationsDetail,
} from "./src/lib/projectOperations.ts";

type NmRow = {
  lead_id?: string;
  customer_id?: string;
  documents_collected?: boolean;
  application_submitted?: boolean;
  disco_inspection?: boolean;
  demand_notice?: boolean;
  meter_installation?: boolean;
  green_meter_active?: boolean;
};

function resolveKanbanColumn(d: ProjectDeliveryRecord, nm: NmRow | null): KanbanColumnKey {
  if (d.deliveryStatus === "Handover Completed" || d.completionStage === "Completed") {
    return "completed";
  }
  if (
    d.deliveryStatus === "Installation Completed" &&
    nm &&
    !nm.green_meter_active
  ) {
    return "net_metering";
  }
  if (
    d.deliveryStatus === "Installation Scheduled" ||
    d.deliveryStatus === "Installation In Progress" ||
    d.deliveryStatus === "Installation Completed"
  ) {
    return "installation";
  }
  if (d.deliveryStatus === "Material Ordered" || d.deliveryStatus === "Material Delivered") {
    return "procurement";
  }
  return "survey";
}

function resolvePipelineStage(d: ProjectDeliveryRecord, nm: NmRow | null): PipelineStageKey {
  if (d.deliveryStatus === "Handover Completed" || d.completionStage === "Completed") {
    return "completed";
  }
  if (nm?.green_meter_active) return "net_metering_approved";
  if (nm?.meter_installation || nm?.application_submitted) return "net_metering_submitted";
  if (d.completionStage === "QA Inspection" || d.completionStage === "Customer Handover") {
    return "inspection";
  }
  if (d.deliveryStatus === "Installation Completed") return "installation_completed";
  if (
    d.deliveryStatus === "Installation Scheduled" ||
    d.deliveryStatus === "Installation In Progress"
  ) {
    return "installation_scheduled";
  }
  if (d.deliveryStatus === "Material Ordered") return "material_ordered";
  if (d.deliveryStatus === "Material Delivered" || d.completionStage === "Survey") {
    return "site_survey";
  }
  if (d.deliveryStatus === "Order Confirmed") {
    return d.quotationId ? "advance_received" : "quotation_approved";
  }
  return "lead_won";
}

function teamLabelForUser(user: { role?: string; name?: string; username?: string } | null): string {
  if (!user) return "Unassigned";
  const role = String(user.role || "");
  if (role === "Survey Engineer") return "Survey Team";
  if (role === "Installation Team") return "Installation Team";
  if (role === "Technician" || role === "Service Technician") return "Installation Team";
  return user.name || user.username || role || "Assigned";
}

function isCompletedThisMonth(updatedAt: string): boolean {
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const u = String(updatedAt || "").slice(0, 10);
  return u >= start;
}

function buildProjectCard(
  d: ProjectDeliveryRecord,
  customer: { name?: string; phone?: string; address?: string } | null,
  user: { role?: string; name?: string; username?: string } | null,
  nm: NmRow | null
): OperationsProjectCard {
  const daysInStage = daysSince(d.updatedAt);
  const tone = delayTone(daysInStage);
  const completed = d.deliveryStatus === "Handover Completed";
  const overdue =
    !completed &&
    ((d.expectedInstallationDate &&
      String(d.expectedInstallationDate).slice(0, 10) <
        new Date().toISOString().slice(0, 10)) ||
      daysInStage >= 15);

  return {
    id: d.id,
    customerId: d.customerId,
    customerName: customer?.name || d.projectTitle,
    customerPhone: customer?.phone || null,
    projectTitle: d.projectTitle,
    systemSizeKw: d.systemSizeKw ?? null,
    location: d.installationAddress || customer?.address || null,
    assignedTeam: teamLabelForUser(user),
    assignedUserId: d.assignedTechnicianUserId || null,
    pipelineStage: resolvePipelineStage(d, nm),
    kanbanColumn: resolveKanbanColumn(d, nm),
    deliveryStatus: d.deliveryStatus,
    completionStage: d.completionStage || "Survey",
    daysInStage,
    delayTone: tone,
    leadId: d.leadId || null,
    quotationId: d.quotationId || null,
    updatedAt: d.updatedAt,
    createdAt: d.createdAt,
    expectedInstallationDate: d.expectedInstallationDate || null,
    isOverdue: overdue,
  };
}

async function loadCustomersMap(customerIds: string[]) {
  const map = new Map<string, { name?: string; phone?: string; address?: string; email?: string }>();
  if (!customerIds.length) return map;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!
      .from("customers")
      .select("id, name, phone, address, email")
      .in("id", customerIds);
    for (const c of data || []) {
      map.set(c.id, c);
    }
  }
  return map;
}

async function loadUsersMap(userIds: string[]) {
  const map = new Map<string, { role?: string; name?: string; username?: string }>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return map;
  if (isSupabaseActive()) {
    const { data } = await getSupabase()!.from("users").select("id, name, username, role").in("id", ids);
    for (const u of data || []) {
      map.set(u.id, u);
    }
  }
  return map;
}

async function loadNetMeteringMap(leadIds: string[], customerIds: string[]) {
  const map = new Map<string, NmRow>();
  if (!isSupabaseActive()) return map;
  const supabase = getSupabase()!;
  if (leadIds.length) {
    const { data } = await supabase.from("net_metering_trackers").select("*").in("lead_id", leadIds);
    for (const row of data || []) {
      if (row.lead_id) map.set(`lead:${row.lead_id}`, row);
    }
  }
  if (customerIds.length) {
    const { data } = await supabase.from("net_metering_trackers").select("*").in("customer_id", customerIds);
    for (const row of data || []) {
      if (row.customer_id) map.set(`cust:${row.customer_id}`, row);
    }
  }
  return map;
}

function nmForDelivery(d: ProjectDeliveryRecord, nmMap: Map<string, NmRow>): NmRow | null {
  if (d.leadId && nmMap.has(`lead:${d.leadId}`)) return nmMap.get(`lead:${d.leadId}`)!;
  if (nmMap.has(`cust:${d.customerId}`)) return nmMap.get(`cust:${d.customerId}`)!;
  return null;
}

export async function fetchProjectOperationsDashboard(
  userId: string,
  username: string,
  role: string,
  localDb?: Database
): Promise<ProjectOperationsDashboard> {
  await verifyStaffPortalUser(userId, username, localDb);
  if (!canViewProjectOperations(username, role)) {
    throw new StaffPortalAuthError("You do not have permission to view project operations.", 403);
  }

  const deliveries = await listAdminProjectDeliveries(userId, username, localDb);
  const customerIds = [...new Set(deliveries.map((d) => d.customerId))];
  const userIds = deliveries.map((d) => d.assignedTechnicianUserId).filter(Boolean) as string[];
  const leadIds = deliveries.map((d) => d.leadId).filter(Boolean) as string[];

  const [customers, users, nmMap] = await Promise.all([
    loadCustomersMap(customerIds),
    loadUsersMap(userIds),
    loadNetMeteringMap(leadIds, customerIds),
  ]);

  const projects: OperationsProjectCard[] = deliveries.map((d) =>
    buildProjectCard(
      d,
      customers.get(d.customerId) || null,
      d.assignedTechnicianUserId ? users.get(d.assignedTechnicianUserId) || null : null,
      nmForDelivery(d, nmMap)
    )
  );

  const pipelineCounts = Object.fromEntries(
    [
      "lead_won",
      "quotation_approved",
      "advance_received",
      "site_survey",
      "material_ordered",
      "installation_scheduled",
      "installation_completed",
      "inspection",
      "net_metering_submitted",
      "net_metering_approved",
      "completed",
    ].map((k) => [k, 0])
  ) as Record<PipelineStageKey, number>;

  for (const p of projects) {
    pipelineCounts[p.pipelineStage] = (pipelineCounts[p.pipelineStage] || 0) + 1;
  }

  const kanban: Record<KanbanColumnKey, OperationsProjectCard[]> = {
    survey: [],
    procurement: [],
    installation: [],
    net_metering: [],
    completed: [],
  };
  for (const p of projects) {
    kanban[p.kanbanColumn].push(p);
  }

  const inProgress = projects.filter((p) => p.kanbanColumn !== "completed");
  const summary = {
    projectsInProgress: inProgress.length,
    waitingSurvey: projects.filter((p) => p.kanbanColumn === "survey").length,
    waitingMaterial: projects.filter((p) => p.kanbanColumn === "procurement").length,
    waitingInstallation: projects.filter((p) => p.kanbanColumn === "installation").length,
    waitingNetMetering: projects.filter((p) => p.kanbanColumn === "net_metering").length,
    completedThisMonth: projects.filter(
      (p) => p.kanbanColumn === "completed" && isCompletedThisMonth(p.updatedAt)
    ).length,
    overdueProjects: projects.filter((p) => p.isOverdue).length,
  };

  let estimatedRevenue = 0;
  try {
    const invoices = await listAdminInvoices(userId, username, role, localDb);
    const activeCustomerIds = new Set(inProgress.map((p) => p.customerId));
    for (const inv of invoices) {
      if (isExcludedFromLedgerTotals(inv.invoiceStatus)) continue;
      if (inv.customerId && activeCustomerIds.has(inv.customerId)) {
        estimatedRevenue += Number(inv.grandTotal || 0);
      }
    }
  } catch {
    estimatedRevenue = 0;
  }

  const ceoSummary = {
    projectsActive: summary.projectsInProgress,
    projectsDelayed: projects.filter((p) => p.delayTone === "red" && p.kanbanColumn !== "completed")
      .length,
    awaitingNetMetering: summary.waitingNetMetering,
    completedThisMonth: summary.completedThisMonth,
    estimatedRevenueInProgress: Math.round(estimatedRevenue * 100) / 100,
  };

  const delays = [...projects]
    .filter((p) => p.kanbanColumn !== "completed")
    .sort((a, b) => b.daysInStage - a.daysInStage);

  const teamBuckets: Record<string, { assigned: number; completed: number; completionDays: number[] }> = {
    "Survey Team": { assigned: 0, completed: 0, completionDays: [] },
    "Installation Team": { assigned: 0, completed: 0, completionDays: [] },
    "Net Metering Team": { assigned: 0, completed: 0, completionDays: [] },
    Unassigned: { assigned: 0, completed: 0, completionDays: [] },
  };

  for (const p of projects) {
    let team = p.assignedTeam;
    if (p.kanbanColumn === "net_metering") team = "Net Metering Team";
    if (!teamBuckets[team]) teamBuckets[team] = { assigned: 0, completed: 0, completionDays: [] };
    teamBuckets[team].assigned += 1;
    if (p.kanbanColumn === "completed") {
      teamBuckets[team].completed += 1;
      const span = Math.max(
        1,
        Math.floor(
          (new Date(p.updatedAt).getTime() - new Date(p.createdAt).getTime()) / 86400000
        )
      );
      teamBuckets[team].completionDays.push(span);
    }
  }

  const teamPerformance = Object.entries(teamBuckets)
    .filter(([team]) => team !== "Unassigned" || teamBuckets[team].assigned > 0)
    .map(([team, stats]) => ({
      team,
      assigned: stats.assigned,
      completed: stats.completed,
      avgCompletionDays:
        stats.completionDays.length > 0
          ? Math.round(
              stats.completionDays.reduce((s, d) => s + d, 0) / stats.completionDays.length
            )
          : null,
    }))
    .sort((a, b) => b.assigned - a.assigned);

  return {
    summary,
    ceoSummary,
    pipelineCounts,
    kanban,
    delays,
    teamPerformance,
    projects,
  };
}

export async function fetchProjectOperationsDetail(
  userId: string,
  username: string,
  role: string,
  deliveryId: string,
  localDb?: Database
): Promise<ProjectOperationsDetail> {
  const dashboard = await fetchProjectOperationsDashboard(userId, username, role, localDb);
  const project = dashboard.projects.find((p) => p.id === deliveryId);
  if (!project) {
    throw new StaffPortalAuthError("Project not found.", 404);
  }

  let customer: ProjectOperationsDetail["customer"] = null;
  let timeline: ProjectOperationsDetail["timeline"] = [];
  let equipment = { panels: null as string | null, inverter: null as string | null, battery: null as string | null };
  let nm: ProjectOperationsDetail["netMetering"] = null;
  const invoiceIds: string[] = [];

  if (isSupabaseActive()) {
    const supabase = getSupabase()!;
    const { data: cust } = await supabase
      .from("customers")
      .select("id, name, phone, address, email")
      .eq("id", project.customerId)
      .maybeSingle();
    if (cust) customer = cust;

    const { data: updates } = await supabase
      .from("project_delivery_updates")
      .select("*")
      .eq("delivery_id", deliveryId)
      .order("created_at", { ascending: true });
    timeline = (updates || []).map((u: any) => ({
      id: u.id,
      previousStatus: u.previous_status,
      newStatus: u.new_status,
      updatedBy: u.updated_by_user_id,
      notes: u.notes,
      createdAt: u.created_at,
    }));

    const { data: items } = await supabase
      .from("project_delivery_items")
      .select("item_category, brand, model")
      .eq("delivery_id", deliveryId);
    for (const it of items || []) {
      const cat = String(it.item_category || "").toLowerCase();
      const label = [it.brand, it.model].filter(Boolean).join(" ");
      if (cat.includes("panel")) equipment.panels = label || equipment.panels;
      if (cat.includes("inverter")) equipment.inverter = label || equipment.inverter;
      if (cat.includes("battery")) equipment.battery = label || equipment.battery;
    }

    if (project.leadId) {
      const { data: nmRow } = await supabase
        .from("net_metering_trackers")
        .select("*")
        .eq("lead_id", project.leadId)
        .maybeSingle();
      if (nmRow) {
        nm = {
          documentsCollected: !!nmRow.documents_collected,
          applicationSubmitted: !!nmRow.application_submitted,
          discoInspection: !!nmRow.disco_inspection,
          demandNotice: !!nmRow.demand_notice,
          meterInstallation: !!nmRow.meter_installation,
          greenMeterActive: !!nmRow.green_meter_active,
        };
      }
    }
  }

  try {
    const invoices = await listAdminInvoices(userId, username, role, localDb);
    invoiceIds.push(
      ...invoices
        .filter((i) => i.customerId === project.customerId)
        .map((i) => i.id)
    );
  } catch {
    // optional
  }

  if (!timeline.length && project.deliveryStatus) {
    timeline = [
      {
        id: "current",
        previousStatus: null,
        newStatus: project.deliveryStatus,
        updatedBy: project.assignedUserId,
        notes: `Completion stage: ${project.completionStage}`,
        createdAt: project.updatedAt,
      },
    ];
  }

  return {
    project,
    customer,
    equipment,
    timeline,
    links: {
      quotationId: project.quotationId,
      leadId: project.leadId,
      customerId: project.customerId,
      invoiceIds,
    },
    netMetering: nm,
  };
}
