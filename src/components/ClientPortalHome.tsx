import React, { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import type { ClientPortalPayload } from "../lib/clientPortalTracker";
import { displayKw, displayOrNoData, NO_DATA } from "../lib/clientPortalDisplay";
import { isProjectCompleted, projectStatusHeadline } from "../lib/clientPortalCompletion";
import {
  buildPremiumProjectTimeline,
  premiumTimelinePercent,
} from "../lib/clientPortalPremiumTimeline";
import { buildCustomerHealthMetrics } from "../lib/clientPortalHealth";
import { portal } from "../lib/clientPortalUi";
import type { CompanyBranding } from "../lib/branding";
import { User } from "../types";
import {
  fetchCustomerPortalSystem,
  fetchCustomerPortalPaymentsMe,
  fetchCustomerProjectDeliveryMe,
  fetchCustomerPortalWarranties,
} from "../services/api";
import type { PortalServiceId } from "./ClientPortalPremiumServices";
import ClientPortalPremiumServices from "./ClientPortalPremiumServices";
import ClientPortalHealthScore from "./ClientPortalHealthScore";
import ClientPortalGoogleReview from "./ClientPortalGoogleReview";

interface ClientPortalHomeProps {
  user: User;
  data: ClientPortalPayload | null;
  branding?: CompanyBranding | null;
  onOpenDocuments: () => void;
  onOpenPayments: () => void;
  onOpenSupport: () => void;
  onOpenService: (id: PortalServiceId) => void;
}

export default function ClientPortalHome({
  user,
  data,
  branding,
  onOpenDocuments,
  onOpenPayments,
  onOpenSupport,
  onOpenService,
}: ClientPortalHomeProps) {
  const customer = data?.customer;
  const dash = data?.dashboard;
  const [system, setSystem] = useState<any>(null);
  const [delivery, setDelivery] = useState<any | null>(null);
  const [payments, setPayments] = useState<any>(null);
  const [warrantySummary, setWarrantySummary] = useState<string | null>(null);

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
    fetchCustomerPortalWarranties(user.id, user.username)
      .then((res) => {
        const cards = res.cards || [];
        const active = cards.find((c: any) => c.status === "Active");
        setWarrantySummary(active?.title || cards[0]?.status || dash?.warrantySummary || null);
      })
      .catch(() => setWarrantySummary(dash?.warrantySummary || null));
  }, [user.id, user.username, dash?.warrantySummary]);

  const timeline = buildPremiumProjectTimeline(data, delivery);
  const timelinePct = premiumTimelinePercent(timeline);
  const completed = isProjectCompleted(data, delivery);
  const headline = projectStatusHeadline(data);

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
        : NO_DATA;

  const netMetering = displayOrNoData(sys.netMeteringStatus ?? dash?.netMeteringStatus);
  const warrantyRemaining = displayOrNoData(warrantySummary || dash?.warrantySummary);

  const healthMetrics = buildCustomerHealthMetrics(data, {
    netMetering: netMetering !== NO_DATA ? netMetering : undefined,
    warrantyLabel:
      warrantySummary || dash?.warrantySummary
        ? String(warrantySummary || dash?.warrantySummary)
        : undefined,
    serviceDue: dash?.nextServiceDue,
    systemHealthLabel: dash?.installationStatus?.toLowerCase().includes("complete")
      ? "Operational"
      : dash?.installationStatus,
  });

  return (
    <div className="space-y-6 pb-2">
      {/* Solar Dashboard — unified project + system + payments summary */}
      <section className={`${portal.card} ${portal.cardPad}`}>
        <div className="flex items-center gap-2 mb-4">
          <Zap className="h-5 w-5 text-amber-400" />
          <h2 className={portal.titleSm}>Solar Dashboard</h2>
        </div>

        <p className="text-base font-medium text-slate-200 leading-snug">{headline}</p>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-500 mb-2">
            <span>Milestone progress</span>
            <span className="text-amber-400 font-semibold">{timelinePct}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-700"
              style={{ width: `${timelinePct}%` }}
            />
          </div>
        </div>

        <dl className="space-y-4 mt-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <dt className={portal.label}>System size</dt>
              <dd className={`${portal.value} mt-1`}>{displayKw(sys.systemSizeKw ?? dash?.systemSizeKw)}</dd>
            </div>
            <div>
              <dt className={portal.label}>Net metering</dt>
              <dd className={`${portal.value} mt-1`}>{netMetering}</dd>
            </div>
          </div>
          <div>
            <dt className={portal.label}>Panel brand</dt>
            <dd className={`${portal.value} mt-1`}>{panelLine}</dd>
          </div>
          <div>
            <dt className={portal.label}>Inverter brand</dt>
            <dd className={`${portal.value} mt-1`}>{inverterLine}</dd>
          </div>
          <div>
            <dt className={portal.label}>Battery brand</dt>
            <dd className={`${portal.value} mt-1`}>{batteryLine}</dd>
          </div>
          <div>
            <dt className={portal.label}>Warranty remaining</dt>
            <dd className={`${portal.value} mt-1`}>{warrantyRemaining}</dd>
          </div>
          <div className={`${portal.cardMuted} p-4`}>
            <dt className={portal.label}>Outstanding balance</dt>
            <dd className="text-xl font-bold text-amber-400 mt-1 tabular-nums">
              {balance ? `PKR ${balance.toLocaleString()}` : NO_DATA}
            </dd>
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-500 mb-2">
                <span>Payment progress</span>
                <span className="text-emerald-400 font-semibold">{payPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500/80 transition-all"
                  style={{ width: `${payPct}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenPayments}
              className={portal.btnGhost + " mt-3 !px-0"}
            >
              View payments
            </button>
          </div>
        </dl>
      </section>

      {/* Services grid — includes Documents as 8th card */}
      <ClientPortalPremiumServices
        onOpen={onOpenService}
        onOpenDocuments={onOpenDocuments}
        showDocuments
      />

      {/* Health score */}
      <ClientPortalHealthScore metrics={healthMetrics} />

      {completed && customer?.id && (
        <ClientPortalGoogleReview customerId={customer.id} branding={branding} />
      )}
    </div>
  );
}
