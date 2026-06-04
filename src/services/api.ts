import { Lead, Ticket, AppState, Quote, User } from "../types";

const RENDER_PRODUCTION_API = "https://sunchaser-energy-systems.onrender.com";

export const API_BASE_URL = (
  (import.meta as any).env.VITE_API_BASE_URL || RENDER_PRODUCTION_API
).replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  return fetch(url, init);
}

export async function fetchAppState(): Promise<AppState> {
  const res = await apiFetch("/api/state");
  if (!res.ok) throw new Error("Failed to fetch Sunchaser state.");
  return res.json();
}

export type ClientPortalResponse = {
  user: User;
  customer: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    address?: string;
  } | null;
  lead: unknown;
  project: unknown;
  dashboard: Record<string, unknown>;
  tracker: { stages: unknown[]; progressPercent: number };
};

export async function fetchCustomerPortalMe(
  userId: string,
  username: string
): Promise<ClientPortalResponse> {
  const res = await apiFetch("/api/customer-portal/me", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sunchaser-User-Id": userId,
      "X-Sunchaser-Username": username,
    },
    body: JSON.stringify({ userId, username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load customer portal.");
  }
  return res.json();
}

function portalAuthHeaders(userId: string, username: string) {
  return {
    "Content-Type": "application/json",
    "X-Sunchaser-User-Id": userId,
    "X-Sunchaser-Username": username,
  };
}

export async function fetchCustomerPortalDocuments(userId: string, username: string) {
  const res = await apiFetch(
    `/api/customer-portal/documents/me?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`,
    { headers: portalAuthHeaders(userId, username) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load documents.");
  }
  return res.json();
}

export async function fetchCustomerPortalWarranties(userId: string, username: string) {
  const res = await apiFetch(
    `/api/customer-portal/warranties/me?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`,
    { headers: portalAuthHeaders(userId, username) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load warranties.");
  }
  return res.json();
}

export async function submitCustomerWarrantyClaim(
  userId: string,
  username: string,
  body: {
    component: string;
    issueDescription: string;
    photoUrl?: string;
    videoUrl?: string;
    voiceNoteUrl?: string;
    equipmentId?: string;
    equipmentType?: string;
  }
) {
  const res = await apiFetch("/api/customer-portal/warranty-claim", {
    method: "POST",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ userId, username, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to submit warranty claim.");
  }
  return res.json();
}

export async function createAdminCustomerDocument(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/customer-documents", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save document.");
  }
  return res.json();
}

export async function upsertAdminCustomerWarranty(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/customer-warranties", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save warranty.");
  }
  return res.json();
}

