import React, { useEffect, useState } from "react";
import {
  Loader2,
  Zap,
  Calendar,
  TrendingUp,
  Banknote,
  Leaf,
  Trees,
  Activity,
} from "lucide-react";
import { User } from "../types";
import { fetchCustomerSavings } from "../services/api";
import type { SavingsDashboardPayload } from "../lib/clientPortalSavings";
import { displayKw } from "../lib/clientPortalDisplay";

interface ClientPortalSavingsProps {
  user: User;
}

function EstimatedBadge() {
  return (
    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-950 text-amber-400 border border-amber-800/50">
      Estimated
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  metric,
  accent = "amber",
}: {
  icon: React.ElementType;
  label: string;
  metric: { display: string; estimated: boolean };
  accent?: "amber" | "emerald" | "sky" | "rose";
}) {
  const accentMap = {
    amber: "text-amber-500",
    emerald: "text-emerald-500",
    sky: "text-sky-400",
    rose: "text-rose-400",
  };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Icon className={`w-4 h-4 shrink-0 ${accentMap[accent]}`} />
        {metric.estimated && <EstimatedBadge />}
      </div>
      <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-extrabold text-white leading-tight">{metric.display}</p>
    </div>
  );
}

function performanceStyle(status: string) {
  switch (status) {
    case "Excellent":
      return "bg-emerald-950/40 border-emerald-800 text-emerald-300";
    case "Low Generation":
      return "bg-orange-950/40 border-orange-800 text-orange-300";
    case "Needs Attention":
      return "bg-rose-950/40 border-rose-800 text-rose-300";
    default:
      return "bg-slate-800 border-slate-700 text-slate-300";
  }
}

export default function ClientPortalSavings({ user }: ClientPortalSavingsProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<SavingsDashboardPayload | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCustomerSavings(user.id, user.username);
      setDashboard(data.dashboard);
    } catch (err: any) {
      setError(err.message || "Unable to load savings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user.id, user.username]);

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin mx-auto" />
        <p className="text-sm text-slate-500 mt-3">Loading solar savings…</p>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="bg-rose-950/30 border border-rose-900 rounded-2xl p-6 text-center text-sm text-rose-300">
        {error || "Savings unavailable."}
        <button type="button" onClick={load} className="mt-3 block mx-auto text-xs text-amber-400 font-bold underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          Solar Savings
        </h3>
        <p className="text-[10px] text-slate-500 font-mono">{displayKw(dashboard.systemSizeKw)} system</p>
      </div>

      <div
        className={`rounded-2xl border p-4 flex items-center gap-3 ${performanceStyle(dashboard.performanceStatus)}`}
      >
        <Activity className="w-5 h-5 shrink-0" />
        <div>
          <p className="text-[10px] font-mono uppercase opacity-80">System performance</p>
          <p className="text-sm font-bold">{dashboard.performanceStatus}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MetricCard icon={Zap} label="Today's generation" metric={dashboard.todayGeneration} />
        <MetricCard icon={Calendar} label="This month" metric={dashboard.monthGeneration} accent="sky" />
        <MetricCard icon={TrendingUp} label="Lifetime generation" metric={dashboard.lifetimeGeneration} accent="emerald" />
        <MetricCard
          icon={Banknote}
          label="Savings this month"
          metric={dashboard.savingsThisMonth}
          accent="amber"
        />
        <MetricCard icon={Banknote} label="Lifetime savings" metric={dashboard.lifetimeSavings} accent="emerald" />
        <MetricCard icon={Leaf} label="CO₂ saved" metric={dashboard.co2SavedKg} accent="emerald" />
      </div>

      <div className="bg-gradient-to-br from-emerald-950/50 to-slate-900 border border-emerald-900/40 rounded-2xl p-4 flex items-center gap-3">
        <Trees className="w-8 h-8 text-emerald-500 shrink-0" />
        <div>
          <p className="text-[10px] font-mono text-slate-500 uppercase">Trees equivalent</p>
          <p className="text-xl font-extrabold text-white">{dashboard.treesEquivalent}</p>
          <p className="text-[10px] text-slate-500">Based on lifetime CO₂ offset estimate</p>
        </div>
      </div>

      <p className="text-[10px] text-slate-600 text-center font-mono">
        Rate: PKR {dashboard.unitRate}/kWh · No live inverter feed — estimates use system size when needed
      </p>
    </section>
  );
}
