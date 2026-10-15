import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from '../types';
import { clearAuthSession } from '../services/api';
import { SESSION_EXPIRED_EVENT, SESSION_RESTORED_EVENT } from '../lib/sessionRecovery';
import AuthHub from './AuthHub';

type InterruptedUser = Pick<User, 'id' | 'username' | 'role'>;
/** Keep the workspace mounted so a rejected save does not discard its draft. */
export default function SessionReauthentication() {
  const [interrupted, setInterrupted] = useState<InterruptedUser | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const expired = (event: Event) => {
      const user = (event as CustomEvent<InterruptedUser>).detail;
      if (user?.id) setInterrupted(previous => previous || user);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, []);
  useEffect(() => {
    if (!interrupted) return;
    const root = document.getElementById('root');
    const wasInert = root?.hasAttribute('inert');
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    root?.setAttribute('inert', ''); document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); return; }
      if (event.key !== 'Tab') return;
      const container: HTMLDivElement | null = panel.current;
      const inputs = container ? Array.from(container.querySelectorAll<HTMLElement>('input:not([disabled]),button:not([disabled]),a[href],select:not([disabled]),textarea:not([disabled])')).filter(el => el.getClientRects().length) : [];
      const first = inputs[0], last = inputs[inputs.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => {
      if (!wasInert) root?.removeAttribute('inert');
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trap);
      previousFocus?.focus();
    };
  }, [interrupted]);
  if (!interrupted || typeof document === 'undefined') return null;
  const resume = (user: User) => {
    // A different account or changed role must never see the previous workspace.
    if (user.id !== interrupted.id || user.role !== interrupted.role) { window.location.reload(); return; }
    setInterrupted(null);
    window.dispatchEvent(new Event(SESSION_RESTORED_EVENT));
  };
  return createPortal(<div className="fixed inset-0 z-[20000] overflow-y-auto bg-slate-950 p-4 text-slate-100" role="dialog" aria-modal="true" aria-labelledby="session-sign-in-title">
    <div ref={panel} className="mx-auto max-w-lg py-6">
      <section className="mb-4 rounded-2xl border border-amber-400/40 bg-amber-400/10 p-5">
        <h1 id="session-sign-in-title" className="text-xl font-bold">Sign in again to continue</h1>
        <p className="mt-2 text-sm text-amber-100">Your secure session is no longer accepted. Sign in as {interrupted.username} to return to this screen. Unsaved changes stay open; retry your action after signing in.</p>
      </section>
      <AuthHub initialUsername={interrupted.username} onLoginSuccess={resume} />
      <button type="button" onClick={() => { clearAuthSession(); window.location.reload(); }} className="mt-4 min-h-12 w-full rounded-xl border border-slate-600">Sign out instead</button>
    </div>
  </div>, document.body);
}
