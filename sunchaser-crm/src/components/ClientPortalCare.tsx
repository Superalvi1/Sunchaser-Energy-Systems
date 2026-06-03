import React, { useEffect, useState } from "react";
import {
  Loader2,
  Heart,
  Calendar,
  CheckCircle2,
  Sparkles,
  ClipboardList,
  ImageIcon,
} from "lucide-react";
import { User } from "../types";
import {
  fetchCustomerCare,
  subscribeCustomerCare,
  createCareServiceRequest,
} from "../services/api";
import {
  CARE_SERVICE_REQUEST_TYPES,
  formatPkrCare,
  type CarePortalPayload,
  type SubscriptionPlanRecord,
  type CustomerSubscriptionRecord,
  type ServiceVisitReportRecord,
} from "../lib/clientPortalCare";

interface ClientPortalCareProps {
  user: User;
}

function statusStyle(status: string) {
  switch (status) {
    case "Active":
      return "bg-emerald-950/40 border-emerald-800 text-emerald-300";
    case "Expired":
      return "bg-slate-800 border-slate-700 text-slate-400";
    case "Cancelled":
      return "bg-rose-950/40 border-rose-800 text-rose-300";
    default:
      return "bg-amber-950/40 border-amber-800 text-amber-300";
  }
}

function PlanCard({
  plan,
  subscribed,
  busy,
  onSubscribe,
}: {
  plan: SubscriptionPlanRecord;
  subscribed: boolean;
  busy: string | null;
  onSubscribe: (code: string) => void;
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-extrabold text-white">{plan.name}</h3>
        <p className="text-sm font-bold text-amber-400 whitespace-nowrap">
          {formatPkrCare(plan.monthlyPrice)}
          <span className="text-[10px] text-slate-500 font-normal">/mo</span>
        </p>
      </div>
      <ul className="text-xs text-slate-400 space-y-1.5 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={subscribed || busy === plan.planCode}
        onClick={() => onSubscribe(plan.planCode)}
        className="w-full py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-extrabold disabled:opacity-40"
      >
        {busy === plan.planCode ? (
          <Loader2 className="w-4 h-4 animate-spin mx-auto" />
        ) : subscribed ? (
          "Current plan"
        ) : (
          "Subscribe"
        )}
      </button>
    </div>
  );
}