export async function listAdminWarrantyClaims(staffUserId: string, staffUsername: string) {
  const res = await apiFetch(
    `/api/admin/warranty-claims?userId=${encodeURIComponent(staffUserId)}&username=${encodeURIComponent(staffUsername)}`,
    { headers: portalAuthHeaders(staffUserId, staffUsername) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load warranty claims.");
  }
  return res.json();
}

export async function patchAdminWarrantyClaim(
  staffUserId: string,
  staffUsername: string,
  claimId: string,
  status: string
) {
  const res = await apiFetch(`/api/admin/warranty-claims/${claimId}`, {
    method: "PATCH",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update claim.");
  }
  return res.json();
}

export async function fetchCustomerSupportTickets(userId: string, username: string) {
  const res = await apiFetch(
    `/api/customer-portal/support-tickets/me?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`,
    { headers: portalAuthHeaders(userId, username) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load support tickets.");
  }
  return res.json();
}

export async function fetchCustomerSupportTicketById(
  userId: string,
  username: string,
  ticketId: string
) {
  const res = await apiFetch(
    `/api/customer-portal/support-tickets/${encodeURIComponent(ticketId)}?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`,
    { headers: portalAuthHeaders(userId, username) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load ticket.");
  }
  return res.json();
}

export async function createCustomerSupportTicket(
  userId: string,
  username: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/customer-portal/support-tickets", {
    method: "POST",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ userId, username, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create ticket.");
  }
  return res.json();
}

export async function listAdminSupportTickets(
  staffUserId: string,
  staffUsername: string,
  filters?: { status?: string; category?: string; priority?: string }
) {
  const q = new URLSearchParams({
    userId: staffUserId,
    username: staffUsername,
    ...(filters?.status ? { status: filters.status } : {}),
    ...(filters?.category ? { category: filters.category } : {}),
    ...(filters?.priority ? { priority: filters.priority } : {}),
  });
  const res = await apiFetch(`/api/admin/support-tickets?${q}`, {
    headers: portalAuthHeaders(staffUserId, staffUsername),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load support tickets.");
  }
  return res.json();
}

export async function updateAdminSupportTicket(
  staffUserId: string,
  staffUsername: string,
  ticketId: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch(`/api/admin/support-tickets/${encodeURIComponent(ticketId)}`, {
    method: "PATCH",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update ticket.");
  }
  return res.json();
}

export async function fetchCustomerServicePortal(userId: string, username: string) {
  const res = await apiFetch(
    `/api/customer-portal/service/me?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`,
    { headers: portalAuthHeaders(userId, username) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load service portal.");
  }
  return res.json();
}

export async function fetchCustomerServiceRequestById(
  userId: string,
  username: string,
  requestId: string
) {
  const res = await apiFetch(
    `/api/customer-portal/service-requests/${encodeURIComponent(requestId)}?userId=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}`,
    { headers: portalAuthHeaders(userId, username) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load service request.");
  }
  return res.json();
}

export async function createCustomerServiceRequest(
  userId: string,
  username: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/customer-portal/service-requests", {
    method: "POST",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ userId, username, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create service request.");
  }
  return res.json();
}

export async function listAdminServiceRequests(
  staffUserId: string,
  staffUsername: string,
  filters?: { status?: string }
) {
  const q = new URLSearchParams({
    userId: staffUserId,
    username: staffUsername,
    ...(filters?.status ? { status: filters.status } : {}),
  });
  const res = await apiFetch(`/api/admin/service-requests?${q}`, {
    headers: portalAuthHeaders(staffUserId, staffUsername),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load service requests.");
  }
  return res.json();
}

export async function updateAdminServiceRequest(
  staffUserId: string,
  staffUsername: string,
  requestId: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch(`/api/admin/service-requests/${encodeURIComponent(requestId)}`, {
    method: "PATCH",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update service request.");
  }
  return res.json();
}

export async function fetchCustomerSavings(userId: string, username: string) {
  const res = await apiFetch("/api/customer-portal/savings/me", {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load savings dashboard.");
  }
  return res.json();
}

export async function fetchAdminCustomerSavings(
  staffUserId: string,
  staffUsername: string,
  customerId: string
) {
  const res = await apiFetch(
    `/api/admin/customer-savings/${encodeURIComponent(customerId)}?userId=${encodeURIComponent(staffUserId)}&username=${encodeURIComponent(staffUsername)}`,
    { headers: portalAuthHeaders(staffUserId, staffUsername) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load customer savings.");
  }
  return res.json();
}

export async function upsertAdminCustomerSavings(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/customer-savings", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save customer savings.");
  }
  return res.json();
}

export async function fetchCustomerCare(userId: string, username: string) {
  const res = await apiFetch("/api/customer-portal/care/me", {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load care plans.");
  }
  return res.json();
}

export async function subscribeCustomerCare(
  userId: string,
  username: string,
  planCode: string
) {
  const res = await apiFetch("/api/customer-portal/care/subscribe", {
    method: "POST",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ planCode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to subscribe to care plan.");
  }
  return res.json();
}

export async function createCareServiceRequest(
  userId: string,
  username: string,
  requestType: string,
  notes?: string
) {
  const res = await apiFetch("/api/customer-portal/care/service-request", {
    method: "POST",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ requestType, notes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to submit care visit request.");
  }
  return res.json();
}

export async function listAdminCareSubscriptions(
  staffUserId: string,
  staffUsername: string,
  segment: "active" | "expired" | "renewals"
) {
  const q = new URLSearchParams({
    userId: staffUserId,
    username: staffUsername,
    segment,
  });
  const res = await apiFetch(`/api/admin/care/subscriptions?${q}`, {
    headers: portalAuthHeaders(staffUserId, staffUsername),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load subscriptions.");
  }
  return res.json();
}

export async function fetchAdminCareRevenueSummary(staffUserId: string, staffUsername: string) {
  const q = new URLSearchParams({ userId: staffUserId, username: staffUsername });
  const res = await apiFetch(`/api/admin/care/revenue-summary?${q}`, {
    headers: portalAuthHeaders(staffUserId, staffUsername),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load revenue summary.");
  }
  return res.json();
}

export async function createAdminVisitReport(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/care/visit-reports", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create visit report.");
  }
  return res.json();
}

export async function fetchCustomerEquipment(userId: string, username: string) {
  const res = await apiFetch("/api/customer-portal/equipment/me", {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load equipment.");
  }
  return res.json();
}

export async function fetchCustomerInstallationPhotos(userId: string, username: string) {
  const res = await apiFetch("/api/customer-portal/installation-photos/me", {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load installation photos.");
  }
  return res.json();
}

export async function fetchCustomerServiceHistory(userId: string, username: string) {
  const res = await apiFetch("/api/customer-portal/service-history/me", {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load service history.");
  }
  return res.json();
}

export async function upsertAdminPortalProfile(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/customer-portal-profile", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save portal profile.");
  }
  return res.json();
}

export async function createAdminCustomerEquipment(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/customer-equipment", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to add equipment.");
  }
  return res.json();
}

export async function patchAdminCustomerEquipment(
  staffUserId: string,
  staffUsername: string,
  equipmentId: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch(`/api/admin/customer-equipment/${encodeURIComponent(equipmentId)}`, {
    method: "PATCH",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update equipment.");
  }
  return res.json();
}

export async function createAdminInstallationPhoto(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/installation-photos", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to upload installation photo.");
  }
  return res.json();
}

export async function createAdminAfterSalesServiceLog(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/after-sales-service-log", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save service log.");
  }
  return res.json();
}

export async function createAdminMaintenanceRecord(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/maintenance-records", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create maintenance record.");
  }
  return res.json();
}

export async function listAdminAfterSalesServiceLogs(
  staffUserId: string,
  staffUsername: string,
  customerId?: string
) {
  const q = new URLSearchParams({
    userId: staffUserId,
    username: staffUsername,
    ...(customerId ? { customerId } : {}),
  });
  const res = await apiFetch(`/api/admin/after-sales-service-logs?${q}`, {
    headers: portalAuthHeaders(staffUserId, staffUsername),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load service logs.");
  }
  return res.json();
}

export async function fetchCustomerEnergyMonitor(userId: string, username: string) {
  const res = await apiFetch("/api/customer-portal/energy/me", {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load energy monitor.");
  }
  return res.json();
}

export async function upsertAdminEnergyDevice(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/energy/devices", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ userId: staffUserId, username: staffUsername, ...body }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to register energy device.");
  }
  return res.json();
}

export async function fetchAdminEnergyMonitoring(staffUserId: string, staffUsername: string) {
  const q = new URLSearchParams({ userId: staffUserId, username: staffUsername });
  const res = await apiFetch(`/api/admin/energy/monitoring?${q}`, {
    headers: portalAuthHeaders(staffUserId, staffUsername),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load energy monitoring.");
  }
  return res.json();
}

export async function loginUser(body: { username: string; password?: string }): Promise<{ success: boolean; user: User }> {
  const res = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Login Authorization Rejected.");
  }
  return res.json();
}

export async function createLead(data: Partial<Lead>): Promise<Lead> {
  const res = await apiFetch("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to submit solar request.");
  return res.json();
}

export async function updateLead(id: string, data: Partial<Lead>): Promise<Lead> {
  const res = await apiFetch(`/api/leads/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update customer record.");
  return res.json();
}

export async function assignLead(id: string, salespersonName: string): Promise<Lead> {
  const res = await apiFetch(`/api/leads/${id}/assign`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ salespersonName }),
  });
  if (!res.ok) throw new Error("Failed to delegate salesperson.");
  return res.json();
}

export async function runAiLeadScoring(id: string): Promise<{ scoreAnalysis: string }> {
  const res = await apiFetch(`/api/leads/${id}/ai-score`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("AI Scoring Diagnostic failed.");
  return res.json();
}

export async function scheduleSurvey(id: string, scheduledDate: string): Promise<Lead> {
  const res = await apiFetch(`/api/leads/${id}/schedule-survey`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scheduledDate }),
  });
  return res.json();
}

export async function sendWhatsAppReminder(id: string): Promise<any> {
  const res = await apiFetch(`/api/leads/${id}/whatsapp-reminder`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to dispatch WhatsApp follow-up reminder.");
  return res.json();
}

export async function procureInventory(vendor: string, itemId: string, quantity: number): Promise<any> {
  const res = await apiFetch("/api/inventory/procure", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vendor, itemId, quantity }),
  });
  if (!res.ok) throw new Error("Inventory procurement request failed.");
  return res.json();
}

export async function submitSurveyReport(id: string, data: any): Promise<Lead> {
  const res = await apiFetch(`/api/leads/${id}/survey-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function createQuote(id: string, quoteData: Partial<Quote>): Promise<Lead> {
  const res = await apiFetch(`/api/leads/${id}/create-quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(quoteData),
  });
  return res.json();
}

export async function acceptQuote(id: string, quoteId: string): Promise<Lead> {
  const res = await apiFetch(`/api/leads/${id}/accept-quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteId }),
  });
  return res.json();
}

export async function updateInstallation(id: string, installationData: any): Promise<Lead> {
  const res = await apiFetch(`/api/leads/${id}/update-installation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(installationData),
  });
  return res.json();
}

export async function createTicket(ticketData: any): Promise<Ticket> {
  const res = await apiFetch("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ticketData),
  });
  return res.json();
}

export async function replyToTicket(id: string, text: string, sender: 'Customer' | 'Agent'): Promise<Ticket> {
  const res = await apiFetch(`/api/tickets/${id}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, sender }),
  });
  return res.json();
}

export async function resolveTicket(id: string): Promise<Ticket> {
  const res = await apiFetch(`/api/tickets/${id}/resolve`, {
    method: "PUT",
  });
  return res.json();
}

/* --- PROJECT / NET-METERING / MILESTONES API --- */

export async function updateProjectStage(projectId: string, stage: string): Promise<any> {
  const res = await apiFetch(`/api/projects/${projectId}/update-stage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage }),
  });
  return res.json();
}

export async function updateNetMetering(leadId: string, data: any): Promise<any> {
  const res = await apiFetch(`/api/projects/${leadId}/net-metering/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function payMilestone(leadId: string, milestoneName: string, status: 'Pending' | 'Paid'): Promise<any> {
  const res = await apiFetch(`/api/payments/${leadId}/milestone`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ milestoneName, status }),
  });
  return res.json();
}

