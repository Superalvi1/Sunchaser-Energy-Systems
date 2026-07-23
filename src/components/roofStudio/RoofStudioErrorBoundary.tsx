/**
 * Error boundary for Roof Studio / Project Design Workspace.
 * Shows a useful inline error instead of a black screen.
 */

import React from "react";

type Props = {
  children: React.ReactNode;
  title?: string;
};

type State = {
  error: Error | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default class RoofStudioErrorBoundary extends (React.Component as any) {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Keep console visible for debugging; do not swallow silently.
    console.error("[RoofStudioErrorBoundary]", error);
  }

  render() {
    const self = this as unknown as { state: State; props: Props; setState: (s: Partial<State>) => void };
    const { error } = self.state;
    if (!error) return self.props.children;

    const message = error?.message || String(error);
    return (
      <div
        className="rounded-2xl border border-rose-500/40 bg-slate-950/90 px-4 py-6 text-left"
        data-testid="roof-studio-error-boundary"
        role="alert"
      >
        <p className="text-sm font-bold text-rose-300">
          {self.props.title || "Roof Studio failed to render"}
        </p>
        <p className="mt-2 text-xs text-slate-300 break-words font-mono">{message}</p>
        <p className="mt-3 text-[11px] text-slate-500">
          Sales Advisor and other modules are unaffected. Try another lead, or reload after fixing the error above.
        </p>
        <button
          type="button"
          className="mt-4 rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-slate-200 hover:bg-slate-800"
          onClick={() => self.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
