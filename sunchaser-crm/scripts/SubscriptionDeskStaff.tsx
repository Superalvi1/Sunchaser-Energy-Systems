import React, { useEffect, useState } from "react";
import { Heart, Loader2, Banknote, Users, CalendarClock } from "lucide-react";
import { User } from "../types";
import {
  listAdminCareSubscriptions,
  fetchAdminCareRevenueSummary,
  createAdminVisitReport,
} from "../services/api";
import { formatPkrCare, type CustomerSubscriptionRecord } from "../lib/clientPortalCare";

interface SubscriptionDeskStaffProps {
  staffUser: User;
}

type Segment = "active" | "expired" | "renewals";

export default function SubscriptionDeskStaff({ staffUser }: SubscriptionDeskStaffProps) {
  const [segment, setSegment] = useState<Segment>("active");
  const [subscriptions, setSubscriptions] = useState<CustomerSubscriptionRecord[]>([]);
  const [revenue, setRevenue] = useState<{
    activePlans: number;
    monthlyRecurringRevenue: number;
    expiringThisMonth: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState("");
  const [technician, setTechnician] = useState("");
  const [visitDate, setVisitDate] = useState("");
  const [beforeUrl, setBeforeUrl] = useState("");
  const [afterUrl, setAfterUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [subData, rev] = await Promise.all([
        listAdminCareSubscriptions(staffUser.id, staffUser.username, segment),
        fetchAdminCareRevenueSummary(staffUser.id, staffUser.username),
      ]);
      setSubscriptions(subData.subscriptions || []);
      setRevenue(rev);
    } catch {
      setSubscriptions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [staffUser.id, staffUser.username, segment]);

  const saveReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim()) {
      setMsg("Customer ID is required.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await createAdminVisitReport(staffUser.id, staffUser.username, {
        customerId: customerId.trim(),
        technician: technician || undefined,
        visitDate: visitDate || undefined,
        beforePhotoUrl: beforeUrl || undefined,
        afterPhotoUrl: afterUrl || undefined,
        performanceImprovementNotes: notes || undefined,
      });
      setMsg("Visit report created. Customer will see it in Care Plans.");
      setCustomerId("");
      setTechnician("");
      setVisitDate("");
      setBeforeUrl("");
      setAfterUrl("");
      setNotes("");
    } catch (err: any) {
      setMsg(err.message || "Failed to save report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <Heart className="w-5 h-5 text-rose-400" />
        Subscription Desk
      </h3>

      {revenue && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <Users className="w-4 h-4 text-emerald-500 mb-2" />
            <p className="text-[10px] text-slate-500 uppercase font-mono">Active plans</p>
            <p className="text-xl font-extrabold">{revenue.activePlans}</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <Banknote className="w-4 h-4 text-amber-500 mb-2" />
            <p className="text-[10px] text-slate-500 uppercase font-mono">Monthly recurring revenue</p>
            <p className="text-lg font-extrabold text-amber-400">
              {formatPkrCare(revenue.monthlyRecurringRevenue)}
            </p>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
            <CalendarClock className="w-4 h-4 text-orange-400 mb-2" />
            <p className="text-[10px] text-slate-500 uppercase font-mono">Expiring this month</p>
            <p className="text-xl font-extrabold">{revenue.expiringThisMonth}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["active", "expired", "renewals"] as Segment[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSegment(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
              segment === s ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-400"
            }`}
          >
            {s === "active" ? "Active subscribers" : s === "expired" ? "Expired" : "Upcoming renewals"}
          </button>
        ))}
      </div>

      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
      ) : subscriptions.length === 0 ? (
        <p className="text-sm text-slate-500">No subscriptions in this segment.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-left border-b border-slate-800">
                <th className="py-2 pr-3">Customer</th>
                <th className="py-2 pr-3">Plan</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Renewal</th>
                <th className="py-2">Credits</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id} className="border-b border-slate-800/60">
                  <td className="py-2 pr-3 font-mono">{s.customerId}</td>
                  <td className="py-2 pr-3">{s.planName || s.planId}</td>
                  <td className="py-2 pr-3">{s.status}</td>
                  <td className="py-2 pr-3">{s.renewalDate}</td>
                  <td className="py-2">
                    {s.serviceCreditsUsed}/{s.serviceCreditsLimit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={saveReport} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
        <h4 className="text-sm font-bold">Create before/after visit report</h4>
        <input
          required
          placeholder="Customer ID"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            placeholder="Technician name"
            value={technician}
            onChange={(e) => setTechnician(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="date"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
          />
          <input
            placeholder="Before photo URL"
            value={beforeUrl}
            onChange={(e) => setBeforeUrl(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="After photo URL"
            value={afterUrl}
            onChange={(e) => setAfterUrl(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm col-span-2"
          />
        </div>
        <textarea
          placeholder="Performance improvement notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-extrabold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Publish report"}
        </button>
        {msg && <p className="text-xs text-slate-400">{msg}</p>}
      </form>
    </div>
  );
}
