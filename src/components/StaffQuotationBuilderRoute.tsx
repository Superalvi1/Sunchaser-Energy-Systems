import React, { useEffect, useState } from "react";
import { LoaderCircle, LockKeyhole, ShieldX } from "lucide-react";
import type { User } from "../types";
import { restoreAuthSession } from "../lib/authSession";
import { canUseStaffQuote } from "../lib/staffQuotationAccess";
import AuthHub from "./AuthHub";
import PublicQuotationBuilderPage from "./PublicQuotationBuilderPage";

export default function StaffQuotationBuilderRoute() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void restoreAuthSession().then(({ user: restoredUser }) => {
      if (cancelled) return;
      setUser(restoredUser);
      setCheckingSession(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (checkingSession) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-slate-100">
        <div role="status" className="flex items-center gap-3 text-sm font-semibold text-slate-300">
          <LoaderCircle className="h-5 w-5 animate-spin text-amber-400" />
          Checking your secure staff session…
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
        <div className="mx-auto mb-4 flex max-w-md items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <div className="font-black">Private staff quotation</div>
            <p className="mt-1 leading-5 text-amber-100/80">Sign in with a staff account to create quotations without mandatory client details.</p>
          </div>
        </div>
        <AuthHub onLoginSuccess={setUser} />
      </main>
    );
  }

  if (!canUseStaffQuote(user.role)) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 px-4 text-slate-100">
        <section className="w-full max-w-md rounded-3xl border border-red-500/30 bg-slate-900 p-7 text-center shadow-xl">
          <ShieldX className="mx-auto h-10 w-10 text-red-400" />
          <h1 className="mt-4 text-xl font-black">Staff access required</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">Customer accounts cannot use the private quotation builder. Please use the public Smart Quote instead.</p>
          <a href="https://smartquote.sunchaserenergy.co/quote" className="mt-5 inline-flex min-h-12 items-center justify-center rounded-xl bg-amber-400 px-5 font-black text-slate-950">
            Open public Smart Quote
          </a>
        </section>
      </main>
    );
  }

  return <PublicQuotationBuilderPage mode="staff" />;
}
