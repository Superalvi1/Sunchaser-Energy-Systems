import React from "react";
import {
  Activity,
  ChevronRight,
  Heart,
  History,
  Shield,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import { portal } from "../lib/clientPortalUi";
import type { AccountScreen } from "./ClientPortalAccount.types";

export type PortalServiceId = Exclude<AccountScreen, "menu">;

const PREMIUM_SERVICES: {
  id: PortalServiceId;
  title: string;
  subtitle: string;
  icon: React.ElementType;
  accent: string;
}[] = [
  { id: "warranty", title: "Warranty", subtitle: "Coverage & claims", icon: Shield, accent: "from-emerald-500/20 to-emerald-600/5" },
  { id: "service", title: "Service Requests", subtitle: "Book a visit", icon: Wrench, accent: "from-amber-500/20 to-amber-600/5" },
  { id: "history", title: "Service History", subtitle: "Past maintenance", icon: History, accent: "from-sky-500/20 to-sky-600/5" },
  { id: "energy", title: "Energy Monitor", subtitle: "Live production", icon: Activity, accent: "from-violet-500/20 to-violet-600/5" },
  { id: "savings", title: "Savings Calculator", subtitle: "ROI & performance", icon: Sparkles, accent: "from-amber-400/20 to-orange-500/5" },
  { id: "care", title: "Care Plans", subtitle: "Protection options", icon: Heart, accent: "from-rose-500/20 to-rose-600/5" },
  { id: "system", title: "My Solar System", subtitle: "Equipment details", icon: Zap, accent: "from-cyan-500/20 to-cyan-600/5" },
];

interface ClientPortalPremiumServicesProps {
  onOpen: (id: PortalServiceId) => void;
}

export default function ClientPortalPremiumServices({ onOpen }: ClientPortalPremiumServicesProps) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className={portal.titleSm}>Premium services</h2>
        <p className={portal.subtitle + " mt-1"}>Full portal modules — warranty, service, energy &amp; more</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PREMIUM_SERVICES.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpen(item.id)}
              className={`${portal.card} p-4 text-left w-full bg-gradient-to-br ${item.accent} hover:border-amber-500/20 transition active:scale-[0.99]`}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/[0.08]">
                  <Icon className="h-5 w-5 text-amber-400" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{item.subtitle}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-600 shrink-0 mt-1" />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
