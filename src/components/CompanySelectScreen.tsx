import React, { useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { selectCompany, type LoginCompany } from "../services/api";
import type { User } from "../types";

/** Shown after sign-in to a user who works for several companies (and from "Switch company"). One tap picks the company this session acts for. */
export default function CompanySelectScreen({ companies, currentCompanyId, onSelected, onCancel }: {
  companies: LoginCompany[];
  currentCompanyId?: string | null;
  onSelected: (user: User, companyId: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choose = async (c: LoginCompany) => {
    setBusy(c.id); setError(null);
    try {
      const { user, companyId } = await selectCompany(c.id);
      await onSelected(user, companyId);
    } catch (e: any) {
      setError(e?.message || "Could not select the company.");
    } finally { setBusy(null); }
  };
  return (
    <main className="min-h-screen grid place-items-center bg-slate-950 px-6 text-slate-100" data-testid="company-select">
      <section className="w-full max-w-md space-y-4">
        <header className="text-center space-y-1">
          <h1 className="text-xl font-bold">Choose a company</h1>
          <p className="text-sm text-slate-400">You work for more than one company. Pick the one to open.</p>
        </header>
        <ul className="space-y-2" role="list">
          {companies.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-testid={`company-option-${c.id}`}
                disabled={busy !== null}
                onClick={() => void choose(c)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-left hover:border-amber-400/60 disabled:opacity-60"
              >
                <Building2 className="h-5 w-5 text-amber-300" aria-hidden="true" />
                <span className="flex-1">
                  <span className="block font-bold">{c.name}</span>
                  <span className="block text-xs text-slate-400">{c.role}{c.id === currentCompanyId ? " · current" : ""}</span>
                </span>
                {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Opening" /> : null}
              </button>
            </li>
          ))}
        </ul>
        {error ? <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
        {onCancel ? <button type="button" onClick={onCancel} className="min-h-11 w-full text-sm text-slate-400">Cancel</button> : null}
      </section>
    </main>
  );
}
