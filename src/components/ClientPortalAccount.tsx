import React from "react";
import {
  BookOpen,
  ExternalLink,
  LogOut,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  ShieldCheck,
  User as UserIcon,
  UserMinus,
} from "lucide-react";
import { User } from "../types";
import type { ClientPortalPayload } from "../lib/clientPortalTracker";
import { displayOrNoData } from "../lib/clientPortalDisplay";
import { portal } from "../lib/clientPortalUi";
import {
  ACCOUNT_DELETION_URL,
  EXTERNAL_LINK_PROPS,
  PRIVACY_POLICY_URL,
} from "../lib/complianceLinks";
import type { AccountScreen } from "./ClientPortalAccount.types";
import ClientPortalPremiumServices from "./ClientPortalPremiumServices";
import type { PortalServiceId } from "./ClientPortalPremiumServices";

export type { AccountScreen } from "./ClientPortalAccount.types";

interface ClientPortalAccountProps {
  user: User;
  data: ClientPortalPayload | null;
  onNavigate: (screen: AccountScreen) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onShowWelcomeGuide?: () => void;
}

export default function ClientPortalAccount({
  user,
  data,
  onNavigate,
  onRefresh,
  onLogout,
  onShowWelcomeGuide,
}: ClientPortalAccountProps) {
  const customer = data?.customer;

  const openService = (id: PortalServiceId) => onNavigate(id);

  return (
    <div className="space-y-6 pb-4">
      <div>
        <p className={portal.label}>Account</p>
        <h2 className={portal.title}>{displayOrNoData(customer?.name || user.name)}</h2>
      </div>

      <section className={`${portal.card} ${portal.cardPad} space-y-5`}>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15">
            <UserIcon className="h-7 w-7 text-amber-400" />
          </span>
          <div>
            <p className="text-base font-semibold text-white">{displayOrNoData(customer?.name || user.name)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Sunchaser customer</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Mail className="h-4 w-4 text-slate-500 mt-1 shrink-0" />
            <div>
              <p className={portal.label}>Email</p>
              <p className="text-sm text-slate-200 mt-0.5 break-all">{displayOrNoData(customer?.email || user.email)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Phone className="h-4 w-4 text-slate-500 mt-1 shrink-0" />
            <div>
              <p className={portal.label}>Phone</p>
              <p className="text-sm text-slate-200 mt-0.5">{displayOrNoData(customer?.phone)}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <MapPin className="h-4 w-4 text-slate-500 mt-1 shrink-0" />
            <div>
              <p className={portal.label}>Address</p>
              <p className="text-sm text-slate-200 mt-0.5 leading-relaxed">{displayOrNoData(customer?.address)}</p>
            </div>
          </div>
          <div className={`${portal.cardMuted} px-4 py-3`}>
            <p className={portal.label}>Customer ID</p>
            <p className="text-sm font-mono text-slate-300 mt-1">{displayOrNoData(customer?.id)}</p>
          </div>
        </div>
      </section>

      <ClientPortalPremiumServices onOpen={openService} />

      {/*
        Account & Privacy — Google Play requires a readily discoverable in-app path
        to the privacy policy and to account deletion. Both open the public hosted
        pages in the system browser; neither performs a destructive action here.
      */}
      <section className="space-y-2">
        <p className={portal.label}>Account &amp; Privacy</p>
        <div className={`${portal.card} overflow-hidden`}>
          <a
            href={PRIVACY_POLICY_URL}
            {...EXTERNAL_LINK_PROPS}
            className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.03] border-b border-white/[0.06]"
          >
            <ShieldCheck className="h-5 w-5 text-slate-500 shrink-0" />
            <span className="flex-1 text-sm font-medium text-slate-200">Privacy Policy</span>
            <ExternalLink className="h-4 w-4 text-slate-600 shrink-0" aria-hidden="true" />
          </a>
          <a
            href={ACCOUNT_DELETION_URL}
            {...EXTERNAL_LINK_PROPS}
            className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.03]"
          >
            <UserMinus className="h-5 w-5 text-slate-500 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-slate-200">Request Account Deletion</span>
              <span className="block text-xs text-slate-500 mt-0.5">
                Opens instructions — nothing is deleted by tapping this
              </span>
            </span>
            <ExternalLink className="h-4 w-4 text-slate-600 shrink-0" aria-hidden="true" />
          </a>
        </div>
      </section>

      <div className={`${portal.card} overflow-hidden`}>
        {onShowWelcomeGuide && (
          <button
            type="button"
            onClick={onShowWelcomeGuide}
            className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.03] border-b border-white/[0.06]"
          >
            <BookOpen className="h-5 w-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-200">Welcome guide</span>
          </button>
        )}
        <button
          type="button"
          onClick={onRefresh}
          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.03] border-b border-white/[0.06]"
        >
          <RefreshCw className="h-5 w-5 text-slate-500" />
          <span className="text-sm font-medium text-slate-200">Refresh</span>
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-5 py-4 text-left text-red-400 hover:bg-red-500/5"
        >
          <LogOut className="h-5 w-5" />
          <span className="text-sm font-semibold">Sign out</span>
        </button>
      </div>
    </div>
  );
}
