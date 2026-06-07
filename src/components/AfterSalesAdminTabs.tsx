import React, { useState } from "react";
import { User } from "../types";
import SupportDeskStaff from "./SupportDeskStaff";
import ServiceDeskStaff from "./ServiceDeskStaff";
import CustomerSavingsStaff from "./CustomerSavingsStaff";
import SubscriptionDeskStaff from "./SubscriptionDeskStaff";
import AssetMaintenanceLogStaff from "./AssetMaintenanceLogStaff";
import ClientPortalStaffTools from "./ClientPortalStaffTools";
import AfterSalesStaffTools from "./AfterSalesStaffTools";
import { Lead } from "../types";

type AfterSalesTabId =
  | "support"
  | "service"
  | "savings"
  | "subscriptions"
  | "visits"
  | "documents"
  | "warranty"
  | "tools"
  | "maintenance";

const TABS: { id: AfterSalesTabId; label: string }[] = [
  { id: "support", label: "Support Tickets" },
  { id: "service", label: "Service Requests" },
  { id: "savings", label: "Savings" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "visits", label: "Visit Reports" },
  { id: "documents", label: "Document Upload" },
  { id: "warranty", label: "Warranty Records" },
  { id: "tools", label: "After-Sales Tools" },
  { id: "maintenance", label: "Asset & Maintenance Log" },
];

interface AfterSalesAdminTabsProps {
  staffUser: User;
  leads?: Lead[];
}

function renderActiveTab(
  activeTab: AfterSalesTabId,
  staffUser: User,
  leads: Lead[]
): React.ReactNode {
  switch (activeTab) {
    case "support":
      return <SupportDeskStaff staffUser={staffUser} leads={leads} />;
    case "service":
      return <ServiceDeskStaff staffUser={staffUser} leads={leads} />;
    case "savings":
      return <CustomerSavingsStaff staffUser={staffUser} />;
    case "subscriptions":
      return <SubscriptionDeskStaff staffUser={staffUser} section="full" />;
    case "visits":
      return <SubscriptionDeskStaff staffUser={staffUser} section="visit-report" />;
    case "documents":
      return <ClientPortalStaffTools staffUser={staffUser} section="documents" />;
    case "warranty":
      return <ClientPortalStaffTools staffUser={staffUser} section="warranty" />;
    case "tools":
      return <AfterSalesStaffTools staffUser={staffUser} />;
    case "maintenance":
      return <AssetMaintenanceLogStaff staffUser={staffUser} />;
    default:
      return null;
  }
}

export default function AfterSalesAdminTabs({ staffUser, leads = [] }: AfterSalesAdminTabsProps) {
  const [activeTab, setActiveTab] = useState<AfterSalesTabId>("support");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-bold text-slate-100 font-sans">After-Sales Administration</h2>
        <p className="text-[10px] text-slate-500 font-sans mt-0.5">
          Support, service, savings, subscriptions, and client portal tools.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 bg-slate-950 p-1.5 rounded-2xl border border-slate-850">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 rounded-xl font-sans font-bold text-[10px] transition cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-amber-500 text-slate-950"
                : "text-slate-400 hover:text-white hover:bg-slate-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div key={activeTab} className="min-h-[200px]">
        {renderActiveTab(activeTab, staffUser, leads)}
      </div>
    </div>
  );
}
