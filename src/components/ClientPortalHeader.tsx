import React from "react";
import { LogOut, MessageCircle, Phone } from "lucide-react";
import type { CompanyBranding } from "../lib/branding";
import { CUSTOMER_PORTAL_VERSION, portal, supportPhoneFromBranding, whatsAppHref } from "../lib/clientPortalUi";
import { withOfficialBranding } from "../lib/brandingAssets";
import AppLogo from "./AppLogo";

type ClientPortalHeaderProps = {
  branding: CompanyBranding;
  customerName: string;
  customerId: string;
  projectStatus: string;
  onLogout: () => void;
};

function statusBadgeClass(status: string): string {
  const s = status.toLowerCase();
  if (/complete|commission|handover|active/i.test(s)) {
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/25";
  }
  if (/install|progress|meter|payment/i.test(s)) {
    return "bg-amber-500/15 text-amber-300 border-amber-500/25";
  }
  return "bg-white/[0.06] text-slate-300 border-white/[0.08]";
}

export default function ClientPortalHeader({
  branding: rawBranding,
  customerName,
  customerId,
  projectStatus,
  onLogout,
}: ClientPortalHeaderProps) {
  const branding = withOfficialBranding(rawBranding);
  const phone = supportPhoneFromBranding(branding.phoneNumbers);
  const waLink = whatsAppHref(phone, `Hello Sunchaser, I need assistance. Customer: ${customerName}`);

  return (
    <header className={portal.header}>
      <div className={`${portal.main} py-4 space-y-4`}>
        <div className="flex items-start gap-3">
          <AppLogo logoUrl={branding.logoUrl} className="h-11 w-auto shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/90">
              Sunchaser Energy Systems
            </p>
            <h1 className="text-lg font-bold text-white truncate mt-0.5">{customerName}</h1>
            <p className="text-[11px] text-slate-500 font-mono mt-1 truncate">ID {customerId}</p>
            <p
              className="text-[9px] font-semibold text-amber-400/80 mt-1 tracking-wide"
              data-portal-version={CUSTOMER_PORTAL_VERSION}
            >
              {CUSTOMER_PORTAL_VERSION}
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="shrink-0 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.06] border border-white/[0.08] text-slate-400 hover:text-red-400 transition"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold ${statusBadgeClass(projectStatus)}`}
          >
            {projectStatus}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className={portal.btnSecondary + " !py-3 !text-xs justify-center"}
          >
            <MessageCircle className="h-4 w-4 text-emerald-400" />
            WhatsApp
          </a>
          <a
            href={`tel:${phone.replace(/\s/g, "")}`}
            className={portal.btnSecondary + " !py-3 !text-xs justify-center"}
          >
            <Phone className="h-4 w-4 text-amber-400" />
            Call
          </a>
        </div>
      </div>
    </header>
  );
}