function SubscriptionDashboard({ sub }: { sub: CustomerSubscriptionRecord }) {
  return (
    <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-500" />
          Your subscription
        </h3>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-lg border ${statusStyle(sub.status)}`}>
          {sub.status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-slate-500 font-mono uppercase text-[10px]">Current plan</p>
          <p className="font-bold text-white mt-0.5">{sub.planName || "Care plan"}</p>
        </div>
        <div>
          <p className="text-slate-500 font-mono uppercase text-[10px]">Start date</p>
          <p className="font-bold text-white mt-0.5">{sub.startDate}</p>
        </div>
        <div>
          <p className="text-slate-500 font-mono uppercase text-[10px]">Renewal date</p>
          <p className="font-bold text-white mt-0.5">{sub.renewalDate}</p>
        </div>
        <div>
          <p className="text-slate-500 font-mono uppercase text-[10px]">Days remaining</p>
          <p className="font-bold text-amber-400 mt-0.5">{sub.daysRemaining}</p>
        </div>
        <div className="col-span-2">
          <p className="text-slate-500 font-mono uppercase text-[10px]">Service credits used</p>
          <p className="font-bold text-white mt-0.5">
            {sub.serviceCreditsUsed} / {sub.serviceCreditsLimit}
          </p>
          <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full"
              style={{
                width: `${Math.min(100, (sub.serviceCreditsUsed / Math.max(1, sub.serviceCreditsLimit)) * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function VisitReportCard({ report }: { report: ServiceVisitReportRecord }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Calendar className="w-3.5 h-3.5" />
        {report.visitDate || "Visit date TBD"}
        {report.technician && <span>· {report.technician}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="aspect-video bg-slate-950 rounded-xl border border-slate-800 overflow-hidden flex flex-col items-center justify-center">
          {report.beforePhotoUrl ? (
            <img src={report.beforePhotoUrl} alt="Before" className="w-full h-full object-cover" />
          ) : (
            <>
              <ImageIcon className="w-6 h-6 text-slate-600 mb-1" />
              <span className="text-[10px] text-slate-600">Before</span>
            </>
          )}
        </div>
        <div className="aspect-video bg-slate-950 rounded-xl border border-slate-800 overflow-hidden flex flex-col items-center justify-center">
          {report.afterPhotoUrl ? (
            <img src={report.afterPhotoUrl} alt="After" className="w-full h-full object-cover" />
          ) : (
            <>
              <ImageIcon className="w-6 h-6 text-slate-600 mb-1" />
              <span className="text-[10px] text-slate-600">After</span>
            </>
          )}
        </div>
      </div>
      {report.performanceImprovementNotes && (
        <p className="text-xs text-slate-300 leading-relaxed">{report.performanceImprovementNotes}</p>
      )}
    </div>
  );
}

export default function ClientPortalCare({ user }: ClientPortalCareProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CarePortalPayload | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [busyRequest, setBusyRequest] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchCustomerCare(user.id, user.username);
      setData({
        plans: payload.plans || [],
        subscription: payload.subscription || null,
        visitReports: payload.visitReports || [],
      });
    } catch (err: any) {
      setError(err.message || "Failed to load care plans.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user.id, user.username]);

  const handleSubscribe = async (planCode: string) => {
    setBusyPlan(planCode);
    setMsg(null);
    try {
      await subscribeCustomerCare(user.id, user.username, planCode);
      setMsg("Subscribed successfully. Your care plan is now active.");
      await load();
    } catch (err: any) {
      setMsg(err.message || "Subscription failed.");
    } finally {
      setBusyPlan(null);
    }
  };

  const handleCareRequest = async (requestType: string) => {
    setBusyRequest(requestType);
    setMsg(null);
    try {
      await createCareServiceRequest(user.id, user.username, requestType);
      setMsg("Visit request submitted. Our team will schedule your appointment.");
      await load();
    } catch (err: any) {
      setMsg(err.message || "Request failed.");
    } finally {
      setBusyRequest(null);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-400">Loading care plans…</p>
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

  const sub = data?.subscription;
  const activePlanCode = sub?.planCode;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Heart className="w-5 h-5 text-rose-400" />
        <h2 className="text-lg font-extrabold">Smart Care Plans</h2>
      </div>

      {msg && (
        <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-900/50 rounded-xl px-3 py-2">
          {msg}
        </p>
      )}

      {sub && <SubscriptionDashboard sub={sub} />}

      <div className="space-y-3">
        <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider">Available plans</h3>
        <div className="space-y-4">
          {(data?.plans || []).map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              subscribed={!!sub && activePlanCode === plan.planCode}
              busy={busyPlan}
              onSubscribe={handleSubscribe}
            />
          ))}
        </div>
      </div>

      {sub?.status === "Active" && (
        <div className="space-y-3">
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider flex items-center gap-2">
            <ClipboardList className="w-3.5 h-3.5" />
            Request a visit
          </h3>
          <div className="grid gap-2">
            {CARE_SERVICE_REQUEST_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                disabled={busyRequest === t.key}
                onClick={() => handleCareRequest(t.key)}
                className="py-3 px-4 rounded-xl bg-slate-900 border border-slate-800 text-sm font-bold text-left hover:border-amber-500/40 disabled:opacity-50"
              >
                {busyRequest === t.key ? (
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                ) : null}
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {(data?.visitReports?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-mono text-slate-500 uppercase tracking-wider">
            Before / after visit reports
          </h3>
          {data!.visitReports.map((r) => (
            <VisitReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  );
}
