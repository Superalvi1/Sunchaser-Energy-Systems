import React, { useEffect, useState } from "react";
import {
  CreditCard,
  FileText,
  Headphones,
  Home,
  Loader2,
  Settings,
} from "lucide-react";
import { User as UserType } from "../types";
import type { ClientPortalPayload } from "../lib/clientPortalTracker";
import { DEFAULT_BRANDING, type CompanyBranding } from "../lib/branding";
import { withOfficialBranding } from "../lib/brandingAssets";
import { CUSTOMER_PORTAL_VERSION, portal } from "../lib/clientPortalUi";
import { fetchCompanyBranding } from "../services/api";
import { displayOrNoData } from "../lib/clientPortalDisplay";
import { projectStatusHeadline } from "../lib/clientPortalCompletion";
import ClientPortalHome from "./ClientPortalHome";
import ClientPortalHeader from "./ClientPortalHeader";
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
import type { PortalServiceId } from "./ClientPortalPremiumServices";

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
  { id: "documents", label: "Quotes", icon: FileText },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "support", label: "Support", icon: Headphones },
  { id: "account", label: "Account", icon: Settings },
];

const SERVICE_TITLES: Record<PortalServiceId, { title: string; subtitle?: string }> = {
  system: { title: "My solar system", subtitle: "Equipment installed at your site" },
  warranty: { title: "Warranty", subtitle: "Coverage, claims, and handover" },
  service: { title: "Service requests", subtitle: "Visits and technician support" },
  history: { title: "Service history", subtitle: "Past maintenance records" },
  savings: { title: "Solar savings", subtitle: "Performance and estimates" },
  energy: { title: "Energy monitor", subtitle: "Production insights" },
  care: { title: "Care plans", subtitle: "Protection options" },
};

function renderServiceModule(id: PortalServiceId, user: UserType) {
  switch (id) {
    case "system":
      return <ClientPortalSystem user={user} />;
    case "warranty":
      return <ClientPortalWarranties user={user} />;
    case "service":
      return <ClientPortalService user={user} />;
    case "history":
      return <ClientPortalServiceHistory user={user} />;
    case "savings":
      return <ClientPortalSavings user={user} />;
    case "energy":
      return <ClientPortalEnergyMonitor user={user} />;
    case "care":
      return <ClientPortalCare user={user} />;
    default:
      return null;
  }
}

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
  const [homeService, setHomeService] = useState<PortalServiceId | null>(null);
  const [branding, setBranding] = useState<CompanyBranding>(DEFAULT_BRANDING);

  useEffect(() => {
    fetchCompanyBranding()
      .then((b) => setBranding(withOfficialBranding(b)))
      .catch(() => setBranding(withOfficialBranding(DEFAULT_BRANDING)));
  }, []);

  const selectMainTab = (tab: MainTab) => {
    setMainTab(tab);
    setHomeService(null);
    if (tab === "account") setAccountScreen("menu");
  };

  const openService = (id: PortalServiceId) => {
    setMainTab("home");
    setHomeService(id);
  };

  const customerName = displayOrNoData(data?.customer?.name || user.name);
  const customerId = displayOrNoData(data?.customer?.id);
  const projectStatus = data?.dashboard?.projectStatus || projectStatusHeadline(data);

  const renderAccountSub = () => {
    const meta = accountScreen !== "menu" ? SERVICE_TITLES[accountScreen as PortalServiceId] : null;
    const back = () => setAccountScreen("menu");

    if (accountScreen !== "menu" && meta) {
      return (
        <PortalScreen title={meta.title} subtitle={meta.subtitle} onBack={back}>
          {renderServiceModule(accountScreen as PortalServiceId, user)}
        </PortalScreen>
      );
    }

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
  };

  const renderMain = () => {
    if (mainTab === "home") {
      if (homeService) {
        const meta = SERVICE_TITLES[homeService];
        return (
          <PortalScreen title={meta.title} subtitle={meta.subtitle} onBack={() => setHomeService(null)}>
            {renderServiceModule(homeService, user)}
          </PortalScreen>
        );
      }
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
          onOpenService={openService}
        />
      );
    }

    if (mainTab === "documents") {
      return (
        <PortalScreen title="Documents" subtitle="Quotations, agreements, warranties, and certificates">
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
        <PortalScreen title="Support" subtitle="Tickets, WhatsApp, and call support">
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
      <ClientPortalHeader
        branding={branding}
        customerName={customerName}
        customerId={customerId}
        projectStatus={projectStatus}
        onLogout={onLogout}
      />

      <main className={`${portal.main} ${portal.mainWithNav}`}>{renderMain()}</main>

      <p
        className="text-center text-[9px] text-slate-600 pb-1"
        data-portal-version={CUSTOMER_PORTAL_VERSION}
      >
        {CUSTOMER_PORTAL_VERSION}
      </p>

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
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.25 : 1.75} />
                <span className="text-[10px] font-medium truncate max-w-full">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
