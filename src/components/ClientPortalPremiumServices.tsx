import React from "react";
import {
  Activity,
  ChevronRight,
  FileText,
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

const SERVICES: {
  id: PortalServiceId | "documents";
  title: string;
  subtitle: string;
  icon: React.ElementType;
  iconWrapClass?: string;
  accent: string;
}[] = [
  { id: "warranty", title: "Warranty", subtitle: "Coverage & claims", icon: Shield, accent: "from-emerald-500/20 to-emerald-600/5" },
  { id: "service", title: "Service Requests", subtitle: "Book a visit", icon: Wrench, accent: "from-amber-500/20 to-amber-600/5" },
  { id: "history", title: "Service History", subtitle: "Past maintenance", icon: History, accent: "from-sky-500/20 to-sky-600/5" },
  { id: "energy", title: "Energy Monitor", subtitle: "Live production", icon: Activity, accent: "from-violet-500/20 to-violet-600/5" },
  { id: "savings", title: "Savings Calculator", subtitle: "ROI & performance", icon: Sparkles, accent: "from-amber-400/20 to-orange-500/5" },
  { id: "care", title: "Care Plans", subtitle: "Protection options", icon: Heart, accent: "from-rose-500/20 to-rose-600/5" },
  { id: "system", title: "My Solar System", subtitle: "Equipment details", icon: Zap, accent: "from-cyan-500/20 to-cyan-600/5" },
  {
    id: "documents",
    title: "Documents",
    subtitle: "Download files",
    icon: FileText,
    iconWrapClass: "bg-[rgba(55,138,221,0.15)]",
    accent: "from-blue-500/15 to-blue-600/5",
  },
];

interface ClientPortalPremiumServicesProps {
  onOpen: (id: PortalServiceId) => void;
  onOpenDocuments?: () => void;
  /** Show Documents as the 8th card (home screen only). */
  showDocuments?: boolean;
}

export default function ClientPortalPremiumServices({
  onOpen,
  onOpenDocuments,
  showDocuments = false,
}: ClientPortalPremiumServicesProps) {
  const items = showDocuments ? SERVICES : SERVICES.filter((s) => s.id !== "documents");

  return (
    <section className="space-y-3">
      <h2 className={portal.titleSm}>Services</h2>
      <div className="grid grid-cols-2 gap-3">
        {items.map((item) => {
          const Icon = item.icon;
          const handleClick = () => {
            if (item.id === "documents") {
              onOpenDocuments?.();
              return;
            }
            onOpen(item.id as PortalServiceId);
          };
          return (
            <button
              key={item.id}
              type="button"
              onClick={handleClick}
              className={`${portal.card} p-4 text-left w-full bg-gradient-to-br ${item.accent} hover:border-amber-500/20 transition active:scale-[0.99]`}
            >
              <div className="flex flex-col gap-3 h-full">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                    item.iconWrapClass || "bg-white/[0.08]"
                  }`}
                >
                  <Icon
                    className={`h-5 w-5 ${item.id === "documents" ? "text-blue-400" : "text-amber-400"}`}
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white leading-tight">{item.title}</p>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">{item.subtitle}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
