import { Lead, Ticket, AppState, Quote, User } from "../types";

export const API_BASE_URL = ((import.meta as any).env.VITE_API_BASE_URL || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  return fetch(url, init);
}

export async function fetchAppState(): Promise<AppState> {
  const res = await apiFetch("/api/state");
  if (!res.ok) throw new Error("Failed to fetch Sunchaser state.");
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

export let currencySymbol = "$";

export function setCurrencySymbol(symbol: string) {
  currencySymbol = symbol;
}

export function formatPrice(amount: number): string {
  return `${currencySymbol}${amount.toLocaleString()}`;
}
