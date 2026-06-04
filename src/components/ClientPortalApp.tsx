import React, { useEffect, useState } from "react";
import {
  FolderOpen,
  Headphones,
  Home,
  Loader2,
  User,
  Wallet,
} from "lucide-react";
import { User as UserType } from "../types";
import type { ClientPortalPayload } from "../lib/clientPortalTracker";
import { DEFAULT_BRANDING, type CompanyBranding } from "../lib/branding";
import { CUSTOMER_PORTAL_VERSION, portal } from "../lib/clientPortalUi";
import { fetchCompanyBranding } from "../services/api";
import ClientPortalHome from "./ClientPortalHome";
import ClientPortalDocuments from "./ClientPortalDocuments";
import ClientPortalSupport from "./ClientPortalSupport";
import ClientPortalPayments from "./ClientPortalPayments";
import ClientPortalInvoices from "./ClientPortalInvoices";
import ClientPortalAccount, { type AccountScreen } from "./ClientPortalAccount";
import ClientPortalSystem from "./ClientPortalSystem";
import ClientPortalWarranties from "./ClientPortalWarranties";
import ClientPortalService from "./ClientPortalService";
import ClientPortalServiceHistory from "./ClientPortalServiceHistory";
import ClientPortalSavings from "./ClientPortalSavings";
import ClientPortalEnergyMonitor from "./ClientPortalEnergyMonitor";
import ClientPortalCare from "./ClientPortalCare";
import PortalScreen from "./PortalScreen";
import AppLogo from "./AppLogo";

interface ClientPortalAppProps {
  user: UserType;
  data: ClientPortalPayload | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onLogout: () => void;
  onShowWelcomeGuide?: () => void;
}

type MainTab = "home" | "documents" | "payments" | "support" | "account";

const MAIN_TABS: { id: MainTab; label: string; icon: React.ElementType }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "payments", label: "Payments", icon: Wallet },
  { id: "support", label: "Support", icon: Headphones },
  { id: "account", label: "Account", icon: User },
];

const ACCOUNT_TITLES: Record<Exclude<AccountScreen, "menu">, { title: string; subtitle?: string }> = {
  system: { title: "My solar system", subtitle: "Equipment installed at your site" },
  warranty: { title: "Warranty", subtitle: "Coverage and handover" },
  service: { title: "Service", subtitle: "Visits and technician support" },
  history: { title: "Service history", subtitle: "Past maintenance records" },
  savings: { title: "Solar savings", subtitle: "Performance and estimates" },
  energy: { title: "Energy monitor", subtitle: "Production insights" },
  care: { title: "Care plans", subtitle: "Protection options" },
};

