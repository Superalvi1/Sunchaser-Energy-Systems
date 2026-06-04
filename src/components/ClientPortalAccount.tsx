import React, { useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Heart,
  History,
  LogOut,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Shield,
  Sparkles,
  User as UserIcon,
  Wrench,
  Zap,
  BookOpen,
} from "lucide-react";
import { User } from "../types";
import type { ClientPortalPayload } from "../lib/clientPortalTracker";
import { displayOrNoData } from "../lib/clientPortalDisplay";
import { portal } from "../lib/clientPortalUi";
import type { AccountScreen } from "./ClientPortalAccount.types";

export type { AccountScreen } from "./ClientPortalAccount.types";

interface ClientPortalAccountProps {
  user: User;
  data: ClientPortalPayload | null;
  onNavigate: (screen: AccountScreen) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onShowWelcomeGuide?: () => void;
}

const MORE_SERVICES: { id: AccountScreen; title: string; icon: React.ElementType }[] = [
  { id: "system", title: "My solar system", icon: Zap },
  { id: "warranty", title: "Warranty", icon: Shield },
  { id: "service", title: "Service visits", icon: Wrench },
  { id: "history", title: "Service history", icon: History },
  { id: "savings", title: "Solar savings", icon: Sparkles },
  { id: "energy", title: "Energy monitor", icon: Activity },
  { id: "care", title: "Care plans", icon: Heart },
];

export default function ClientPortalAccount({
  user,
  data,
  onNavigate,
  onRefresh,
  onLogout,
  onShowWelcomeGuide,
}: ClientPortalAccountProps) {
  const [showMore, setShowMore] = useState(false);
  const customer = data?.customer;

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

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className={`${portal.card} ${portal.cardPad} w-full flex items-center justify-between`}
      >
        <span className="text-sm font-semibold text-slate-200">All portal modules</span>
        <ChevronDown className={`h-5 w-5 text-slate-500 transition ${showMore ? "rotate-180" : ""}`} />
      </button>

      {showMore && (
        <div className="space-y-2 -mt-2">
          {MORE_SERVICES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={`${portal.card} ${portal.cardPad} w-full flex items-center gap-3 text-left`}
              >
                <Icon className="h-5 w-5 text-amber-400 shrink-0" />
                <span className="flex-1 text-sm font-medium text-slate-200">{item.title}</span>
                <ChevronRight className="h-4 w-4 text-slate-600" />
              </button>
            );
          })}
        </div>
      )}

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
