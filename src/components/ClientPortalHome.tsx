import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Clock,
  ChevronRight,
  FileText,
  Headphones,
  Receipt,
} from "lucide-react";
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
  fetchCustomerPortalInvoicesMe,
  fetchCustomerSupportTickets,
  fetchCustomerPortalWarranties,
} from "../services/api";
import type { PortalServiceId } from "./ClientPortalPremiumServices";
import ClientPortalPremiumServices from "./ClientPortalPremiumServices";
import ClientPortalHealthScore from "./ClientPortalHealthScore";
import ClientPortalGoogleReview from "./ClientPortalGoogleReview";

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
  const [latestInvoice, setLatestInvoice] = useState<any>(null);
  const [latestTicket, setLatestTicket] = useState<any>(null);
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
    fetchCustomerPortalInvoicesMe(user.id, user.username)
      .then((res) => {
        const list = res.invoices || [];
        setLatestInvoice(list.length ? list[0] : null);
      })
      .catch(() => setLatestInvoice(null));
    fetchCustomerSupportTickets(user.id, user.username)
      .then((res) => {
        const list = res.tickets || [];
        setLatestTicket(list.length ? list[0] : null);
      })
      .catch(() => setLatestTicket(null));
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
  const projectStatus = dash?.projectStatus || headline;

  const totals = payments?.totals || {};
  const balance = Number(totals.balanceRemaining || 0);
  const payPct =
    Number(totals.invoiceAmount || 0) > 0
      ? Math.min(100, Math.round((Number(totals.amountPaid || 0) / Number(totals.invoiceAmount)) * 100))
      : 0;

  const sys = system || {};
  const panelBrand = displayOrNoData(sys.panelBrand || sys.panelType);
  const inverterBrand = displayOrNoData(sys.inverterBrand);
  const batteryBrand = displayOrNoData(sys.batteryBrand || (sys.batteryCapacityKwh ? "Installed" : null));
  const netMetering = displayOrNoData(sys.netMeteringStatus ?? dash?.netMeteringStatus);
  const warrantyRemaining = displayOrNoData(warrantySummary || dash?.warrantySummary);

  const healthMetrics = buildCustomerHealthMetrics(data, {
    netMetering: netMetering !== NO_DATA ? netMetering : undefined,
    warrantyLabel: warrantyRemaining !== NO_DATA ? warrantyRemaining : undefined,
    serviceDue: dash?.nextServiceDue,
    systemHealthLabel: dash?.installationStatus?.toLowerCase().includes("complete")
      ? "Operational"
      : dash?.installationStatus,
  });

  return (
    <div className="space-y-8 pb-4">
      {/* Project status + key metrics */}
      <section className={`${portal.card} ${portal.cardPad}`}>
        <p className={portal.label}>Project status</p>
        <p className="text-xl font-semibold text-white mt-1">{headline}</p>
        <div className="mt-4 flex justify-between text-xs text-slate-500 mb-2">
          <span>Milestone progress</span>
          <span className="text-amber-400 font-semibold">{timelinePct}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400"
            style={{ width: `${timelinePct}%` }}
          />
        </div>
      </section>

      {/* Dashboard grid */}
      <section className={`${portal.card} ${portal.cardPad}`}>
        <h2 className={portal.titleSm + " mb-4"}>Your solar dashboard</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <div>
            <dt className={portal.label}>System size</dt>
            <dd className={`${portal.value} mt-1`}>{displayKw(sys.systemSizeKw ?? dash?.systemSizeKw)}</dd>
          </div>
          <div>
            <dt className={portal.label}>Panel brand</dt>
            <dd className={`${portal.value} mt-1 text-sm`}>{panelBrand}</dd>
          </div>
          <div>
            <dt className={portal.label}>Inverter brand</dt>
            <dd className={`${portal.value} mt-1 text-sm`}>{inverterBrand}</dd>
          </div>
          <div>
            <dt className={portal.label}>Battery brand</dt>
            <dd className={`${portal.value} mt-1 text-sm`}>{batteryBrand}</dd>
          </div>
          <div>
            <dt className={portal.label}>Net metering</dt>
            <dd className={`${portal.value} mt-1 text-sm`}>{netMetering}</dd>
          </div>
          <div>
            <dt className={portal.label}>Warranty remaining</dt>
            <dd className={`${portal.value} mt-1 text-sm`}>{warrantyRemaining}</dd>
          </div>
          <div>
            <dt className={portal.label}>Outstanding balance</dt>
            <dd className="text-base font-bold text-amber-400 mt-1">
              {balance ? `PKR ${balance.toLocaleString()}` : NO_DATA}
            </dd>
          </div>
          <div>
            <dt className={portal.label}>Payment progress</dt>
            <dd className={`${portal.value} mt-1`}>{payPct}%</dd>
          </div>
        </dl>
      </section>

      <ClientPortalHealthScore metrics={healthMetrics} />

      {/* Latest invoice & support */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onOpenPayments}
          className={`${portal.card} ${portal.cardPad} text-left w-full`}
        >
          <Receipt className="h-5 w-5 text-amber-400 mb-2" />
          <p className={portal.label}>Latest invoice</p>
          {latestInvoice ? (
            <>
              <p className="text-sm font-semibold text-white mt-1">{latestInvoice.invoiceNumber}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                PKR {Number(latestInvoice.balanceDue || 0).toLocaleString()} due · {latestInvoice.paymentStatus}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500 mt-1">No invoices yet</p>
          )}
          <ChevronRight className="h-4 w-4 text-slate-600 mt-2" />
        </button>
        <button
          type="button"
          onClick={onOpenSupport}
          className={`${portal.card} ${portal.cardPad} text-left w-full`}
        >
          <Headphones className="h-5 w-5 text-amber-400 mb-2" />
          <p className={portal.label}>Latest support ticket</p>
          {latestTicket ? (
            <>
              <p className="text-sm font-semibold text-white mt-1 truncate">{latestTicket.subject}</p>
              <p className="text-xs text-slate-500 mt-0.5">{latestTicket.status}</p>
            </>
          ) : (
            <p className="text-sm text-slate-500 mt-1">No tickets — we&apos;re here if you need us</p>
          )}
          <ChevronRight className="h-4 w-4 text-slate-600 mt-2" />
        </button>
      </div>

      {completed && customer?.id && (
        <ClientPortalGoogleReview customerId={customer.id} branding={branding} />
      )}

      {/* Timeline */}
      <section className={`${portal.card} ${portal.cardPad}`}>
        <h2 className={portal.titleSm}>Project timeline</h2>
        <p className={portal.subtitle + " mt-1 mb-6"}>From quotation to warranty active</p>
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
                    s.status === "active"
                      ? "text-amber-400"
                      : s.status === "completed"
                        ? "text-slate-200"
                        : "text-slate-500"
                  }`}
                >
                  {s.label}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {s.date || (s.status === "pending" ? "Upcoming" : "—")}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <ClientPortalPremiumServices onOpen={onOpenService} />

      {/* Quick access to main tabs */}
      <section>
        <h2 className={portal.titleSm + " mb-3"}>Quick access</h2>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={onOpenDocuments} className={portal.btnSecondary + " flex-col !py-4 !text-xs"}>
            <FileText className="h-4 w-4 text-amber-400" />
            Documents
          </button>
          <button type="button" onClick={onOpenPayments} className={portal.btnSecondary + " flex-col !py-4 !text-xs"}>
            <Receipt className="h-4 w-4 text-amber-400" />
            Payments
          </button>
          <button type="button" onClick={onOpenSupport} className={portal.btnPrimary + " flex-col !py-4 !text-xs"}>
            <Headphones className="h-4 w-4" />
            Support
          </button>
        </div>
      </section>

      <p className="text-center text-[10px] text-slate-600 pb-2">
        Status: {projectStatus} · All portal modules available below and in Account
      </p>
    </div>
  );
}
