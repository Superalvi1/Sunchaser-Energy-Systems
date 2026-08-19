/**
 * Admin WhatsApp Connection — coexistence, QR, sync, diagnostics, Meta checklist.
 * Separate from WhatsApp Inbox so connection controls never block Inbox access.
 */
import {
  CheckCircle2,
  Copy,
  RefreshCw,
  Smartphone,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import type { User } from "../../types";
import {
  disconnectWhatsAppConnection,
  fetchEmbeddedSignupState,
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
  WhatsAppConnectionTestResult,
  WhatsAppOnboardingDiagnostics,
} from "../types";
import WhatsAppConnectionPanel from "./WhatsAppConnectionPanel";

type WhatsAppSetupPageProps = {
  staffUser: User;
};

function isAdminRole(role: string): boolean {
  return role === "Super Admin" || role === "Admin";
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

export default function WhatsAppSetupPage({ staffUser }: WhatsAppSetupPageProps) {
  const isAdmin = isAdminRole(staffUser.role);
  const [diagnostics, setDiagnostics] =
    useState<WhatsAppOnboardingDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | "test" | null>(
    null
  );
  const [testResult, setTestResult] =
    useState<WhatsAppConnectionTestResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchWhatsAppOnboardingDiagnostics();
      setDiagnostics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const markCopied = (key: string) => {
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const handleConnect = async () => {
    setBusy("connect");
    setError(null);
    try {
      const { state } = await fetchEmbeddedSignupState();
      const signup = await launchMetaEmbeddedSignup({ state });
      await submitEmbeddedSignup({
        code: signup.code,
        wabaId: signup.wabaId,
        phoneNumberId: signup.phoneNumberId,
        state: signup.state,
        ...(signup.businessId ? { businessId: signup.businessId } : {}),
      });
      await load();
    } catch (err) {
      // TEMPORARY DEBUG — fresh sanitized allowlisted providerError only.
      logMetaEmbeddedSignupDebug(
        "WhatsAppSetupPage.handleConnect.catch",
        extractEmbeddedSignupProviderError(err)
      );
      setError(sanitizeEmbeddedSignupError(err));
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    setBusy("disconnect");
    setError(null);
    try {
      await disconnectWhatsAppConnection();
      setTestResult(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy("test");
    setError(null);
    try {
      const result = await testWhatsAppConnection();
      setTestResult(result);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-5 text-sm text-neutral-400">
        Only Admin users can manage WhatsApp production setup.
      </div>
    );
  }

  const connection = diagnostics?.connection;
  const status = connection?.status ?? "DISCONNECTED";

  return (
    <div
      className="space-y-5 text-neutral-100"
      data-testid="whatsapp-connection-page"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-emerald-400" />
            <h2 className="text-lg font-semibold">WhatsApp Connection</h2>
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            QR connect, coexistence, history sync and diagnostics — separate from
            WhatsApp Inbox.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:bg-neutral-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      ) : null}

      {isAdmin ? (
        <div
          className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4"
          style={
            {
              "--inbox-bg": "#0b0c0e",
              "--inbox-surface": "#121417",
              "--inbox-surface-2": "#1a1d22",
              "--inbox-border": "#2a2f36",
              "--inbox-fg": "#f3f4f6",
              "--inbox-muted": "#9ca3af",
              "--inbox-accent": "#f59e0b",
            } as CSSProperties
          }
        >
          <WhatsAppConnectionPanel isAdmin={isAdmin} />
        </div>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Connection controls are Admin / Super Admin only. WhatsApp Inbox remains
          available from its own navigation item.
        </div>
      )}

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4">
        <div className="text-[11px] uppercase tracking-wider text-neutral-500">
          Meta onboarding status
        </div>
        <div className="mt-1 text-sm font-semibold text-emerald-300">{status}</div>
        {connection?.connectionErrorSummary ? (
          <p className="mt-1 text-xs text-amber-300">{connection.connectionErrorSummary}</p>
        ) : null}
        {connection?.revokeWarning ? (
          <p className="mt-1 text-xs text-amber-300">{connection.revokeWarning}</p>
        ) : null}
      </div>

      {loading && !diagnostics ? (
        <div className="flex items-center gap-2 text-xs text-neutral-400">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Loading checklist…
        </div>
      ) : diagnostics ? (
        <>
          <div className="space-y-2">
            {diagnostics.checklist.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2.5 rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2.5"
              >
                {item.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{item.label}</div>
                  {item.detail ? (
                    <div className="mt-0.5 break-all font-mono text-[11px] text-neutral-400">
                      {item.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4">
              <div className="text-[11px] uppercase tracking-wider text-neutral-500">
                Webhook callback URL
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-neutral-200">
                {diagnostics.webhookCallbackUrl}
              </div>
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300"
                onClick={() => {
                  void copyText(diagnostics.webhookCallbackUrl).then(() =>
                    markCopied("url")
                  );
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied === "url" ? "Copied" : "Copy URL"}
              </button>
            </div>
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4">
              <div className="text-[11px] uppercase tracking-wider text-neutral-500">
                Verify token configured
              </div>
              <div className="mt-1 text-sm font-semibold text-neutral-100">
                {diagnostics.webhookVerifyTokenConfigured ? "Yes" : "No"}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
                Copy the value directly from Render environment variable
                WHATSAPP_WEBHOOK_VERIFY_TOKEN into Meta. Do not paste tokens
                into this page — the CRM never displays the secret.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4 text-xs text-neutral-400">
            Graph API:{" "}
            {diagnostics.graphApi.connectivityOk ? "Reachable" : "Unreachable"}
          </div>

          {/* Meta Business Diagnostics — read-only, admin only */}
          <div
            className="rounded-xl border border-neutral-800 bg-neutral-900/80 p-4 space-y-3"
            data-testid="meta-business-diagnostics"
          >
            <div className="text-[11px] uppercase tracking-wider text-neutral-500">
              Meta Business Diagnostics
            </div>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              During Meta onboarding, Sunchaser CRM uses{" "}
              <span className="font-mono text-neutral-300">
                business_management
              </span>{" "}
              to identify the Business Portfolio authorized by the administrator
              and associate the selected WhatsApp Business Account with the
              correct business context.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {/* Authorization status */}
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Meta Authorization
                </div>
                <div className="mt-0.5 text-xs font-semibold text-neutral-200">
                  {diagnostics.connection.status !== "DISCONNECTED"
                    ? "Authorized"
                    : "Not available"}
                </div>
              </div>
              {/* Business discovery */}
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Business Discovery
                </div>
                <div
                  className={`mt-0.5 text-xs font-semibold ${
                    diagnostics.businessDiagnostics.businessDiscovery === "success"
                      ? "text-emerald-400"
                      : diagnostics.businessDiagnostics.businessDiscovery === "failed"
                        ? "text-amber-300"
                        : diagnostics.businessDiagnostics.businessDiscovery === "unresolved"
                          ? "text-amber-300"
                          : "text-neutral-500"
                  }`}
                >
                  {diagnostics.businessDiagnostics.businessDiscovery === "success"
                    ? "Successful"
                    : diagnostics.businessDiagnostics.businessDiscovery === "failed"
                      ? "Failed"
                    : diagnostics.businessDiagnostics.businessDiscovery === "unresolved"
                      ? "Unresolved"
                      : "Not attempted"}
                </div>
                {diagnostics.businessDiagnostics.discoveryDetail &&
                diagnostics.businessDiagnostics.associationStatus !== "confirmed" ? (
                  <div className="mt-0.5 text-[10px] leading-relaxed text-amber-200/80">
                    {diagnostics.businessDiagnostics.discoveryDetail}
                  </div>
                ) : null}
              </div>
              {/* Business Portfolio name */}
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Business Portfolio
                </div>
                <div className="mt-0.5 text-xs font-semibold text-neutral-200">
                  {diagnostics.businessDiagnostics.businessPortfolioName ?? "—"}
                </div>
                {diagnostics.businessDiagnostics.businessPortfolioIdMasked ? (
                  <div className="mt-0.5 font-mono text-[10px] text-neutral-500">
                    ID: {diagnostics.businessDiagnostics.businessPortfolioIdMasked}
                  </div>
                ) : null}
              </div>
              {/* WABA */}
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                  WABA
                </div>
                <div className="mt-0.5 text-xs font-semibold text-neutral-200">
                  {diagnostics.businessDiagnostics.wabaName ?? "—"}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-neutral-300">
                  {diagnostics.businessDiagnostics.wabaIdMasked ?? "—"}
                </div>
              </div>
              {/* Phone Number ID */}
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Phone Number ID
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-neutral-300">
                  {diagnostics.businessDiagnostics.phoneNumberIdMasked ?? "—"}
                </div>
              </div>
              {/* Association status */}
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Business Association
                </div>
                <div
                  className={`mt-0.5 text-xs font-semibold ${
                    diagnostics.businessDiagnostics.associationStatus === "confirmed"
                      ? "text-emerald-400"
                      : diagnostics.businessDiagnostics.associationStatus === "unresolved" ||
                          diagnostics.businessDiagnostics.associationStatus === "mismatch"
                        ? "text-amber-300"
                        : "text-neutral-500"
                  }`}
                >
                  {diagnostics.businessDiagnostics.associationStatus === "confirmed"
                    ? "Confirmed"
                    : diagnostics.businessDiagnostics.associationStatus === "mismatch"
                      ? "Mismatch"
                      : diagnostics.businessDiagnostics.associationStatus === "unresolved"
                      ? "Unresolved"
                      : "Not available"}
                </div>
              </div>
            </div>
          </div>

          {testResult ? (
            <div
              className={`rounded-lg border px-3 py-2 text-xs ${
                testResult.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-200"
              }`}
            >
              <div className="font-semibold">Test Connection</div>
              <div className="mt-0.5">{testResult.summary}</div>
              <div className="mt-1 text-[11px] opacity-90">
                token={testResult.tokenValid ? "ok" : "fail"} · waba=
                {testResult.wabaAccessOk ? "ok" : "fail"} · phone=
                {testResult.phoneAccessOk ? "ok" : "fail"}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void handleConnect()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {busy === "connect"
                ? "Connecting…"
                : status === "CONNECTED" ||
                    status === "WEBHOOK_PENDING" ||
                    status === "TOKEN_EXPIRED"
                  ? "Reconnect"
                  : "Connect"}
            </button>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void handleTest()}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-semibold text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy === "test" ? "Testing…" : "Test Connection"}
            </button>
            <button
              type="button"
              disabled={busy != null || status === "DISCONNECTED"}
              onClick={() => void handleDisconnect()}
              className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-semibold text-neutral-100 hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