export default function ClientPortalApp({
  user,
  data,
  loading,
  error,
  onRefresh,
  onLogout,
  onShowWelcomeGuide,
}: ClientPortalAppProps) {
  const [mainTab, setMainTab] = useState<MainTab>("home");
  const [accountScreen, setAccountScreen] = useState<AccountScreen>("menu");
  const [branding, setBranding] = useState<CompanyBranding>(DEFAULT_BRANDING);

  useEffect(() => {
    fetchCompanyBranding()
      .then((b) => setBranding({ ...DEFAULT_BRANDING, ...b }))
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, []);

  const selectMainTab = (tab: MainTab) => {
    setMainTab(tab);
    if (tab === "account") setAccountScreen("menu");
  };

  const renderAccountSub = () => {
    const meta = accountScreen !== "menu" ? ACCOUNT_TITLES[accountScreen] : null;
    const back = () => setAccountScreen("menu");

    const wrap = (child: React.ReactNode) => (
      <PortalScreen title={meta!.title} subtitle={meta?.subtitle} onBack={back}>
        {child}
      </PortalScreen>
    );

    switch (accountScreen) {
      case "system":
        return wrap(<ClientPortalSystem user={user} />);
      case "warranty":
        return wrap(<ClientPortalWarranties user={user} />);
      case "service":
        return wrap(<ClientPortalService user={user} />);
      case "history":
        return wrap(<ClientPortalServiceHistory user={user} />);
      case "savings":
        return wrap(<ClientPortalSavings user={user} />);
      case "energy":
        return wrap(<ClientPortalEnergyMonitor user={user} />);
      case "care":
        return wrap(<ClientPortalCare user={user} />);
      default:
        return (
          <ClientPortalAccount
            user={user}
            data={data}
            onNavigate={setAccountScreen}
            onRefresh={onRefresh}
            onLogout={onLogout}
            onShowWelcomeGuide={onShowWelcomeGuide}
          />
        );
    }
  };

  const renderMain = () => {
    if (mainTab === "home") {
      if (loading && !data) {
        return (
          <div className="py-24 text-center">
            <Loader2 className="h-10 w-10 text-amber-400 animate-spin mx-auto" />
            <p className="text-sm text-slate-500 mt-4">Loading your project…</p>
          </div>
        );
      }
      if (error) {
        return (
          <div className={`${portal.card} ${portal.cardPad} text-center`}>
            <p className="text-sm text-red-400">{error}</p>
            <button type="button" onClick={onRefresh} className={`${portal.btnPrimary} mt-4`}>
              Try again
            </button>
          </div>
        );
      }
      return (
        <ClientPortalHome
          user={user}
          data={data}
          branding={branding}
          onOpenDocuments={() => selectMainTab("documents")}
          onOpenPayments={() => selectMainTab("payments")}
          onOpenSupport={() => selectMainTab("support")}
        />
      );
    }

    if (mainTab === "documents") {
      return (
        <PortalScreen title="Documents" subtitle="Quotations, agreements, and certificates">
          <ClientPortalDocuments user={user} />
        </PortalScreen>
      );
    }

    if (mainTab === "payments") {
      return (
        <PortalScreen title="Payments" subtitle="Milestones, receipts, and invoices">
          <div className="space-y-8">
            <ClientPortalPayments user={user} />
            <div className={portal.divider + " pt-6"}>
              <p className={portal.titleSm + " mb-4"}>Invoices</p>
              <ClientPortalInvoices user={user} />
            </div>
          </div>
        </PortalScreen>
      );
    }

    if (mainTab === "support") {
      return (
        <PortalScreen title="Support" subtitle="We're here to help">
          <ClientPortalSupport user={user} branding={branding} />
        </PortalScreen>
      );
    }

    if (mainTab === "account") {
      return renderAccountSub();
    }

    return null;
  };

  return (
    <div className={portal.shell}>
      <header className={portal.header}>
        <div className={`${portal.main} py-4 flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-3 min-w-0">
            <AppLogo logoUrl={branding.logoUrl} className="h-9 w-auto shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-500">Sunchaser Energy</p>
              <p className="text-sm font-semibold text-white truncate">
                {data?.customer?.name || user.name}
              </p>
              <p
                className="text-[10px] font-semibold text-amber-400/90 mt-0.5 tracking-wide"
                data-portal-version={CUSTOMER_PORTAL_VERSION}
              >
                {CUSTOMER_PORTAL_VERSION}
              </p>
            </div>
          </div>
          {mainTab !== "home" && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80 shrink-0">
              {MAIN_TABS.find((t) => t.id === mainTab)?.label}
            </span>
          )}
        </div>
      </header>

      <main className={`${portal.main} ${portal.mainWithNav}`}>{renderMain()}</main>

      <nav className={portal.nav} aria-label="Main navigation">
        <div className={portal.navInner}>
          {MAIN_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = mainTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectMainTab(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`${portal.navBtn} ${active ? portal.navBtnActive : portal.navBtnIdle}`}
              >
                <Icon className={`h-6 w-6 ${active ? "stroke-[2.5px]" : ""}`} strokeWidth={active ? 2.5 : 2} />
                <span className="text-[10px] font-semibold truncate max-w-full">{tab.label}</span>
                {active && <span className="h-1 w-1 rounded-full bg-amber-400 mt-0.5" />}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
