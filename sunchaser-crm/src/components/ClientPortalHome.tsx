import React from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  Zap,
  FileText,
  Wrench,
  Gauge,
  Shield,
  Headphones,
  Calendar,
} from "lucide-react";
import type { ClientPortalPayload } from "../lib/clientPortalTracker";

function StatusBadge({ status }: { status: "completed" | "active" | "pending" }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-950/50 border border-emerald-900/50 px-2 py-0.5 rounded-lg">
        <CheckCircle2 className="w-3 h-3" /> Done
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-amber-400 bg-amber-950/40 border border-amber-800/50 px-2 py-0.5 rounded-lg">
        <Clock className="w-3 h-3" /> Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-lg">
      <Circle className="w-3 h-3" /> Pending
    </span>
  );
}

function DashboardCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center gap-2 text-amber-500">
        <Icon className="w-4 h-4" />
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">{label}</span>
      </div>
      <p className="text-sm font-semibold text-slate-100 leading-snug">{value}</p>
    </div>
  );
}

interface ClientPortalHomeProps {
  displayName: string;
  data: ClientPortalPayload | null;
}

export default function ClientPortalHome({ displayName, data }: ClientPortalHomeProps) {
  const dashboard = data?.dashboard;
  const tracker = data?.tracker;

  return (
    <>
      <section className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-5 shadow-lg">
        <p className="text-[10px] font-mono uppercase tracking-widest text-amber-500 mb-1">Welcome</p>
        <h2 className="text-xl font-extrabold text-white mb-1">{displayName}</h2>
        <p className="text-xs text-slate-400">
          Track your solar journey from survey through installation and net metering.
        </p>
      </section>

      <section>
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">
          Project overview
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <DashboardCard
            icon={Zap}
            label="System size"
            value={
              dashboard?.systemSizeKw != null ? `${dashboard.systemSizeKw} kW` : "Not available yet"
            }
          />
          <DashboardCard icon={Gauge} label="Project status" value={dashboard?.projectStatus || "Pending"} />
          <DashboardCard icon={FileText} label="Quotation" value={dashboard?.quotationStatus || "Pending"} />
          <DashboardCard
            icon={Wrench}
            label="Installation"
            value={dashboard?.installationStatus || "Not available yet"}
          />
          <DashboardCard icon={Shield} label="Net metering" value={dashboard?.netMeteringStatus || "Pending"} />
          <DashboardCard icon={Shield} label="Warranty" value={dashboard?.warrantySummary || "Pending"} />
          <DashboardCard
            icon={Headphones}
            label="Open tickets"
            value={String(dashboard?.openTicketsCount ?? 0)}
          />
          <DashboardCard icon={Calendar} label="Next service" value={dashboard?.nextServiceDue || "Pending"} />
        </div>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Solar Pizza Tracker</h3>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">Project timeline</p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-extrabold text-amber-400">{tracker?.progressPercent ?? 0}%</span>
            <p className="text-[9px] text-slate-500 uppercase font-mono">Complete</p>
          </div>
        </div>
        <div className="h-2 bg-slate-950 rounded-full overflow-hidden mb-5 border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
            style={{ width: `${tracker?.progressPercent ?? 0}%` }}
          />
        </div>
        <ul className="space-y-3">
          {(tracker?.stages || []).map((s) => (
            <li
              key={s.id}
              className={`flex items-start gap-3 p-3 rounded-2xl border ${
                s.status === "active"
                  ? "border-amber-500/40 bg-amber-950/20"
                  : s.status === "completed"
                    ? "border-emerald-900/40 bg-emerald-950/10"
                    : "border-slate-800 bg-slate-950/50"
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {s.status === "completed" ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : s.status === "active" ? (
                  <Clock className="w-5 h-5 text-amber-500" />
                ) : (
                  <Circle className="w-5 h-5 text-slate-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">{s.label}</span>
                  <StatusBadge status={s.status} />
                </div>
                <p className="text-[10px] text-slate-500 mt-1 font-mono">
                  {s.date ? s.date : "No date recorded yet"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {!data?.lead && (
        <p className="text-center text-xs text-slate-500 font-mono px-4">
          Your project record is not linked yet. Our team will connect your account shortly.
        </p>
      )}
    </>
  );
}
