import { AlertTriangle, CheckCircle2, Phone, RefreshCw, Shield, Smartphone, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  disconnectWhatsAppConnection,
  fetchEmbeddedSignupState,
  fetchWhatsAppConnectionStatus,
  submitEmbeddedSignup,
} from "../api/inboxApi";
import {
  launchMetaEmbeddedSignup,
  sanitizeEmbeddedSignupError,
} from "../lib/metaEmbeddedSignup";
import type { WhatsAppConnectionStatusPayload } from "../types";

type WhatsAppConnectionPanelProps = {
  isAdmin: boolean;
  onClose?: () => void;
};

export default function WhatsAppConnectionPanel({
  isAdmin,
  onClose,
}: WhatsAppConnectionPanelProps) {
  const [status, setStatus] = useState<WhatsAppConnectionStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Attempt-scoped OAuth state — never localStorage. */
  const activeStateRef = useRef<string | null>(null);

  const loadStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchWhatsAppConnectionStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connection status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const handleLaunchEmbeddedSignup = async () => {
    setConnecting(true);
    setError(null);
    activeStateRef.current = null;

    try {
      const { state } = await fetchEmbeddedSignupState();
      if (!state || !String(state).trim()) {
        throw new Error("OAuth state was not issued by the server");
      }
      activeStateRef.current = state;

      const signup = await launchMetaEmbeddedSignup({ state });

      const attemptState = activeStateRef.current;
      if (!attemptState) {
        throw new Error("OAuth state for this attempt is no longer available");
      }

      const updated = await submitEmbeddedSignup({
        code: signup.code,
        wabaId: signup.wabaId,
        phoneNumberId: signup.phoneNumberId,
        state: attemptState,
      });
      setStatus(updated);
    } catch (err) {
      setError(sanitizeEmbeddedSignupError(err));
    } finally {
      activeStateRef.current = null;
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      const updated = await disconnectWhatsAppConnection();
      setStatus(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-4 text-xs text-[var(--inbox-muted)]">
        Only Admin users can view and manage WhatsApp Business App Connection settings.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--inbox-border)] bg-[var(--inbox-surface)] p-5 text-[var(--inbox-fg)] shadow-lg">
      <div className="flex items-center justify-between border-b border-[var(--inbox-border)] pb-3">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-emerald-500" />
          <h2 className="text-sm font-semibold">WhatsApp Business App Coexistence</h2>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--inbox-muted)] hover:text-[var(--inbox-fg)]"
          >
            Close
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-[var(--inbox-muted)]">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Checking Meta Cloud API connection...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
          <div className="flex items-center gap-1.5 font-medium">
            <XCircle className="h-4 w-4" />
            Connection Error
          </div>
          <p className="mt-1 text-[11px] opacity-90">{error}</p>
          <button
            type="button"
            onClick={() => void loadStatus()}
            className="mt-2 text-xs font-semibold underline hover:no-underline"
          >
            Retry Check
          </button>
        </div>
      ) : status ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--inbox-surface-2)] p-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[var(--inbox-muted)]">
                Status
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 font-semibold">
                {status.status === "CONNECTED" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="text-emerald-400">Connected</span>
                  </>
                ) : status.status === "REAUTHORIZATION_REQUIRED" ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <span className="text-amber-400">Reauthorization Required</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-zinc-400" />
                    <span className="text-zinc-400">{status.status}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 border border-emerald-500/20">
                Mode: {status.connectionMode}
              </span>
            </div>
          </div>

          {status.revokeWarning ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-[11px] text-amber-300">
              {status.revokeWarning}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--inbox-border)] p-2.5">
              <div className="text-[11px] text-[var(--inbox-muted)]">WABA Account ID</div>
              <div className="font-mono text-[11px]">
                {status.wabaIdMasked || "Not configured"}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--inbox-border)] p-2.5">
              <div className="text-[11px] text-[var(--inbox-muted)]">Phone Number ID</div>
              <div className="font-mono text-[11px]">
                {status.phoneNumberIdMasked || "Not configured"}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--inbox-border)] p-2.5">
              <div className="text-[11px] text-[var(--inbox-muted)]">Connected Phone</div>
              <div className="flex items-center gap-1 font-mono text-[11px]">
                <Phone className="h-3 w-3 text-emerald-400" />
                {status.phoneNumberMasked || "Not configured"}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--inbox-border)] p-2.5">
              <div className="text-[11px] text-[var(--inbox-muted)]">Webhook Health</div>
              <div className="capitalize text-[11px]">
                {status.webhookHealth} {status.lastWebhookAt ? `(Active)` : "(No pings yet)"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-[var(--inbox-muted)]">
            <Shield className="h-3.5 w-3.5 text-emerald-400" />
            Secrets & Access Tokens are securely stored server-side and redacted.
          </div>

          <div className="pt-2 border-t border-[var(--inbox-border)] space-y-2">
            <button
              type="button"
              disabled={connecting || disconnecting}
              onClick={() => void handleLaunchEmbeddedSignup()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 shadow-md"
            >
              {connecting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Connecting to Meta Cloud API...
                </>
              ) : (
                <>
                  <Smartphone className="h-4 w-4" />
                  Connect Existing WhatsApp Business Number
                </>
              )}
            </button>
            {status.status === "CONNECTED" || status.status === "REAUTHORIZATION_REQUIRED" ? (
              <button
                type="button"
                disabled={connecting || disconnecting}
                onClick={() => void handleDisconnect()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--inbox-border)] px-4 py-2 text-xs font-semibold text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface-2)] disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting..." : "Disconnect WhatsApp"}
              </button>
            ) : null}
            <p className="mt-1.5 text-center text-[10px] text-[var(--inbox-muted)]">
              Launches Meta Embedded Signup in Coexistence mode. The WhatsApp Business iPhone app remains active.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