/* --- GEMINI AI SERVICES --- */

export async function askGeminiAssistant(message: string, history: Array<{ sender: string; text: string }>) {
  const res = await apiFetch("/api/gemini/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!res.ok) throw new Error("Gemini chatbot error");
  return res.json();
}

export async function generateSizingRecommendations(params: {
  monthlyBill: number;
  roofSpace: number;
  shading: string;
  stateLocation?: string;
  notes?: string;
}) {
  const res = await apiFetch("/api/gemini/sizing-recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function generateProposalDocument(params: {
  customerName: string;
  address: string;
  systemSizekW: number;
  batteryUpgrade: boolean;
  totalCost: number;
  notes?: string;
}) {
  const res = await apiFetch("/api/gemini/generate-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

/* --- MULTI-BUSINESS NEW SYSTEM CLIENT SERVICES --- */

export async function placeMultiBusinessOrder(orderData: any): Promise<any> {
  const res = await apiFetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderData),
  });
  if (!res.ok) throw new Error("Order placement failed.");
  return res.json();
}

export async function updateMultiBusinessOrderStatus(orderId: string, status: string, remarks?: string): Promise<any> {
  const res = await apiFetch(`/api/orders/${orderId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, remarks }),
  });
  if (!res.ok) throw new Error("Failed to adjust order status.");
  return res.json();
}

export async function createAdvancedComplaintTicket(ticketData: any): Promise<any> {
  const res = await apiFetch("/api/tickets/advanced", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ticketData),
  });
  if (!res.ok) throw new Error("Advanced complaint routing ticket registration failed.");
  return res.json();
}

export async function assignTechnicianToTicket(ticketId: string, technicianName: string, internalNotes?: string): Promise<any> {
  const res = await apiFetch(`/api/tickets/${ticketId}/tech-assign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ technicianName, internalNotes }),
  });
  if (!res.ok) throw new Error("Failed to delegate tech to ticked.");
  return res.json();
}

