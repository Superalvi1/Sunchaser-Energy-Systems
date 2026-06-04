export const ACCOUNT_STATUSES = ["Pending", "Approved", "Suspended", "Rejected"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const APP_ROLES = [
  "Super Admin",
  "Director",
  "Admin",
  "Accounts Manager",
  "Sales Manager",
  "Sales Executive",
  "Survey Engineer",
  "Technician",
  "Customer",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** Roles allowed on public self-registration form */
export const SELF_REGISTER_ROLES: AppRole[] = ["Customer", "Technician", "Sales Executive"];

/** Self-register but require Super Admin approval before login */
export const SELF_REGISTER_APPROVAL_ROLES: AppRole[] = ["Technician", "Sales Executive"];

/** Only Super Admin may create via admin panel */
export const ADMIN_ONLY_CREATE_ROLES: AppRole[] = [
  "Director",
  "Admin",
  "Accounts Manager",
  "Sales Manager",
  "Super Admin",
];

export function canSelfRegister(role: string): boolean {
  return (SELF_REGISTER_ROLES as readonly string[]).includes(role);
}

export function selfRegisterRequiresApproval(role: string): boolean {
  return (SELF_REGISTER_APPROVAL_ROLES as readonly string[]).includes(role);
}

export function isSuperAdmin(username: string, role: string): boolean {
  return role === "Super Admin" || String(username || "").toLowerCase() === "allauddin";
}

export type PermissionKey =
  | "crm_leads"
  | "sales_quotes"
  | "admin_dashboard"
  | "support_desk"
  | "project_delivery"
  | "project_finance"
  | "user_management"
  | "customer_portal"
  | "technical_field";

export const ROLE_PERMISSIONS: Record<AppRole, PermissionKey[]> = {
  "Super Admin": [
    "crm_leads",
    "sales_quotes",
    "admin_dashboard",
    "support_desk",
    "project_delivery",
    "project_finance",
    "user_management",
    "customer_portal",
    "technical_field",
  ],
  Director: [
    "crm_leads",
    "sales_quotes",
    "admin_dashboard",
    "support_desk",
    "project_delivery",
    "project_finance",
    "user_management",
    "technical_field",
  ],
  Admin: [
    "crm_leads",
    "sales_quotes",
    "admin_dashboard",
    "support_desk",
    "project_delivery",
    "technical_field",
  ],
  "Accounts Manager": ["admin_dashboard", "project_finance", "crm_leads"],
  "Sales Manager": ["crm_leads", "sales_quotes", "admin_dashboard"],
  "Sales Executive": ["crm_leads", "sales_quotes"],
  "Survey Engineer": ["technical_field"],
  Technician: ["technical_field", "support_desk"],
  Customer: ["customer_portal"],
};

export function roleHasPermission(role: string, permission: PermissionKey): boolean {
  const perms = ROLE_PERMISSIONS[role as AppRole];
  if (perms) return perms.includes(permission);
  if (role === "Technical CEO") return roleHasPermission("Director", permission);
  if (role === "Sales Advisor") return roleHasPermission("Sales Executive", permission);
  if (role === "Service Technician" || role === "Installation Team") {
    return roleHasPermission("Technician", permission);
  }
  return false;
}

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  crm_leads: "CRM / Leads",
  sales_quotes: "Sales & Quotations",
  admin_dashboard: "Admin dashboard",
  support_desk: "Support & service desk",
  project_delivery: "Project delivery",
  project_finance: "Finance (profit view)",
  user_management: "User management",
  customer_portal: "Customer portal",
  technical_field: "Field / technical jobs",
};
