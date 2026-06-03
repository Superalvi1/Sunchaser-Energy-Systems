import React, { useEffect, useState } from "react";
import { Loader2, Shield, Send } from "lucide-react";
import { User } from "../types";
import { fetchCustomerPortalWarranties, submitCustomerWarrantyClaim } from "../services/api";
import { WARRANTY_COMPONENT_TYPES } from "../lib/clientPortalPhase2";

interface ClientPortalWarrantiesProps {
  user: User;
}

function statusColor(status: string) {
  if (status === "Active") return "text-emerald-400 border-emerald-900/50 bg-emerald-950/30";
  if (status === "Expiring Soon") return "text-amber-400 border-amber-900/50 bg-amber-950/30";
  if (status === "Expired") return "text-rose-400 border-rose-900/50 bg-rose-950/30";
  return "text-slate-500 border-slate-800 bg-slate-950/50";
}

export default function ClientPortalWarranties({ user }: ClientPortalWarrantiesProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [component, setComponent] = useState(WARRANTY_COMPONENT_TYPES[0].label);
  const [issueDescription, setIssueDescription] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCustomerPortalWarranties(user.id, user.username);
      setCards(data.cards || []);
    } catch (err: any) {
      setError(err.message || "Unable to load warranties.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user.id, user.username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      await submitCustomerWarrantyClaim(user.id, user.username, {
        component,
        issueDescription,
        photoUrl: photoUrl || undefined,
      });
      setSubmitMsg("Warranty support request submitted. Our team will contact you soon.");
      setIssueDescription("");
      setPhotoUrl("");
      setShowForm(false);
    } catch (err: any) {
      setSubmitMsg(err.message || "Failed to submit claim.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-8 w-8 text-amber-500 animate-spin mx-auto" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-rose-400 text-center">{error}</p>;
  }

  return (
    <section className="space-y-4">
      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 px-1">
        Warranty Center
      </h3>

      <div className="grid grid-cols-1 gap-3">
        {cards.map((card) => {
          const w = card.warranty;
          const status = w?.status || "Not available yet";
          return (
            <div key={card.type} className="bg-slate-900 border border-slate-800 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-500" />
                  <p className="text-sm font-bold text-white">{card.label}</p>
                </div>
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg border ${statusColor(status)}`}
                >
                  {status}
                </span>
              </div>
              {w ? (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400">
                  <div>
                    <dt className="text-slate-600">Brand / model</dt>
                    <dd className="text-slate-300">
                      {[w.brand, w.model].filter(Boolean).join(" ") || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-600">Serial</dt>
                    <dd className="text-slate-300">{w.serialNumber || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-600">Start</dt>
                    <dd className="text-slate-300">{w.startDate || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-600">Expiry</dt>
                    <dd className="text-slate-300">{w.endDate || "—"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-600">Remaining</dt>
                    <dd className="text-amber-400/90">{w.remainingLabel}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-xs text-slate-500 mt-2 font-mono">Not available yet</p>
              )}
            </div>
          );
        })}
      </div>

      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm py-3 rounded-xl flex items-center justify-center gap-2"
        >
          <Send className="w-4 h-4" />
          Request Warranty Support
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-bold text-white">Warranty support request</p>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Component</label>
            <select
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            >
              {WARRANTY_COMPONENT_TYPES.map((c) => (
                <option key={c.type} value={c.label}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Issue description</label>
            <textarea
              required
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              rows={4}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-slate-500 uppercase">Photo URL (optional)</label>
            <input
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="w-full mt-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm"
              placeholder="https://..."
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="flex-1 py-2 rounded-xl border border-slate-700 text-slate-400 text-sm font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 py-2 rounded-xl bg-amber-500 text-slate-950 text-sm font-extrabold disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Submit"}
            </button>
          </div>
        </form>
      )}

      {submitMsg && <p className="text-xs text-center text-amber-400 font-mono">{submitMsg}</p>}
    </section>
  );
}
