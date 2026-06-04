import type { Lead } from "../types";

export const WHATSAPP_MESSAGE_TYPES = [
  "open_chat",
  "quotation_sent",
  "advance_payment_reminder",
  "installation_scheduled",
  "technician_assigned",
  "service_ticket_received",
  "support_ticket_update",
  "warranty_claim_received",
  "payment_balance_reminder",
  "care_plan_renewal_reminder",
  "invoice_sent",
  "invoice_payment_reminder",
] as const;

export type WhatsAppMessageType = (typeof WHATSAPP_MESSAGE_TYPES)[number];

export type WhatsAppTemplateVars = {
  customerName?: string;
  projectTitle?: string;
  amount?: string | number;
  balance?: string | number;
  date?: string;
  technicianName?: string;
  ticketId?: string;
  ticketSubject?: string;
  ticketStatus?: string;
  planName?: string;
  companyName?: string;
  invoiceNumber?: string;
};

const DEFAULT_COMPANY = "Sunchaser Energy Systems";

function fmtAmount(v: string | number | undefined) {
  if (v == null || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? `PKR ${n.toLocaleString()}` : String(v);
}

export function buildWhatsAppMessageBody(
  messageType: WhatsAppMessageType,
  vars: WhatsAppTemplateVars = {}
): string {
  const company = vars.companyName || DEFAULT_COMPANY;
  const name = vars.customerName || "Customer";
  switch (messageType) {
    case "open_chat":
      return `Hello ${name}, this is ${company}. How can we help you today?`;
    case "quotation_sent":
      return `Hello ${name}, your solar quotation from ${company} is ready. Please review and let us know if you have any questions.`;
    case "advance_payment_reminder":
      return `Hello ${name}, this is a friendly reminder from ${company} regarding your advance payment of ${fmtAmount(vars.amount)}. Thank you.`;
    case "installation_scheduled":
      return `Hello ${name}, your installation for ${vars.projectTitle || "your solar project"} is scheduled${vars.date ? ` on ${vars.date}` : ""}. — ${company}`;
    case "technician_assigned":
      return `Hello ${name}, technician ${vars.technicianName || "our team"} has been assigned to your project${vars.projectTitle ? ` (${vars.projectTitle})` : ""}. — ${company}`;
    case "service_ticket_received":
      return `Hello ${name}, we have received your service request${vars.ticketId ? ` (${vars.ticketId})` : ""}. Our team will update you shortly. — ${company}`;
    case "support_ticket_update":
      return `Hello ${name}, update on your support ticket${vars.ticketId ? ` ${vars.ticketId}` : ""}${vars.ticketSubject ? ` (${vars.ticketSubject})` : ""}: status is ${vars.ticketStatus || "In Review"}${vars.date ? `, visit scheduled ${vars.date}` : ""}${vars.technicianName ? `, technician ${vars.technicianName}` : ""}. — ${company}`;
    case "warranty_claim_received":
      return `Hello ${name}, your warranty claim has been received and is under review. — ${company}`;
    case "payment_balance_reminder":
      return `Hello ${name}, your remaining project balance is ${fmtAmount(vars.balance)}. Please contact ${company} for payment options.`;
    case "care_plan_renewal_reminder":
      return `Hello ${name}, your care plan${vars.planName ? ` (${vars.planName})` : ""} renewal is due soon. — ${company}`;
    case "invoice_sent":
      return `Hello ${name}, your invoice${vars.invoiceNumber ? ` ${vars.invoiceNumber}` : ""} from ${company} is ready. Total: ${fmtAmount(vars.amount)}. Please review and arrange payment. Thank you.`;
    case "invoice_payment_reminder":
      return `Hello ${name}, friendly reminder: invoice${vars.invoiceNumber ? ` ${vars.invoiceNumber}` : ""} balance ${fmtAmount(vars.balance)} is due. — ${company}`;
    default:
      return `Hello ${name}, message from ${company}.`;
  }
}

export function normalizePhoneForWhatsApp(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("0")) return `92${digits.slice(1)}`;
  if (digits.length === 10) return `92${digits}`;
  return digits;
}

export function buildWhatsAppDeepLink(phone: string, message: string): string {
  const normalized = normalizePhoneForWhatsApp(phone);
  const text = encodeURIComponent(message);
  return `https://wa.me/${normalized}?text=${text}`;
}

export const WHATSAPP_TEMPLATE_LABELS: Record<WhatsAppMessageType, string> = {
  open_chat: "Open WhatsApp",
  quotation_sent: "Send quotation",
  advance_payment_reminder: "Payment reminder",
  installation_scheduled: "Installation schedule",
  technician_assigned: "Technician assigned",
  service_ticket_received: "Service request",
  support_ticket_update: "Ticket update",
  warranty_claim_received: "Warranty claim",
  payment_balance_reminder: "Balance reminder",
  care_plan_renewal_reminder: "Care renewal",
  invoice_sent: "Send invoice",
  invoice_payment_reminder: "Invoice payment reminder",
};

/** Resolve CRM lead phone from portal customer id or email (no schema change). */
export function resolveLeadPhoneFromLeads(
  leads: Lead[],
  opts: { customerId?: string | null; email?: string | null; name?: string | null }
): string {
  const email = opts.email?.trim().toLowerCase();
  if (email) {
    const byEmail = leads.find((l) => l.email?.trim().toLowerCase() === email);
    if (byEmail?.phone) return byEmail.phone;
  }
  const customerId = opts.customerId?.trim();
  if (customerId) {
    const byCust = leads.find(
      (l) => `cust-${l.id.replace(/^lead-/, "")}` === customerId || l.id === customerId
    );
    if (byCust?.phone) return byCust.phone;
  }
  const name = opts.name?.trim();
  if (name) {
    const byName = leads.find((l) => l.name === name);
    if (byName?.phone) return byName.phone;
  }
  return "";
}
