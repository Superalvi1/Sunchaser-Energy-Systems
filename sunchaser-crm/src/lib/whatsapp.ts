export const WHATSAPP_MESSAGE_TYPES = [
  "quotation_sent",
  "advance_payment_reminder",
  "installation_scheduled",
  "technician_assigned",
  "service_ticket_received",
  "warranty_claim_received",
  "payment_balance_reminder",
  "care_plan_renewal_reminder",
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
  planName?: string;
  companyName?: string;
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
    case "warranty_claim_received":
      return `Hello ${name}, your warranty claim has been received and is under review. — ${company}`;
    case "payment_balance_reminder":
      return `Hello ${name}, your remaining project balance is ${fmtAmount(vars.balance)}. Please contact ${company} for payment options.`;
    case "care_plan_renewal_reminder":
      return `Hello ${name}, your care plan${vars.planName ? ` (${vars.planName})` : ""} renewal is due soon. — ${company}`;
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
  quotation_sent: "Send quotation message",
  advance_payment_reminder: "Send payment reminder",
  installation_scheduled: "Send installation update",
  technician_assigned: "Technician assigned",
  service_ticket_received: "Send service update",
  warranty_claim_received: "Warranty claim received",
  payment_balance_reminder: "Payment balance reminder",
  care_plan_renewal_reminder: "Care plan renewal reminder",
};
