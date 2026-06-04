import React from "react";
import { Activity } from "lucide-react";
import { portal } from "../lib/clientPortalUi";
import type { HealthMetric } from "../lib/clientPortalHealth";
import { healthScorePercent } from "../lib/clientPortalHealth";

const dotClass: Record<HealthMetric["status"], string> = {
  good: "bg-emerald-400",
  warn: "bg-amber-400",
  pending: "bg-slate-500",
  neutral: "bg-slate-600",
};

interface ClientPortalHealthScoreProps {
  metrics: HealthMetric[];
}

export default function ClientPortalHealthScore({ metrics }: ClientPortalHealthScoreProps) {
  const score = healthScorePercent(metrics);

  return (
    <section className={`${portal.card} ${portal.cardPad}`}>
      <div className="flex items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-amber-400" />
          <h2 className={portal.titleSm}>Customer health score</h2>
        </div>
        <div className="text-right">
          <p className={`${portal.heroMetric} !text-2xl text-amber-400`}>{score}</p>
          <p className="text-[10px] text-slate-500 uppercase">/ 100</p>
        </div>
      </div>
      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden mb-5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all"
          style={{ width: `${score}%` }}
        />
      </div>
      <ul className="space-y-3">
        {metrics.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass[m.status]}`} />
              <span className="text-xs text-slate-500">{m.label}</span>
            </div>
            <span className="text-sm font-medium text-slate-200 truncate text-right">{m.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
