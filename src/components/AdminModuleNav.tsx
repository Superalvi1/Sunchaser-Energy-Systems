import React, { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Award,
  BarChart4,
  BookOpen,
  ClipboardList,
  DollarSign,
  FileText,
  FolderOpen,
  Headphones,
  History,
  LayoutGrid,
  Package,
  PieChart,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  Truck,
  UserCog,
  UserPlus,
  Users,
  Wrench,
  Zap,
} from "lucide-react";

export type AdminSegmentId =
  | "overview"
  | "reports"
  | "sales"
  | "pdf-templates"
  | "invoices"
  | "parties"
  | "finance-dashboard"
  | "project-finance"
  | "project-delivery"
  | "project-operations"
  | "asset-maintenance"
  | "service-desk"
  | "tickets"
  | "support-desk"
  | "inventory"
  | "products"
  | "client-portal"
  | "user-management"
  | "branding"
  | "control-panel"
  | "savings-desk"
  | "subscription-desk"
  | "energy-monitoring";

export type AdminQuickAction = "lead" | "quotation" | "invoice" | "customer";

type ModuleDef = {
  id: AdminSegmentId;
  title: string;
  description: string;
  icon: LucideIcon;
  visible?: boolean;
  settingsSubTab?: "settings";
};

type NavGroup = {
  id: string;
  label: string;
  modules: ModuleDef[];
};

type AdminModuleNavProps = {
  activeSegment: AdminSegmentId;
  pdfSubTab?: "pages" | "banks" | "terms" | "ceo" | "structures" | "settings";
  onSelect: (id: AdminSegmentId, options?: { settingsSubTab?: "settings" }) => void;
  showFinanceAdmin: boolean;
  showFinanceDashboard: boolean;
  showProjectOperations: boolean;
  showInvoices: boolean;
  showBranding: boolean;
  showUserManagement: boolean;
  onQuickAction?: (action: AdminQuickAction) => void;
};

const QUICK_ACTIONS: { id: AdminQuickAction; label: string; icon: LucideIcon }[] = [
  { id: "lead", label: "New Lead", icon: UserPlus },
  { id: "quotation", label: "New Quotation", icon: ClipboardList },
  { id: "invoice", label: "New Invoice", icon: FileText },
  { id: "customer", label: "New Customer", icon: Users },
];

