import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  ChevronRight,
  FileText,
  Headphones,
  Star,
  Sun,
  Zap,
} from "lucide-react";
import type { ClientPortalPayload } from "../lib/clientPortalTracker";
import { displayKw, displayOrNoData, NO_DATA } from "../lib/clientPortalDisplay";
import { isProjectCompleted, projectStatusHeadline } from "../lib/clientPortalCompletion";
import {
  buildPremiumProjectTimeline,
  premiumTimelinePercent,
} from "../lib/clientPortalPremiumTimeline";
import { portal, resolveGoogleReviewUrl } from "../lib/clientPortalUi";
import type { CompanyBranding } from "../lib/branding";
import { User } from "../types";
import {
  fetchCustomerPortalSystem,
  fetchCustomerPortalPaymentsMe,
  fetchCustomerProjectDeliveryMe,
} from "../services/api";

function TimelineDot({ status }: { status: "completed" | "active" | "pending" }) {
  if (status === "completed") {
    return (
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/90 text-white shadow-lg shadow-emerald-500/25">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500 text-slate-950 ring-4 ring-amber-500/20">
        <Clock className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-slate-600">
      <Circle className="h-4 w-4" />
    </span>
  );
}

interface ClientPortalHomeProps {
  user: User;
  data: ClientPortalPayload | null;
  branding?: CompanyBranding | null;
  onOpenDocuments: () => void;
  onOpenPayments: () => void;
  onOpenSupport: () => void;
}

export default function ClientPortalHome({
  user,
  data,
  branding,
  onOpenDocuments,
  onOpenPayments,
  onOpenSupport,
}: ClientPortalHomeProps) {
  const customer = data?.customer;
  const [system, setSystem] = useState<any>(null);
  const [delivery, setDelivery] = useState<any | null>(null);
  const [payments, setPayments] = useState<any>(null);

  useEffect(() => {
    fetchCustomerPortalSystem(user.id, user.username)
      .then((d) => setSystem(d.system))
      .catch(() => setSystem(null));
    fetchCustomerProjectDeliveryMe(user.id, user.username)
      .then(setDelivery)
      .catch(() => setDelivery(null));
    fetchCustomerPortalPaymentsMe(user.id, user.username)
      .then(setPayments)
      .catch(() => setPayments(null));
  }, [user.id, user.username]);

  const timeline = buildPremiumProjectTimeline(data, delivery);
  const timelinePct = premiumTimelinePercent(timeline);
  const completed = isProjectCompleted(data, delivery);
  const headline = projectStatusHeadline(data);
  const customerName = displayOrNoData(customer?.name || user.name);

  const totals = payments?.totals || {};
  const projectValue = Number(totals.invoiceAmount || 0);
  const paid = Number(totals.amountPaid || 0);
  const balance = Number(totals.balanceRemaining || 0);
  const payPct = projectValue > 0 ? Math.min(100, Math.round((paid / projectValue) * 100)) : 0;

  const sys = system || {};
  const panelLine =
    sys.panelBrand && sys.panelQuantity
      ? `${sys.panelBrand} · ${sys.panelQuantity}× ${sys.panelWattage || "?"}W`
      : displayOrNoData(sys.panelBrand);
  const inverterLine =
    sys.inverterBrand && sys.inverterSizeKw
      ? `${sys.inverterBrand} · ${sys.inverterSizeKw} kW`
      : displayOrNoData(sys.inverterBrand);
  const batteryLine =
    sys.batteryBrand && sys.batteryCapacityKwh
      ? `${sys.batteryBrand} · ${sys.batteryCapacityKwh} kWh`
      : sys.batteryBrand
        ? displayOrNoData(sys.batteryBrand)
        : null;

  return (
    <div className="space-y-8 pb-4">
      {/* 1. Customer + project status */}
      <section className={`${portal.card} overflow-hidden`}>
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">Welcome back</p>
              <h1 className="text-2xl font-semibold text-white mt-1 tracking-tight">{customerName}</h1>
            </div>
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15">
              <Sun className="h-6 w-6 text-amber-400" />
            </span>
          </div>
          <p className="text-lg text-slate-200 mt-5 leading-snug font-medium">{headline}</p>
          <div className="mt-4">
            <div className="flex justify-between text-xs text-slate-500 mb-2">
              <span>Project progress</span>
              <span className="text-amber-400 font-semibold">{timelinePct}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-700"
                style={{ width: `${timelinePct}%` }}
              />
            </div>
          </div>
        </div>
        {completed && (
          <div className="px-5 py-4 bg-emerald-500/10 border-t border-emerald-500/20">
            <p className="text-sm font-semibold text-emerald-300">Project completed</p>
            <a
              href={resolveGoogleReviewUrl(branding)}
              target="_blank"
              rel="noopener noreferrer"
              className={`${portal.btnPrimary} w-full mt-3 !text-sm`}
            >
              <Star className="h-4 w-4 fill-current" />
              Leave Google Review
            </a>
          </div>
        )}
      </section>

      {/* 2. Solar system summary */}
      <section className={`${portal.card} ${portal.cardPad}`}>
        <div className="flex items-center gap-2 mb-5">
          <Zap className="h-5 w-5 text-amber-400" />
          <h2 className={portal.titleSm}>Solar system</h2>
        </div>
        <dl className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <dt className={portal.label}>System size</dt>
              <dd className={`${portal.value} mt-1`}>{displayKw(sys.systemSizeKw ?? data?.dashboard?.systemSizeKw)}</dd>
            </div>
            <div>
              <dt className={portal.label}>System type</dt>
              <dd className={`${portal.value} mt-1`}>{displayOrNoData(sys.systemType)}</dd>
            </div>
          </div>
          <div>
            <dt className={portal.label}>Panels</dt>
            <dd className={`${portal.value} mt-1`}>{panelLine}</dd>
          </div>
          <div>
            <dt className={portal.label}>Inverter</dt>
            <dd className={`${portal.value} mt-1`}>{inverterLine}</dd>
          </div>
          {batteryLine && (
            <div>
              <dt className={portal.label}>Battery</dt>
              <dd className={`${portal.value} mt-1`}>{batteryLine}</dd>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <dt className={portal.label}>Structure</dt>
              <dd className={`${portal.value} mt-1`}>{displayOrNoData(sys.structureType)}</dd>
            </div>
            <div>
              <dt className={portal.label}>Net metering</dt>
              <dd className={`${portal.value} mt-1`}>
                {displayOrNoData(sys.netMeteringStatus ?? data?.dashboard?.netMeteringStatus)}
              </dd>
            </div>
          </div>
        </dl>
      </section>

      {/* 3. Project timeline */}
      <section className={`${portal.card} ${portal.cardPad}`}>
        <h2 className={portal.titleSm}>Project timeline</h2>
        <p className={portal.subtitle + " mt-1 mb-6"}>Track every milestone to commissioning</p>
        <ol className="space-y-0">
          {timeline.map((s, i, arr) => (
            <li key={s.id} className="flex gap-4 pb-7 last:pb-0">
              <div className="flex flex-col items-center">
                <TimelineDot status={s.status} />
                {i < arr.length - 1 && <div className="w-px flex-1 bg-white/[0.08] mt-2 min-h-[20px]" />}
              </div>
              <div className="flex-1 pt-1">
                <p
                  className={`text-sm font-semibold ${
                    s.status === "active" ? "text-amber-400" : s.status === "completed" ? "text-slate-200" : "text-slate-500"
                  }`}
                >
                  {s.label}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">{s.date || (s.status === "pending" ? "Upcoming" : "—")}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* 4. Payment progress */}
      <section className={`${portal.card} ${portal.cardPad}`}>
        <h2 className={portal.titleSm}>Payments</h2>
        <p className={portal.subtitle + " mt-1 mb-5"}>Project value and balance</p>
        <div className="grid grid-cols-3 gap-3 text-center mb-5">
          <div className={portal.cardMuted + " py-3 px-2"}>
            <p className="text-[10px] text-slate-500 uppercase">Total</p>
            <p className="text-sm font-bold text-white mt-1">
              {projectValue ? projectValue.toLocaleString() : NO_DATA}
            </p>
          </div>
          <div className={portal.cardMuted + " py-3 px-2"}>
            <p className="text-[10px] text-slate-500 uppercase">Paid</p>
            <p className="text-sm font-bold text-emerald-400 mt-1">{paid.toLocaleString()}</p>
          </div>
          <div className={portal.cardMuted + " py-3 px-2"}>
            <p className="text-[10px] text-slate-500 uppercase">Due</p>
            <p className="text-sm font-bold text-amber-400 mt-1">{balance.toLocaleString()}</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-600 text-center mb-2">PKR · Payment progress {payPct}%</p>
        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden mb-5">
          <div
            className="h-full rounded-full bg-emerald-500/80 transition-all"
            style={{ width: `${payPct}%` }}
          />
        </div>
        <button type="button" onClick={onOpenPayments} className={portal.btnSecondary + " w-full"}>
          View invoices &amp; receipts
          <ChevronRight className="h-4 w-4" />
        </button>
      </section>

      {/* 5. Quick actions */}
      <section>
        <h2 className={portal.titleSm + " mb-4"}>Quick actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onOpenDocuments} className={portal.btnSecondary + " flex-col !py-5"}>
            <FileText className="h-5 w-5 text-amber-400" />
            <span>Documents</span>
          </button>
          <button type="button" onClick={onOpenPayments} className={portal.btnSecondary + " flex-col !py-5"}>
            <span className="text-lg font-bold text-white">PKR</span>
            <span className="text-xs">Payments</span>
          </button>
          <button type="button" onClick={onOpenSupport} className={portal.btnPrimary + " col-span-2 !py-4"}>
            <Headphones className="h-5 w-5" />
            Get support
          </button>
        </div>
      </section>
    </div>
  );
}
