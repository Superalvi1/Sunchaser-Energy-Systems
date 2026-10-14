import React, { useCallback, useEffect, useState } from "react";
import { platformRequest } from "../services/api";

type Row = {
  id: string; name: string; status: string; overdue: boolean; paidPkr: number;
  subscription: null | { status: string; planId: string; planName?: string; periodEnd?: string; trialEndsAt?: string };
  usage: { staff: number; leads: number; documents: number };
  limits: { max_staff: number | null; max_leads: number | null; max_documents: number | null; max_storage_mb?: number | null };
};
const lim = (v: number | null) => (v == null ? "∞" : String(v));
const inputCls = "min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100";
const btnCls = "min-h-11 rounded-lg bg-amber-400 px-4 text-sm font-bold text-slate-950 disabled:opacity-60";
const ghostCls = "min-h-9 rounded-lg border border-slate-700 px-3 text-xs font-bold text-slate-200 hover:border-amber-400/60";

/** Operator console (platform administrators only; the server refuses everyone else). Operator-led onboarding, manual subscriptions, limits. */
export default function PlatformConsole({ onExit }: { onExit?: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [plans, setPlans] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; username: string; password: string } | null>(null);
  const [form, setForm] = useState({ name: "", ownerName: "", ownerUsername: "", ownerEmail: "", planId: "pilot", trialDays: "14", storageLimitMb: "" });
  const [pay, setPay] = useState<{ id: string; amount: string; method: string; reference: string; coversTo: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, p] = await Promise.all([platformRequest<{ companies: Row[] }>("/overview"), platformRequest<{ plans: Array<{ id: string; name: string }> }>("/plans")]);
      setRows(o.companies); setPlans(p.plans); setError(null);
    } catch (e: any) { setError(e?.message || "Could not load."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<void>, ok: string) => {
    setError(null); setNotice(null);
    try { await fn(); setNotice(ok); await load(); } catch (e: any) { setError(e?.message || "Failed."); }
  };
  const create = (e: React.FormEvent) => { e.preventDefault(); void act(async () => {
    const r = await platformRequest<any>("/companies", "POST", { ...form, trialDays: Number(form.trialDays), storageLimitMb: Number(form.storageLimitMb) });
    setSecret({ title: `Administrator of ${form.name}`, username: r.owner.username, password: r.owner.temporaryPassword });
    setForm({ name: "", ownerName: "", ownerUsername: "", ownerEmail: "", planId: form.planId, trialDays: "14", storageLimitMb: "" });
  }, "Company created."); };
  const setStatus = (id: string, status: string) => void act(async () => { await platformRequest(`/companies/${id}`, "PATCH", { status }); }, `Company ${status}.`);
  const submitPay = (e: React.FormEvent) => { e.preventDefault(); if (!pay) return; void act(async () => {
    await platformRequest(`/companies/${pay.id}/payments`, "POST", { amountPkr: Number(pay.amount), method: pay.method, reference: pay.reference, paidAt: new Date().toISOString().slice(0, 10), coversTo: pay.coversTo || undefined });
    setPay(null);
  }, "Payment recorded."); };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100" data-testid="platform-console">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center justify-between gap-3">
          <div><h1 className="text-xl font-bold">Platform console</h1><p className="text-xs text-slate-400">Operator-led onboarding · manual subscriptions · plan limits</p></div>
          {onExit ? <button className={ghostCls} onClick={onExit}>Back to CRM</button> : null}
        </header>
        {error ? <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
        {notice ? <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</p> : null}
        {secret ? (
          <section className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-4 space-y-1" data-testid="temp-password">
            <h2 className="font-bold">{secret.title}</h2>
            <p className="text-sm">Username <code className="font-mono">{secret.username}</code> · temporary password <code className="font-mono" data-testid="temp-password-value">{secret.password}</code></p>
            <p className="text-xs text-amber-200">Shown once. Give it to the administrator over a private channel; they should set a new password at first sign-in.</p>
            <button className={ghostCls} onClick={() => setSecret(null)}>I have noted it</button>
          </section>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-400">Companies</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm" data-testid="companies-table">
              <thead className="bg-slate-900 text-xs text-slate-400"><tr><th className="p-2">Company</th><th>Status</th><th>Plan</th><th>Period end</th><th>Staff</th><th>Leads</th><th>Docs</th><th>Storage MB</th><th>Paid (PKR)</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-800" data-testid={`company-row-${r.id}`}>
                    <td className="p-2"><div className="font-bold">{r.name}</div><div className="text-xs text-slate-500">{r.id}</div></td>
                    <td>{r.status}{r.overdue ? <span className="ml-1 rounded bg-red-500/20 px-1 text-xs text-red-200">overdue</span> : null}</td>
                    <td>{r.subscription ? (r.subscription.planName || r.subscription.planId) : "—"}</td>
                    <td>{r.subscription?.periodEnd || "—"}</td>
                    <td>{r.usage.staff}/{lim(r.limits.max_staff)}</td><td>{r.usage.leads}/{lim(r.limits.max_leads)}</td><td>{r.usage.documents}/{lim(r.limits.max_documents)}</td><td>{lim(r.limits.max_storage_mb ?? null)}</td>
                    <td>{r.paidPkr.toLocaleString()}</td>
                    <td className="space-x-1 p-2 text-right whitespace-nowrap">
                      {r.id !== "sunchaser" ? (<>
                        <button className={ghostCls} onClick={() => setPay({ id: r.id, amount: "", method: "Bank transfer", reference: "", coversTo: "" })}>Record payment</button>
                        {r.status === "suspended" ? <button className={ghostCls} onClick={() => setStatus(r.id, "active")}>Reactivate</button> : <button className={ghostCls} onClick={() => setStatus(r.id, "suspended")}>Suspend</button>}
                      </>) : <span className="text-xs text-slate-500">founding company</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {pay ? (
          <form onSubmit={submitPay} className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4" data-testid="payment-form">
            <h2 className="font-bold">Record a payment for {pay.id}</h2>
            <div className="grid gap-2 sm:grid-cols-4">
              <input className={inputCls} required type="number" min="1" placeholder="Amount (PKR)" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} aria-label="Amount" />
              <input className={inputCls} required placeholder="Method" value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} aria-label="Method" />
              <input className={inputCls} placeholder="Reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} aria-label="Reference" />
              <input className={inputCls} type="date" value={pay.coversTo} onChange={(e) => setPay({ ...pay, coversTo: e.target.value })} aria-label="Covers until" />
            </div>
            <div className="flex gap-2"><button className={btnCls} type="submit">Save payment</button><button type="button" className={ghostCls} onClick={() => setPay(null)}>Cancel</button></div>
          </form>
        ) : null}

        <form onSubmit={create} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4" data-testid="create-company-form">
          <h2 className="font-bold">Onboard a company</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputCls} required placeholder="Company name" aria-label="Company name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={inputCls} required placeholder="Administrator's name" aria-label="Administrator name" value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
            <input className={inputCls} required placeholder="Administrator username" aria-label="Administrator username" value={form.ownerUsername} onChange={(e) => setForm({ ...form, ownerUsername: e.target.value })} />
            <input className={inputCls} required type="email" placeholder="Administrator e-mail" aria-label="Administrator e-mail" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
            <select className={inputCls} aria-label="Plan" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <input className={inputCls} required type="number" min="1" step="1" placeholder="Storage limit (MB), required" aria-label="Storage limit (MB)" value={form.storageLimitMb} onChange={(e) => setForm({ ...form, storageLimitMb: e.target.value })} />
            <input className={inputCls} type="number" min="0" max="365" aria-label="Trial days" value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />
          </div>
          <button className={btnCls} type="submit">Create company</button>
        </form>
      </div>
    </main>
  );
}
