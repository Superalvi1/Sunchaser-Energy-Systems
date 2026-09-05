import {
  AlertTriangle,
  CheckCircle2,
  Phone,
  RefreshCw,
  Shield,
  Smartphone,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  disconnectWhatsAppConnection,
  fetchEmbeddedSignupState,
  fetchWhatsAppConnectionStatus,
  fetchWhatsAppOnboardingDiagnostics,
  submitEmbeddedSignup,
  testWhatsAppConnection,
} from "../api/inboxApi";
import {
  extractEmbeddedSignupProviderError,
  launchMetaEmbeddedSignup,
  logMetaEmbeddedSignupDebug,
  sanitizeEmbeddedSignupError,
} from "../lib/metaEmbeddedSignup";
import type {
  WhatsAppConnectionStatusPayload,
  WhatsAppConnectionTestResult,
} from "../types";

type WhatsAppConnectionPanelProps = {
  isAdmin: boolean;
  onClose?: () => void;
};


function metaStatusLabel(status: WhatsAppConnectionStatusPayload["status"]): string {
  switch (status) {
    case "DISCONNECTED":
      return "Disconnected";
    case "CONNECTING":
      return "Connecting";
    case "CONNECTED":
      return "Connected";
    case "TOKEN_EXPIRED":
      return "Token Expired";
    case "WEBHOOK_PENDING":
      return "Webhook Pending";
    case "ERROR":
      return "Error";
    default:
      return status;
  }
}

export default function WhatsAppConnectionPanel({
  isAdmin,
  onClose,
}: WhatsAppConnectionPanelProps) {
  const [metaStatus, setMetaStatus] = useState<WhatsAppConnectionStatusPayload | null>(
    null
  );
  const [webhookCallbackUrl, setWebhookCallbackUrl] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<WhatsAppConnectionTestResult | null>(
    null
  );
  const [metaError, setMetaError] = useState<string | null>(null);
  const [showMetaAdvanced, setShowMetaAdvanced] = useState(true);
  const activeStateRef = useRef<string | null>(null);

  const loadMetaStatus = async () => {
    try {
      setMetaLoading(true);
      setMetaError(null);
      const [data, diagnostics] = await Promise.all([
        fetchWhatsAppConnectionStatus(),
        fetchWhatsAppOnboardingDiagnostics().catch(() => null),
      ]);
      setMetaStatus(data);
      if (diagnostics) {
        setWebhookCallbackUrl(diagnostics.webhookCallbackUrl);
      }
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Failed to load Meta status");
    } finally {
      setMetaLoading(false);
    }
  };

  useEffect(() => {
    void loadMetaStatus();
  }, []);


  const handleLaunchEmbeddedSignup = async () => {
    setConnecting(true);
    setMetaError(null);
    activeStateRef.current = null;

    try {
      const { state } = await fetchEmbeddedSignupState();
      if (!state || !String(state).trim()) {
        throw new Error("OAuth state was not issued by the server");
      }
      activeStateRef.current = state;

      const signup = await launchMetaEmbeddedSignup({ state });

      const attemptState = signup.state || activeStateRef.current;
      if (!attemptState) {
        throw new Error("OAuth state for this attempt is no longer available");
      }

      const updated = await submitEmbeddedSignup({
        code: signup.code,
        wabaId: signup.wabaId,
        phoneNumberId: signup.phoneNumberId,
        state: attemptState,
        ...(signup.businessId ? { businessId: signup.businessId } : {}),
      });
      setMetaStatus(updated);
    } catch (err) {
      logMetaEmbeddedSignupDebug(
        "WhatsAppConnectionPanel.handleLaunchEmbeddedSignup.catch",
        extractEmbeddedSignupProviderError(err)
      );
      setMetaError(sanitizeEmbeddedSignupError(err));
    } finally {
      activeStateRef.current = null;
      setConnecting(false);
    }
  };

  const handleMetaDisconnect = async () => {
    setDisconnecting(true);
    setMetaError(null);
    try {
      const updated = await disconnectWhatsAppConnection();
      setMetaStatus(updated);
      setTestResult(null);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setMetaError(null);
    try {
      const result = await testWhatsAppConnection();
      setTestResult(result);
      setMetaStatus(result.status);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-4 text-xs text-[var(--inbox-muted)]">
        Only Admin users can view and manage WhatsApp connection settings.
      </div>
    );
  }

  const showMetaDisconnect =
    metaStatus?.status === "CONNECTED" ||
    metaStatus?.status === "WEBHOOK_PENDING" ||
    metaStatus?.status === "TOKEN_EXPIRED" ||
    metaStatus?.status === "ERROR";

  return (
    <div className="space-y-4 rounded-xl border border-[var(--inbox-border)] bg-[var(--inbox-surface)] p-5 text-[var(--inbox-fg)] shadow-lg">
      <div className="flex items-center justify-between border-b border-[var(--inbox-border)] pb-3">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-emerald-500" />
          <h2 className="text-sm font-semibold">WhatsApp Connection</h2>
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

      {/* Meta Embedded Signup (official Cloud API onboarding) */}
      <section className="space-y-2">
        <button
          type="button"
          onClick={() => {
            const next = !showMetaAdvanced;
            setShowMetaAdvanced(next);
            if (next && !metaStatus) void loadMetaStatus();
          }}
          className="flex w-full items-center justify-between text-left text-[11px] text-[var(--inbox-muted)] hover:text-[var(--inbox-fg)]"
        >
          <span>Connect WhatsApp Business</span>
          <span>{showMetaAdvanced ? "Hide" : "Show"}</span>
        </button>

        {showMetaAdvanced ? (
          <div className="space-y-3 opacity-80">
            {metaLoading ? (
              <div className="text-xs text-[var(--inbox-muted)]">Loading Meta status...</div>
            ) : metaError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-400">
                {metaError}
              </div>
            ) : metaStatus ? (
              <>
                <div className="text-xs">
                  Meta status: <strong>{metaStatusLabel(metaStatus.status)}</strong>
                </div>
                {testResult ? (
                  <div className="text-[11px] text-[var(--inbox-muted)]">{testResult.summary}</div>
                ) : null}
                {webhookCallbackUrl ? (
                  <div className="space-y-1 text-[10px] text-[var(--inbox-muted)]">
                    <div>Webhook callback URL</div>
                    <div className="break-all font-mono">{webhookCallbackUrl}</div>
                  </div>
                ) : (
                  <div className="text-[10px] text-[var(--inbox-muted)]">
                    Webhook callback URL is shown after Meta diagnostics load.
                  </div>
                )}
              </>
            ) : null}

            <button
              type="button"
              disabled={connecting || disconnecting || testing}
              onClick={() => void handleLaunchEmbeddedSignup()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--inbox-border)] px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {connecting ? "Connecting to Meta..." : "Connect via Meta Embedded Signup"}
            </button>
            <button
              type="button"
              disabled={connecting || disconnecting || testing}
              onClick={() => void handleTestConnection()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--inbox-border)] px-4 py-2 text-xs font-semibold disabled:opacity-50"
            >
              {testing ? "Testing..." : "Test Meta Connection"}
            </button>
            {showMetaDisconnect ? (
              <button
                type="button"
                disabled={connecting || disconnecting || testing}
                onClick={() => void handleMetaDisconnect()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--inbox-border)] px-4 py-2 text-xs font-semibold disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting..." : "Disconnect Meta"}
              </button>
            ) : null}
            <p className="text-center text-[10px] text-[var(--inbox-muted)]">
              Connect your WhatsApp Business account securely using Meta Embedded
              Signup. Your existing WhatsApp Business app remains available when using
              supported coexistence.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
