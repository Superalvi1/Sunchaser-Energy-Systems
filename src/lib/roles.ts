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

export const SELF_REGISTER_ROLES: AppRole[] = ["Customer", "Technician", "Sales Executive"];
export const SELF_REGISTER_APPROVAL_ROLES: AppRole[] = ["Technician", "Sales Executive"];
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

export function canManageCustomers(username: string, role: string): boolean {
  return isSuperAdmin(username, role) || role === "Admin" || role === "Director";
}

/** All module permissions (stored in role_permissions.permission_key) */
export const ALL_PERMISSION_KEYS = [
  "crm_leads",
  "sales_quotes",
  "admin_dashboard",
  "support_desk",
  "project_delivery",
  "project_finance",
  "user_management",
  "customer_portal",
  "technical_field",
  "inventory",
  "products",
  "reports",
  "settings",
] as const;

export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  crm_leads: "CRM / Leads",
  sales_quotes: "Sales & Quotations",
  admin_dashboard: "Admin Dashboard",
  support_desk: "Support & Service Desk",
  project_delivery: "Project Delivery",
  project_finance: "Finance / Profit View",
  user_management: "User Management",
  customer_portal: "Customer Portal",
  technical_field: "Field / Technical Jobs",
  inventory: "Inventory",
  products: "Products",
  reports: "Reports",
  settings: "Settings",
};

export const ROLE_PERMISSIONS: Record<AppRole, PermissionKey[]> = {
  "Super Admin": [...ALL_PERMISSION_KEYS],
  Director: [
    "crm_leads",
    "sales_quotes",
    "admin_dashboard",
    "support_desk",
    "project_delivery",
    "project_finance",
    "user_management",
    "technical_field",
    "inventory",
    "products",
    "reports",
    "settings",
  ],
  Admin: [
    "crm_leads",
    "sales_quotes",
    "admin_dashboard",
    "support_desk",
    "project_delivery",
    "technical_field",
    "inventory",
    "products",
    "customer_portal",
    "reports",
    "settings",
  ],
  "Accounts Manager": ["admin_dashboard", "project_finance", "crm_leads", "reports"],
  "Sales Manager": ["crm_leads", "sales_quotes", "admin_dashboard", "reports"],
  "Sales Executive": ["crm_leads", "sales_quotes"],
  "Survey Engineer": ["technical_field"],
  Technician: ["technical_field", "support_desk"],
  Customer: ["customer_portal"],
};

let dynamicRolePermissions: Record<string, PermissionKey[]> | null = null;

export function setDynamicRolePermissions(map: Record<string, PermissionKey[]> | null) {
  dynamicRolePermissions = map;
}

export function roleHasPermission(role: string, permission: PermissionKey): boolean {
  const dynamic = dynamicRolePermissions?.[role];
  if (dynamic) return dynamic.includes(permission);
  const perms = ROLE_PERMISSIONS[role as AppRole];
  if (perms) return perms.includes(permission);
  if (role === "Technical CEO") return roleHasPermission("Director", permission);
  if (role === "Sales Advisor") return roleHasPermission("Sales Executive", permission);
  if (role === "Service Technician" || role === "Installation Team") {
    return roleHasPermission("Technician", permission);
  }
  return false;
}

export function permissionsForRoleName(roleName: string): PermissionKey[] {
  if (dynamicRolePermissions?.[roleName]) return dynamicRolePermissions[roleName];
  const builtIn = ROLE_PERMISSIONS[roleName as AppRole];
  if (builtIn) return [...builtIn];
  return [];
}
