import React, { useEffect, useState } from "react";
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
  TrendingUp,
  ArrowUpCircle,
} from "lucide-react";
import type { ClientPortalPayload } from "../lib/clientPortalTracker";
import { NO_DATA, displayKw, displayOrNoData } from "../lib/clientPortalDisplay";
import { User } from "../types";
import { fetchCustomerProjectDeliveryMe } from "../services/api";

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
  user: User;
  data: ClientPortalPayload | null;
  onRequestUpgrade: () => void;
  onOpenSupport: () => void;
}

export default function ClientPortalHome({ user, data, onRequestUpgrade, onOpenSupport }: ClientPortalHomeProps) {
  const dashboard = data?.dashboard;
  const tracker = data?.tracker;
  const customer = data?.customer;
  const projectStatus = displayOrNoData(dashboard?.projectStatus);
  const [delivery, setDelivery] = useState<any | null>(null);

  useEffect(() => {
    fetchCustomerProjectDeliveryMe(user.id, user.username)
      .then(setDelivery)
      .catch(() => setDelivery(null));
  }, [user.id, user.username]);

  return (
    <>
      {delivery?.delivery && delivery.progress && (
        <section className="bg-slate-900 border border-slate-800 rounded-3xl p-5 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-amber-500">Your solar delivery</p>
          <p className="font-bold text-white">{delivery.delivery.projectTitle}</p>
          <p className="text-xs text-slate-400">
            {delivery.delivery.systemType} · {delivery.delivery.systemSizeKw ?? "—"} kW · {delivery.delivery.deliveryStatus}
          </p>
          <ol className="space-y-2">
            {delivery.progress.steps.map((step: { label: string; status: string }) => (
              <li key={step.label} className="flex items-center justify-between text-sm">
                <span className="text-slate-200">{step.label}</span>
                <StatusBadge
                  status={
                    step.status === "completed"
                      ? "completed"
                      : step.status === "active"
                        ? "active"
                        : "pending"
                  }
                />
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-amber-500">Your account</p>
        <dl className="grid grid-cols-1 gap-2 text-xs">
          <div>
            <dt className="text-slate-500 font-mono text-[10px] uppercase">Customer name</dt>
            <dd className="font-bold text-white">{displayOrNoData(customer?.name)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 font-mono text-[10px] uppercase">Email</dt>
            <dd className="text-slate-300 break-all">{displayOrNoData(customer?.email)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 font-mono text-[10px] uppercase">Customer ID</dt>
            <dd className="text-slate-300 font-mono">{displayOrNoData(customer?.id)}</dd>
          </div>
          <div>
            <dt className="text-slate-500 font-mono text-[10px] uppercase">Project status</dt>
            <dd className="text-amber-400/90 font-semibold">{projectStatus}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={onRequestUpgrade}
            className="bg-amber-500 text-slate-950 font-bold rounded-xl px-3 py-2 text-[11px] flex items-center gap-1.5"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            Request Upgrade
          </button>
          <button
            type="button"
            onClick={onOpenSupport}
            className="bg-slate-950 text-slate-200 border border-slate-700 rounded-xl px-3 py-2 text-[11px] flex items-center gap-1.5"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Solar Savings
          </button>
        </div>
        <p className="text-[10px] text-slate-500 font-mono">
          Solar savings: {displayOrNoData(dashboard?.solarSavingsAnnual)}
        </p>
      </section>

      <section>
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 mb-3 px-1">
          Project overview
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <DashboardCard icon={Zap} label="System size" value={displayKw(dashboard?.systemSizeKw ?? null)} />
          <DashboardCard icon={Gauge} label="Project status" value={projectStatus} />
          <DashboardCard
            icon={FileText}
            label="Quotation"
            value={displayOrNoData(dashboard?.quotationStatus)}
          />
          <DashboardCard
            icon={Wrench}
            label="Installation"
            value={displayOrNoData(dashboard?.installationStatus)}
          />
          <DashboardCard
            icon={Shield}
            label="Net metering"
            value={displayOrNoData(dashboard?.netMeteringStatus)}
          />
          <DashboardCard
            icon={Shield}
            label="Warranty"
            value={displayOrNoData(dashboard?.warrantySummary)}
          />
          <DashboardCard
            icon={Headphones}
            label="Open tickets"
            value={
              dashboard?.openTicketsCount != null
                ? String(dashboard.openTicketsCount)
                : NO_DATA
            }
          />
          <DashboardCard
            icon={TrendingUp}
            label="Solar savings"
            value={displayOrNoData(dashboard?.solarSavingsAnnual)}
          />
        </div>
      </section>

      <section className="bg-slate-900 border border-slate-800 rounded-3xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-white">Project Tracker</h3>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {tracker?.trackerType === "industrial" ? "Industrial timeline" : "Residential timeline"}
            </p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-extrabold text-amber-400">
              {data?.lead ? `${tracker?.progressPercent ?? 0}%` : NO_DATA}
            </span>
            <p className="text-[9px] text-slate-500 uppercase font-mono">Complete</p>
          </div>
        </div>
        {!data?.lead ? (
          <p className="text-center text-xs text-slate-500 font-mono py-6">{NO_DATA}</p>
        ) : (
          <>
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
                      {s.date ? s.date : NO_DATA}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