export async function technicianResolveTicket(ticketId: string, resolutionText: string, resolutionProofUrl?: string): Promise<any> {
  const res = await apiFetch(`/api/tickets/${ticketId}/tech-resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolutionText, resolutionProofUrl }),
  });
  if (!res.ok) throw new Error("Correction job resolving dispatch failed.");
  return res.json();
}

export async function submitWarrantyClaim(warrantyId: string, issueTitle: string, description: string): Promise<any> {
  const res = await apiFetch(`/api/warranties/${warrantyId}/claims`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issueTitle, description }),
  });
  if (!res.ok) throw new Error("Warranty claim filing rejected.");
  return res.json();
}

export async function updateWarrantyClaimStatus(warrantyId: string, claimId: string, status: 'Approved' | 'Rejected', resolutionNotes?: string): Promise<any> {
  const res = await apiFetch(`/api/warranties/${warrantyId}/claims/${claimId}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, resolutionNotes }),
  });
  if (!res.ok) throw new Error("Failed to update claim resolution decision.");
  return res.json();
}

export async function markNotificationAsRead(notifId: string): Promise<any> {
  const res = await apiFetch(`/api/notifications/${notifId}/read`, {
    method: "POST",
  });
  return res.json();
}

export async function deleteLead(id: string): Promise<any> {
  const res = await apiFetch(`/api/leads/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete lead.");
  return res.json();
}

export async function deleteQuote(leadId: string, quoteId: string): Promise<any> {
  const res = await apiFetch(`/api/leads/${leadId}/quotes/${quoteId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete quote.");
  return res.json();
}

export async function fetchOnboardingMe(userId: string, username: string) {
  const q = new URLSearchParams({ userId, username });
  const res = await apiFetch(`/api/onboarding/me?${q}`, {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load onboarding.");
  }
  return res.json();
}

export async function completeOnboarding(userId: string, username: string) {
  const res = await apiFetch("/api/onboarding/complete", {
    method: "POST",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ userId, username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to complete onboarding.");
  }
  return res.json();
}

export async function resetOnboarding(userId: string, username: string) {
  const res = await apiFetch("/api/onboarding/reset", {
    method: "POST",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ userId, username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to reset onboarding.");
  }
  return res.json();
}

export async function fetchTechnicalJobsMe(userId: string, username: string) {
  const q = new URLSearchParams({ userId, username });
  const res = await apiFetch(`/api/technical/jobs/me?${q}`, {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load technical jobs.");
  }
  return res.json();
}

export async function fetchTechnicalJobById(userId: string, username: string, jobId: string) {
  const q = new URLSearchParams({ userId, username });
  const res = await apiFetch(`/api/technical/jobs/${encodeURIComponent(jobId)}?${q}`, {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load job.");
  }
  return res.json();
}

export async function patchTechnicalJobStatus(
  userId: string,
  username: string,
  jobId: string,
  status: string
) {
  const res = await apiFetch(`/api/technical/jobs/${encodeURIComponent(jobId)}/status`, {
    method: "PATCH",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ status, userId, username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update job status.");
  }
  return res.json();
}

export async function postTechnicalJobUpdate(
  userId: string,
  username: string,
  jobId: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch(`/api/technical/jobs/${encodeURIComponent(jobId)}/update`, {
    method: "POST",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ ...body, userId, username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save job update.");
  }
  return res.json();
}

export async function postTechnicalEquipment(
  userId: string,
  username: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/technical/equipment", {
    method: "POST",
    headers: portalAuthHeaders(userId, username),
    body: JSON.stringify({ ...body, userId, username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to add equipment.");
  }
  return res.json();
}

export async function fetchAdminProjectDeliveries(staffUserId: string, staffUsername: string) {
  const q = new URLSearchParams({ userId: staffUserId, username: staffUsername });
  const res = await apiFetch(`/api/admin/project-deliveries?${q}`, {
    headers: portalAuthHeaders(staffUserId, staffUsername),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load project deliveries.");
  }
  return res.json();
}

export async function createAdminProjectDelivery(
  staffUserId: string,
  staffUsername: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch("/api/admin/project-deliveries", {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ ...body, userId: staffUserId, username: staffUsername }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create project delivery.");
  }
  return res.json();
}

export async function patchAdminProjectDelivery(
  staffUserId: string,
  staffUsername: string,
  deliveryId: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch(`/api/admin/project-deliveries/${encodeURIComponent(deliveryId)}`, {
    method: "PATCH",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ ...body, userId: staffUserId, username: staffUsername }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update project delivery.");
  }
  return res.json();
}

export async function addAdminProjectDeliveryItems(
  staffUserId: string,
  staffUsername: string,
  deliveryId: string,
  items: unknown[]
) {
  const res = await apiFetch(`/api/admin/project-deliveries/${encodeURIComponent(deliveryId)}/items`, {
    method: "POST",
    headers: portalAuthHeaders(staffUserId, staffUsername),
    body: JSON.stringify({ items, userId: staffUserId, username: staffUsername }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to add delivery items.");
  }
  return res.json();
}

export async function fetchTechnicalProjectDeliveriesMe(userId: string, username: string) {
  const q = new URLSearchParams({ userId, username });
  const res = await apiFetch(`/api/technical/project-deliveries/me?${q}`, {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load assigned deliveries.");
  }
  return res.json();
}

export async function fetchTechnicalProjectDeliveryById(
  userId: string,
  username: string,
  deliveryId: string
) {
  const q = new URLSearchParams({ userId, username });
  const res = await apiFetch(
    `/api/technical/project-deliveries/${encodeURIComponent(deliveryId)}?${q}`,
    { headers: portalAuthHeaders(userId, username) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load delivery.");
  }
  return res.json();
}

export async function postTechnicalDeliveryInstalledEquipment(
  userId: string,
  username: string,
  deliveryId: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch(
    `/api/technical/project-deliveries/${encodeURIComponent(deliveryId)}/installed-equipment`,
    {
      method: "POST",
      headers: portalAuthHeaders(userId, username),
      body: JSON.stringify({ ...body, userId, username }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to save installed equipment.");
  }
  return res.json();
}

export async function postTechnicalDeliveryPhoto(
  userId: string,
  username: string,
  deliveryId: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch(
    `/api/technical/project-deliveries/${encodeURIComponent(deliveryId)}/photos`,
    {
      method: "POST",
      headers: portalAuthHeaders(userId, username),
      body: JSON.stringify({ ...body, userId, username }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to upload photo.");
  }
  return res.json();
}

export async function patchTechnicalDeliveryStatus(
  userId: string,
  username: string,
  deliveryId: string,
  body: Record<string, unknown>
) {
  const res = await apiFetch(
    `/api/technical/project-deliveries/${encodeURIComponent(deliveryId)}/status`,
    {
      method: "PATCH",
      headers: portalAuthHeaders(userId, username),
      body: JSON.stringify({ ...body, userId, username }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update delivery status.");
  }
  return res.json();
}

export async function fetchCustomerProjectDeliveryMe(userId: string, username: string) {
  const q = new URLSearchParams({ userId, username });
  const res = await apiFetch(`/api/customer-portal/project-delivery/me?${q}`, {
    headers: portalAuthHeaders(userId, username),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load project delivery.");
  }
  return res.json();
}

export let currencySymbol = "$";

export function setCurrencySymbol(symbol: string) {
  currencySymbol = symbol;
}

export function formatPrice(amount: number): string {
  return `${currencySymbol}${amount.toLocaleString()}`;
}
