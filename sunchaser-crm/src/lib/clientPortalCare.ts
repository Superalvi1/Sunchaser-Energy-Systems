export const CARE_PLAN_CODES = ["care_basic", "care_premium", "total_peace"] as const;
export type CarePlanCode = (typeof CARE_PLAN_CODES)[number];

export const SUBSCRIPTION_STATUSES = ["Active", "Expired", "Cancelled", "Pending"] as const;

export const CARE_SERVICE_REQUEST_TYPES = [
  { key: "cleaning", label: "Request Cleaning", serviceType: "Cleaning" },
  { key: "inspection", label: "Request Inspection", serviceType: "Inspection" },
  { key: "battery", label: "Request Battery Health Check", serviceType: "Battery Health Check" },
] as const;

export type CareServiceRequestKey = (typeof CARE_SERVICE_REQUEST_TYPES)[number]["key"];

export interface SubscriptionPlanRecord {
  id: string;
  planCode: string;
  name: string;
  monthlyPrice: number;
  features: string[];
  serviceCreditsPerMonth: number;
  sortOrder: number;
}

export interface CustomerSubscriptionRecord {
  id: string;
  customerId: string;
  planId: string;
  planName?: string;
  planCode?: string;
  status: string;
  startDate: string;
  renewalDate: string;
  serviceCreditsUsed: number;
  serviceCreditsLimit: number;
  daysRemaining: number;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceVisitReportRecord {
  id: string;
  customerId: string;
  subscriptionId?: string | null;
  serviceRequestId?: string | null;
  technician?: string | null;
  visitDate?: string | null;
  performanceImprovementNotes?: string | null;
  beforePhotoUrl?: string | null;
  afterPhotoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CarePortalPayload {
  plans: SubscriptionPlanRecord[];
  subscription: CustomerSubscriptionRecord | null;
  visitReports: ServiceVisitReportRecord[];
}

export const DEFAULT_CARE_PLANS: SubscriptionPlanRecord[] = [
  {
    id: "plan-care-basic",
    planCode: "care_basic",
    name: "Care Basic",
    monthlyPrice: 4999,
    features: [
      "Quarterly panel cleaning",
      "Email support",
      "Annual performance review",
      "1 service credit per month",
    ],
    serviceCreditsPerMonth: 1,
    sortOrder: 1,
  },
  {
    id: "plan-care-premium",
    planCode: "care_premium",
    name: "Care Premium",
    monthlyPrice: 8999,
    features: [
      "Bi-monthly cleaning visit",
      "Priority support",
      "Inverter health monitoring",
      "2 service credits per month",
      "Physical inspection annually",
    ],
    serviceCreditsPerMonth: 2,
    sortOrder: 2,
  },
  {
    id: "plan-total-peace",
    planCode: "total_peace",
    name: "Total Peace Of Mind",
    monthlyPrice: 14999,
    features: [
      "Monthly cleaning visit",
      "24/7 priority support",
      "Full warranty coordination",
      "4 service credits per month",
      "Battery health checks",
      "Before/after visit reports",
    ],
    serviceCreditsPerMonth: 4,
    sortOrder: 3,
  },
];

export function formatPkrCare(amount: number): string {
  return `PKR ${Math.round(amount).toLocaleString("en-PK")}`;
}

export function parseFeatures(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return raw ? [raw] : [];
    }
  }
  return [];
}

export function mapSubscriptionPlanRow(row: any): SubscriptionPlanRecord {
  return {
    id: row.id,
    planCode: row.plan_code,
    name: row.name,
    monthlyPrice: Number(row.monthly_price),
    features: parseFeatures(row.features),
    serviceCreditsPerMonth: Number(row.service_credits_per_month || 0),
    sortOrder: Number(row.sort_order || 0),
  };
}

export function daysUntil(dateStr: string): number {
  const end = new Date(dateStr.length === 10 ? `${dateStr}T12:00:00` : dateStr);
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function mapCustomerSubscriptionRow(row: any, plan?: SubscriptionPlanRecord): CustomerSubscriptionRecord {
  const renewalDate = row.renewal_date;
  return {
    id: row.id,
    customerId: row.customer_id,
    planId: row.plan_id,
    planName: plan?.name || row.plan_name,
    planCode: plan?.planCode || row.plan_code,
    status: row.status,
    startDate: row.start_date,
    renewalDate,
    serviceCreditsUsed: Number(row.service_credits_used || 0),
    serviceCreditsLimit: Number(row.service_credits_limit || 0),
    daysRemaining: daysUntil(renewalDate),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export function mapServiceVisitReportRow(row: any): ServiceVisitReportRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    serviceRequestId: row.service_request_id,
    technician: row.technician,
    visitDate: row.visit_date,
    performanceImprovementNotes: row.performance_improvement_notes,
    beforePhotoUrl: row.before_photo_url,
    afterPhotoUrl: row.after_photo_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export function isCareTablesMissingError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  return (
    err?.code === "PGRST205" &&
    (msg.includes("subscription_plans") ||
      msg.includes("customer_subscriptions") ||
      msg.includes("service_visit_reports"))
  );
}
