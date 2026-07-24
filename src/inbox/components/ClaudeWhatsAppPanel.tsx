import { AlertTriangle, Power, QrCode, RefreshCw, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  fetchClaudeWhatsAppStatus,
  setClaudeWhatsAppEnabled,
  reconnectClaudeWhatsApp,
} from "../api/inboxApi";
import type { ClaudeWhatsAppStatusPayload } from "../types";

type ClaudeWhatsAppPanelProps = {
  isAdmin: boolean;
  onClose?: () => void;
};

function liveStatusLabel(status: ClaudeWhatsAppStatusPayload["status"]): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "awaiting_qr":
      return "Awaiting QR scan";
    case "disconnected":
      return "Disconnected";
    default:
      return status;
  }
}

export default function ClaudeWhatsAppPanel({
  isAdmin,
  onClose,
}: ClaudeWhatsAppPanelProps) {
  const [status, setStatus] = useState<ClaudeWhatsAppStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchClaudeWhatsAppStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      void load();
    }, 2000);
    return () => clearInterval(id);
  }, [load]);

  const handleToggle = async (enabled: boolean) => {
    if (!isAdmin) return;
    setToggling(true);
    setError(null);
    try {
      const data = await setClaudeWhatsAppEnabled(enabled);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update kill switch");
    } finally {
      setToggling(false);
    }
  };

  const handleReconnect = async () => {
    if (!isAdmin) return;
    setReconnecting(true);
    setError(null);
    try {
      const data = await reconnectClaudeWhatsApp();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request new QR");
    } finally {
      setReconnecting(false);
    }
  };

  const enabled = status?.enabled === true;
  const disconnectHint =
    status?.disconnectKind === "logged_out"
      ? "Logged out — re-scan QR required"
      : status?.disconnectKind === "reconnecting"
        ? "Temporarily disconnected — reconnecting…"
        : null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-[var(--inbox-surface)] p-4 shadow-lg">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
            <ShieldAlert className="h-3 w-3" />
            Unofficial · Live test · Distinct from Coexistence
          </div>
          <h2 className="text-sm font-semibold text-amber-300">Claude WhatsApp</h2>
          <p className="mt-0.5 text-[11px] text-[var(--inbox-muted)]">
            WhatsApp Web (Baileys) — temporary while Meta Business Verification is pending.
            Not the Cloud API / Coexistence path.
          </p>
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

      {error && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading && !status ? (
        <p className="text-xs text-[var(--inbox-muted)]">Loading…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                  status?.status === "connected"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    : status?.status === "awaiting_qr"
                      ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                      : "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
                }`}
              >
                {liveStatusLabel(status?.status ?? "disconnected")}
              </span>
              {status?.phoneNumber && (
                <span className="text-xs text-[var(--inbox-muted)]">
                  +{status.phoneNumber}
                </span>
              )}
            </div>

            {disconnectHint && (
              <p className="inline-flex items-start gap-1.5 text-xs text-yellow-300/90">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {disconnectHint}
              </p>
            )}

            {status?.lastError && (
              <p className="text-xs text-[var(--inbox-muted)]">{status.lastError}</p>
            )}

            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-amber-200">
                    Claude WhatsApp: {enabled ? "ON" : "OFF"}
                  </p>
                  <p className="text-[10px] text-[var(--inbox-muted)]">
                    Kill switch — takes effect within a few seconds, no redeploy.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!isAdmin || toggling}
                  onClick={() => void handleToggle(!enabled)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                    enabled
                      ? "bg-red-600 text-white hover:bg-red-500"
                      : "bg-amber-600 text-white hover:bg-amber-500"
                  }`}
                >
                  <Power className="h-3.5 w-3.5" />
                  {toggling ? "…" : enabled ? "Turn OFF" : "Turn ON"}
                </button>
              </div>
            </div>

            {isAdmin && (
              <button
                type="button"
                disabled={reconnecting}
                onClick={() => void handleReconnect()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${reconnecting ? "animate-spin" : ""}`}
                />
                Request new QR / re-pair
              </button>
            )}
          </div>

          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-amber-500/30 bg-black/20 p-3">
            {status?.qrDataUrl ? (
              <>
                <img
                  src={status.qrDataUrl}
                  alt="Claude WhatsApp pairing QR"
                  className="h-[180px] w-[180px] rounded bg-white p-1"
                />
                <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-amber-300/80">
                  <QrCode className="h-3 w-3" />
                  Scan with WhatsApp → Linked Devices
                </p>
              </>
            ) : (
              <div className="flex h-[180px] w-[180px] flex-col items-center justify-center text-center text-[11px] text-[var(--inbox-muted)]">
                <QrCode className="mb-2 h-8 w-8 opacity-40" />
                {status?.status === "connected"
                  ? "Paired — no QR needed"
                  : enabled
                    ? "Waiting for QR…"
                    : "Turn ON to start pairing"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
