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
  | "tools";

const TABS: { id: AfterSalesTabId; label: string }[] = [
  { id: "support", label: "Support Tickets" },
  { id: "service", label: "Service Requests" },
  { id: "savings", label: "Savings" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "visits", label: "Visit Reports" },
  { id: "documents", label: "Document Upload" },
  { id: "warranty", label: "Warranty" },
  { id: "tools", label: "After-Sales Tools" },
];

interface AfterSalesAdminTabsProps {
  staffUser: User;
  leads?: Lead[];
}

export default function AfterSalesAdminTabs({ staffUser, leads = [] }: AfterSalesAdminTabsProps) {
  const [activeTab, setActiveTab] = useState<AfterSalesTabId>("support");

  return (
    <div className="mt-12 pt-8 border-t border-slate-800 space-y-6">
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

      <div className="min-h-[200px]">
        {activeTab === "support" && <SupportDeskStaff staffUser={staffUser} leads={leads} />}
        {activeTab === "service" && <ServiceDeskStaff staffUser={staffUser} leads={leads} />}
        {activeTab === "savings" && <CustomerSavingsStaff staffUser={staffUser} />}
        {activeTab === "subscriptions" && <SubscriptionDeskStaff staffUser={staffUser} />}
        {activeTab === "visits" && <AssetMaintenanceLogStaff staffUser={staffUser} />}
        {activeTab === "documents" && (
          <ClientPortalStaffTools staffUser={staffUser} section="documents" />
        )}
        {activeTab === "warranty" && (
          <ClientPortalStaffTools staffUser={staffUser} section="warranty" />
        )}
        {activeTab === "tools" && <AfterSalesStaffTools staffUser={staffUser} />}
      </div>
    </div>
  );
}