function ModuleCard({
  mod,
  active,
  onClick,
}: {
  mod: ModuleDef;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = mod.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex h-full min-h-[88px] w-full flex-col rounded-xl border p-3 text-left transition ${
        active
          ? "border-amber-500/50 bg-amber-500/10 shadow-[0_0_0_1px_rgba(245,158,11,0.25)]"
          : "border-neutral-800 bg-neutral-900/80 hover:border-neutral-600 hover:bg-neutral-800/80"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            active ? "bg-amber-500/20 text-amber-400" : "bg-neutral-800 text-neutral-400 group-hover:text-amber-400"
          }`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className={`text-xs font-bold leading-tight ${active ? "text-amber-100" : "text-neutral-100"}`}>
            {mod.title}
          </div>
          <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-neutral-500">{mod.description}</div>
        </div>
      </div>
    </button>
  );
}

function SidebarItem({
  mod,
  active,
  onClick,
}: {
  mod: ModuleDef;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = mod.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${
        active ? "bg-amber-500/15 text-amber-100" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? "text-amber-400" : ""}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold leading-tight">{mod.title}</span>
        <span className="block text-[10px] leading-snug text-neutral-500 line-clamp-1">{mod.description}</span>
      </span>
    </button>
  );
}

export function buildAdminNavGroups(opts: {
  showFinanceAdmin: boolean;
  showFinanceDashboard: boolean;
  showProjectOperations: boolean;
  showInvoices: boolean;
  showBranding: boolean;
  showUserManagement: boolean;
}): NavGroup[] {
  const { showFinanceAdmin, showFinanceDashboard, showProjectOperations, showInvoices, showBranding, showUserManagement } = opts;

  return [
    {
      id: "business",
      label: "Business",
      modules: [
        {
          id: "overview",
          title: "Business Analytics",
          description: "Revenue, pipeline, and lead KPIs",
          icon: BarChart4,
        },
        {
          id: "sales",
          title: "Sales Performance",
          description: "Rep rankings and closed deals",
          icon: Award,
        },
        {
          id: "reports",
          title: "Reports",
          description: "Charts, exports, and summaries",
          icon: PieChart,
        },
      ],
    },
    {
      id: "sales-finance",
      label: "Sales & Finance",
      modules: [
        {
          id: "pdf-templates",
          title: "Quotations",
          description: "Templates, banks, terms, PDF setup",
          icon: ClipboardList,
        },
        ...(showInvoices
          ? [
              {
                id: "invoices" as const,
                title: "Invoices",
                description: "Vyapar-style sales and billing",
                icon: FileText,
              },
              {
                id: "parties" as const,
                title: "Parties / Ledgers",
                description: "Customer balances and history",
                icon: BookOpen,
              },
              ...(showFinanceDashboard
                ? [
                    {
                      id: "finance-dashboard" as const,
                      title: "Finance Dashboard",
                      description: "AR aging, collections & KPIs",
                      icon: DollarSign,
                    },
                  ]
                : []),
            ]
          : []),
        ...(showFinanceAdmin
          ? [
              {
                id: "project-finance" as const,
                title: "Project Finance",
                description: "Margins, payments, project P&L",
                icon: DollarSign,
              },
            ]
          : []),
      ],
    },
    {
      id: "operations",
      label: "Operations",
      modules: [
        {
          id: "project-delivery",
          title: "Project Delivery",
          description: "Install stages and handover",
          icon: Truck,
        },
        ...(showProjectOperations
          ? [
              {
                id: "project-operations" as const,
                title: "Project Operations",
                description: "Pipeline, delays, and team KPIs",
                icon: Activity,
              },
            ]
          : []),
        {
          id: "asset-maintenance",
          title: "Asset & Maintenance",
          description: "Asset logs and service history",
          icon: History,
        },
        {
          id: "service-desk",
          title: "Service Desk",
          description: "Field service and work orders",
          icon: Wrench,
        },
        {
          id: "tickets",
          title: "Support Tickets",
          description: "Open inquiries and resolutions",
          icon: ShieldAlert,
        },
        {
          id: "energy-monitoring",
          title: "Energy Monitoring",
          description: "Production and system telemetry",
          icon: Activity,
        },
      ],
    },
    {
      id: "inventory",
      label: "Inventory",
      modules: [
        {
          id: "inventory",
          title: "Hardware Inventory",
          description: "Stock levels and procurement",
          icon: Package,
        },
        {
          id: "products",
          title: "Products",
          description: "Catalog SKUs and pricing",
          icon: LayoutGrid,
        },
      ],
    },
    {
      id: "customer",
      label: "Customer",
      modules: [
        {
          id: "client-portal",
          title: "Client Portal Tools",
          description: "Portal users and after-sales",
          icon: FolderOpen,
        },
        {
          id: "support-desk",
          title: "Support Desk",
          description: "Customer support workflows",
          icon: Headphones,
        },
        {
          id: "savings-desk",
          title: "Savings Desk",
          description: "Savings programs and claims",
          icon: Zap,
        },
        {
          id: "subscription-desk",
          title: "Subscription Desk",
          description: "Plans and renewals",
          icon: Users,
        },
      ],
    },
    {
      id: "admin",
      label: "Admin",
      modules: [
        ...(showUserManagement
          ? [
              {
                id: "user-management" as const,
                title: "Users & Approvals",
                description: "Roles, access, and approvals",
                icon: UserCog,
              },
            ]
          : []),
        ...(showBranding
          ? [
              {
                id: "branding" as const,
                title: "Branding",
                description: "Logo, colors, company profile",
                icon: Settings2,
              },
            ]
          : []),
        {
          id: "control-panel",
          title: "Manual Control Panel",
          description: "Direct database and content edits",
          icon: Settings2,
        },
        {
          id: "pdf-templates",
          title: "Settings",
          description: "Quotation PDF and system settings",
          icon: Settings2,
          settingsSubTab: "settings",
        },
      ],
    },
  ];
}

function isModuleActive(
  mod: ModuleDef,
  activeSegment: AdminSegmentId,
  pdfSubTab?: string
) {
  if (mod.settingsSubTab === "settings") {
    return activeSegment === "pdf-templates" && pdfSubTab === "settings";
  }
  if (mod.id === "pdf-templates" && mod.title === "Quotations") {
    return activeSegment === "pdf-templates" && pdfSubTab !== "settings";
  }
  return activeSegment === mod.id;
}

export default function AdminModuleNav({
  activeSegment,
  pdfSubTab = "pages",
  onSelect,
  showFinanceAdmin,
  showFinanceDashboard,
  showProjectOperations,
  showInvoices,
  showBranding,
  showUserManagement,
  onQuickAction,
}: AdminModuleNavProps) {
  const [query, setQuery] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = useMemo(
    () =>
      buildAdminNavGroups({
        showFinanceAdmin,
        showFinanceDashboard,
        showProjectOperations,
        showInvoices,
        showBranding,
        showUserManagement,
      }),
    [showFinanceAdmin, showFinanceDashboard, showProjectOperations, showInvoices, showBranding, showUserManagement]
  );

  const q = query.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        modules: g.modules.filter(
          (m) =>
            m.visible !== false &&
            (m.title.toLowerCase().includes(q) ||
              m.description.toLowerCase().includes(q) ||
              g.label.toLowerCase().includes(q))
        ),
      }))
      .filter((g) => g.modules.length > 0);
  }, [groups, q]);

  const handleQuick = (action: AdminQuickAction) => {
    if (action === "quotation") onSelect("pdf-templates");
    else if (action === "invoice" && showInvoices) onSelect("invoices");
    else onQuickAction?.(action);
  };

  const navBody = (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search module…"
          className="w-full rounded-lg border border-neutral-800 bg-neutral-950 py-2 pl-8 pr-3 text-xs text-neutral-100 placeholder:text-neutral-600 focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
        />
      </div>

      <div>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-neutral-500">Quick actions</div>
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            const disabled = a.id === "invoice" && !showInvoices;
            return (
              <button
                key={a.id}
                type="button"
                disabled={disabled}
                onClick={() => handleQuick(a.id)}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-left text-[10px] font-semibold text-neutral-300 transition hover:border-amber-500/30 hover:bg-neutral-800 disabled:opacity-40"
              >
                <Plus className="h-3 w-3 shrink-0 text-amber-400" />
                <Icon className="h-3 w-3 shrink-0 opacity-70" />
                <span className="truncate">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filteredGroups.map((group) => (
        <div key={group.id}>
          <div className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            {group.label}
          </div>
          <div className="space-y-0.5">
            {group.modules.map((mod) => {
              const isSettings = mod.settingsSubTab === "settings";
              const active = isModuleActive(mod, activeSegment, pdfSubTab);
              return (
                <SidebarItem
                  key={`${group.id}-${mod.id}-${mod.title}`}
                  mod={mod}
                  active={active}
                  onClick={() => {
                    onSelect(mod.id, isSettings ? { settingsSubTab: "settings" } : undefined);
                    setMobileOpen(false);
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Mobile / tablet: module picker bar */}
      <div className="lg:hidden space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search module…"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 py-2 pl-8 pr-3 text-xs text-neutral-100"
            />
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            className="shrink-0 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs font-bold text-neutral-200"
          >
            Modules
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {QUICK_ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <button
                key={a.id}
                type="button"
                disabled={a.id === "invoice" && !showInvoices}
                onClick={() => handleQuick(a.id)}
                className="flex items-center justify-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-2 text-[10px] font-semibold text-neutral-300"
              >
                <Plus className="h-3 w-3 text-amber-400" />
                {a.label}
              </button>
            );
          })}
        </div>
        {mobileOpen && (
          <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3">
            {navBody}
          </div>
        )}
        {!q && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {groups.flatMap((g) =>
              g.modules.map((mod) => (
                <ModuleCard
                  key={`${g.id}-${mod.id}-${mod.title}`}
                  mod={mod}
                  active={isModuleActive(mod, activeSegment, pdfSubTab)}
                  onClick={() =>
                    onSelect(mod.id, mod.settingsSubTab === "settings" ? { settingsSubTab: "settings" } : undefined)
                  }
                />
              ))
            )}
          </div>
        )}
        {q && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {filteredGroups.flatMap((g) =>
              g.modules.map((mod) => (
                <ModuleCard
                  key={`${g.id}-${mod.id}-${mod.title}`}
                  mod={mod}
                  active={isModuleActive(mod, activeSegment, pdfSubTab)}
                  onClick={() =>
                    onSelect(mod.id, mod.settingsSubTab === "settings" ? { settingsSubTab: "settings" } : undefined)
                  }
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Desktop: left sidebar */}
      <aside className="hidden lg:block w-64 shrink-0">
        <div className="sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950/90 p-3">
          {navBody}
        </div>
      </aside>
    </>
  );
}
