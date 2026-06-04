import React, { useEffect, useState } from "react";
import {
  Loader2,
  Activity,
  Sun,
  Home,
  Battery,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  TrendingUp,
  Banknote,
  AlertTriangle,
  Radio,
} from "lucide-react";
import { User } from "../types";
import { fetchCustomerEnergyMonitor } from "../services/api";
import type { EnergyMonitorPayload } from "../lib/energyMonitor/types";
import { formatKw, formatKwhEnergy, formatPkrEnergy } from "../lib/clientPortalEnergy";

interface ClientPortalEnergyMonitorProps {
  user: User;
}

function MetricTile({
  icon: Icon,
  label,
  value,
  accent = "amber",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent?: "amber" | "emerald" | "sky" | "violet";
}) {
  const colors = {
    amber: "text-amber-500",
    emerald: "text-emerald-500",
    sky: "text-sky-400",
    violet: "text-violet-400",
  };
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
      <Icon className={`w-4 h-4 mb-2 ${colors[accent]}`} />
      <p className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-extrabold text-white mt-1">{value}</p>
    </div>
  );
}

export default function ClientPortalEnergyMonitor({ user }: ClientPortalEnergyMonitorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<EnergyMonitorPayload | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchCustomerEnergyMonitor(user.id, user.username);
      setData(payload);
    } catch (err: any) {
      setError(err.message || "Failed to load energy monitor.");
      setData(null);
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
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-400">Syncing inverter data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-rose-950/30 border border-rose-900 rounded-2xl p-6 text-center text-rose-300 text-sm">
        {error}
        <button type="button" onClick={load} className="mt-3 block mx-auto text-xs font-bold text-amber-400 underline">
          Try again
        </button>
      </div>
    );
  }

  const r = data?.reading;
  const savings = data?.savings;
  const devices = data?.devices || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-emerald-400" />
          <h2 className="text-lg font-extrabold">Energy Monitor</h2>
        </div>
        {data?.liveData && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-950/50 text-emerald-400 border border-emerald-800 flex items-center gap-1">
            <Radio className="w-3 h-3 animate-pulse" /> Live
          </span>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Single Sunchaser portal for GoodWe, Solis, Growatt, and Itel Hybrid — no separate vendor app required.
      </p>

      {devices.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center text-slate-400 text-sm">
          No inverter linked yet. Your Sunchaser team will register your device for live monitoring.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {devices.map((d) => (
              <span
                key={d.id}
                className={`text-[10px] font-mono px-2 py-1 rounded-lg border ${
                  d.status === "Online"
                    ? "bg-emerald-950/40 border-emerald-800 text-emerald-300"
                    : "bg-slate-800 border-slate-700 text-slate-400"
                }`}
              >
                {d.brand} · {d.deviceSerial} · {d.status}
              </span>
            ))}
          </div>

          {r ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <MetricTile icon={Sun} label="Solar production" value={formatKw(r.solarPower)} accent="amber" />
              <MetricTile icon={Home} label="Home load" value={formatKw(r.loadPower)} accent="sky" />
              <MetricTile icon={Battery} label="Battery SOC" value={`${r.batterySOC}%`} accent="violet" />
              <MetricTile icon={ArrowDownLeft} label="Grid import" value={formatKw(r.gridImport)} />
              <MetricTile icon={ArrowUpRight} label="Grid export" value={formatKw(r.gridExport)} accent="emerald" />
              <MetricTile icon={Calendar} label="Today" value={formatKwhEnergy(r.todayGeneration)} />
              <MetricTile icon={TrendingUp} label="This month" value={formatKwhEnergy(r.monthGeneration)} />
              <MetricTile icon={TrendingUp} label="Lifetime" value={formatKwhEnergy(r.lifetimeGeneration)} />
            </div>
          ) : (
            <div className="bg-amber-950/20 border border-amber-900/50 rounded-2xl p-4 text-amber-200 text-sm">
              Inverter offline — last sync unavailable. Alerts may apply below.
            </div>
          )}

          {savings && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Banknote className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-bold text-white">Savings from live data</h3>
                {savings.fromLiveData && (
                  <span className="text-[9px] text-emerald-400 font-bold uppercase">Real inverter</span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 font-mono">
                Tariff: PKR {savings.unitRatePkr}/kWh (configurable)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-slate-500 text-[10px] uppercase">Daily</p>
                  <p className="font-extrabold text-amber-400">{formatPkrEnergy(savings.dailySavingsPkr)}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-[10px] uppercase">Monthly</p>
                  <p className="font-extrabold text-emerald-400">{formatPkrEnergy(savings.monthlySavingsPkr)}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-[10px] uppercase">Yearly</p>
                  <p className="font-extrabold text-sky-400">{formatPkrEnergy(savings.yearlySavingsPkr)}</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {(data?.alerts?.length || 0) > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> Alerts
          </h3>
          {data!.alerts.map((a) => (
            <div
              key={a.id}
              className="bg-rose-950/30 border border-rose-900/60 rounded-xl px-3 py-2 text-xs text-rose-200"
            >
              <span className="font-mono text-[9px] uppercase text-rose-400 mr-2">{a.alertType}</span>
              {a.message}
            </div>
          ))}
        </div>
      )}

      {data?.lastSync && (
        <p className="text-[10px] text-slate-600 font-mono text-center">
          Last sync: {new Date(data.lastSync).toLocaleString()}
          {data.primaryBrand ? ` · ${data.primaryBrand}` : ""}
        </p>
      )}
    </div>
  );
}
