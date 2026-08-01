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
  connectWhatsAppWeb,
  disconnectWhatsAppConnection,
  disconnectWhatsAppWeb,
  fetchEmbeddedSignupState,
  fetchWhatsAppConnectionStatus,
  fetchWhatsAppOnboardingDiagnostics,
  fetchWhatsAppWebHistorySync,
  fetchWhatsAppWebQr,
  fetchWhatsAppWebStatus,
  logoutWhatsAppWeb,
  startWhatsAppWebHistorySync,
  submitEmbeddedSignup,
  testWhatsAppConnection,
  type WhatsAppWebQrPayload,
  type WhatsAppWebSafeStatus,
  type WhatsAppWebSyncJobSnapshot,
} from "../api/inboxApi";
import {
  extractEmbeddedSignupProviderError,
  launchMetaEmbeddedSignup,
  logMetaEmbeddedSignupDebug,
  sanitizeEmbeddedSignupError,
} from "../lib/metaEmbeddedSignup";
import {
  applyFailedWebStatusPoll,
  applySuccessfulWebStatusPoll,
  createWhatsAppWebRequestGate,
  shouldShowInitialWebLoading,
  type WhatsAppWebDisplaySnapshot,
} from "../lib/whatsappWebQrDisplay";
import type {
  WhatsAppConnectionStatusPayload,
  WhatsAppConnectionTestResult,
} from "../types";

type WhatsAppConnectionPanelProps = {
  isAdmin: boolean;
  onClose?: () => void;
};

function webStatusLabel(state: WhatsAppWebSafeStatus["state"]): string {
  switch (state) {
    case "DISCONNECTED":
      return "Disconnected";
    case "QR_READY":
      return "QR Ready";
    case "CONNECTING":
      return "Connecting";
    case "CONNECTED":
      return "Connected";
    case "RECONNECTING":
      return "Reconnecting";
    case "LOGGED_OUT":
      return "Logged Out";
    case "ERROR":
      return "Error";
    default:
      return state;
  }
}

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
  const [webStatus, setWebStatus] = useState<WhatsAppWebSafeStatus | null>(null);
  const [qr, setQr] = useState<WhatsAppWebQrPayload | null>(null);
  const [hasLoadedWebStatus, setHasLoadedWebStatus] = useState(false);
  const [initialWebLoading, setInitialWebLoading] = useState(true);
  const [isRefreshingWeb, setIsRefreshingWeb] = useState(false);
  const [webBusy, setWebBusy] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [syncJob, setSyncJob] = useState<WhatsAppWebSyncJobSnapshot | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasLoadedWebStatusRef = useRef(false);
  const displaySnapshotRef = useRef<WhatsAppWebDisplaySnapshot>({
    status: null,
    qr: null,
    hasLoadedOnce: false,
    error: null,
  });
  const requestGateRef = useRef(createWhatsAppWebRequestGate());

  // Meta Embedded Signup — retained as secondary/disabled restore path.
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
  const [showMetaAdvanced, setShowMetaAdvanced] = useState(false);
  const activeStateRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const commitWebDisplay = (
    generation: number,
    next: WhatsAppWebDisplaySnapshot
  ): boolean => {
    if (!requestGateRef.current.canCommit(generation)) {
      return false;
    }
    displaySnapshotRef.current = next;
    setWebStatus(next.status);
    setQr(next.qr);
    setWebError(next.error);
    setHasLoadedWebStatus(next.hasLoadedOnce);
    hasLoadedWebStatusRef.current = next.hasLoadedOnce;
    return true;
  };

  const syncRefreshingIndicator = () => {
    if (!requestGateRef.current.isMounted()) return;
    setIsRefreshingWeb(requestGateRef.current.isRefreshing());
  };

  const loadWebStatus = async (mode: "initial" | "background" = "initial") => {
    const kind =
      mode === "background" && hasLoadedWebStatusRef.current
        ? "background"
        : "initial";
    const { generation, accepted } = requestGateRef.current.begin(kind);
    if (!accepted) {
      return;
    }

    const isBackground = kind === "background";
    try {
      if (isBackground) {
        setIsRefreshingWeb(true);
      } else if (!hasLoadedWebStatusRef.current) {
        setInitialWebLoading(true);
      }
      const status = await fetchWhatsAppWebStatus();
      let fetchedQr: WhatsAppWebQrPayload | null = null;
      if (status.qrAvailable) {
        try {
          fetchedQr = await fetchWhatsAppWebQr();
        } catch {
          // Keep previous QR on QR fetch failure; status still applies below.
          fetchedQr = null;
        }
      }
      commitWebDisplay(
        generation,
        applySuccessfulWebStatusPoll(
          displaySnapshotRef.current,
          status,
          fetchedQr
        )
      );
    } catch (err) {
      commitWebDisplay(
        generation,
        applyFailedWebStatusPoll(
          displaySnapshotRef.current,
          err instanceof Error ? err.message : "Failed to load WhatsApp Web status"
        )
      );
    } finally {
      if (isBackground) {
        requestGateRef.current.endBackground(generation);
        syncRefreshingIndicator();
      } else if (requestGateRef.current.isMounted()) {
        setInitialWebLoading(false);
      }
    }
  };

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
    const gate = requestGateRef.current;
    void loadWebStatus("initial");
    void fetchWhatsAppWebHistorySync()
      .then((snapshot) => {
        if (gate.isMounted() && snapshot.status !== "idle") {
          setSyncJob(snapshot);
        }
      })
      .catch(() => {
        /* durable sync status is best-effort */
      });
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (syncPollRef.current) {
        clearInterval(syncPollRef.current);
        syncPollRef.current = null;
      }
      gate.unmount();
    };
  }, []);

  useEffect(() => {
    if (
      webStatus?.state === "QR_READY" ||
      webStatus?.state === "CONNECTING" ||
      webStatus?.state === "RECONNECTING"
    ) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        void loadWebStatus("background");
      }, 2500);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [webStatus?.state]);

  const handleGenerateQr = async () => {
    const { generation, accepted } = requestGateRef.current.begin("generate");
    if (!accepted) return;
    setWebBusy(true);
    setWebError(null);
    try {
      const status = await connectWhatsAppWeb();
      let fetchedQr: WhatsAppWebQrPayload | null = null;
      if (status.qrAvailable || status.state === "QR_READY") {
        try {
          fetchedQr = await fetchWhatsAppWebQr();
        } catch {
          fetchedQr = null;
        }
      }
      commitWebDisplay(
        generation,
        applySuccessfulWebStatusPoll(
          displaySnapshotRef.current,
          status,
          fetchedQr
        )
      );
    } catch (err) {
      if (requestGateRef.current.canCommit(generation)) {
        setWebError(err instanceof Error ? err.message : "Failed to generate QR");
      }
    } finally {
      if (requestGateRef.current.isMounted()) {
        setWebBusy(false);
      }
    }
  };

  const handleWebDisconnect = async () => {
    const { generation, accepted } = requestGateRef.current.begin("disconnect");
    if (!accepted) return;
    setWebBusy(true);
    setWebError(null);
    try {
      const status = await disconnectWhatsAppWeb();
      commitWebDisplay(
        generation,
        applySuccessfulWebStatusPoll(displaySnapshotRef.current, status, null)
      );
    } catch (err) {
      if (requestGateRef.current.canCommit(generation)) {
        setWebError(err instanceof Error ? err.message : "Disconnect failed");
      }
    } finally {
      if (requestGateRef.current.isMounted()) {
        setWebBusy(false);
      }
    }
  };

  const handleWebLogout = async () => {
    if (
      !window.confirm(
        "Remove this WhatsApp device link? You will need to scan a new QR code to reconnect."
      )
    ) {
      return;
    }
    const { generation, accepted } = requestGateRef.current.begin("logout");
    if (!accepted) return;
    setWebBusy(true);
    setWebError(null);
    try {
      const status = await logoutWhatsAppWeb();
      commitWebDisplay(
        generation,
        applySuccessfulWebStatusPoll(displaySnapshotRef.current, status, null)
      );
    } catch (err) {
      if (requestGateRef.current.canCommit(generation)) {
        setWebError(err instanceof Error ? err.message : "Logout failed");
      }
    } finally {
      if (requestGateRef.current.isMounted()) {
        setWebBusy(false);
      }
    }
  };

  const stopSyncPolling = () => {
    if (syncPollRef.current) {
      clearInterval(syncPollRef.current);
      syncPollRef.current = null;
    }
  };

  const pollSyncStatus = async () => {
    try {
      const snapshot = await fetchWhatsAppWebHistorySync();
      if (!requestGateRef.current.isMounted()) return;
      setSyncJob(snapshot);
        if (snapshot.status === "completed" || snapshot.status === "failed") {
          stopSyncPolling();
          setSyncBusy(false);
          if (
            snapshot.status === "failed" ||
            snapshot.outcome === "failed" ||
            snapshot.outcome === "history_not_available"
          ) {
            setSyncError(
              snapshot.errorSummary ||
                "Sync did not import available WhatsApp history"
            );
          }
        }
    } catch {
      // Background sync poll must not affect Inbox / QR status loading.
      if (requestGateRef.current.isMounted()) {
        stopSyncPolling();
        setSyncBusy(false);
      }
    }
  };

  const handleSyncContactsHistory = async () => {
    setSyncBusy(true);
    setSyncError(null);
    try {
      const snapshot = await startWhatsAppWebHistorySync();
      if (!requestGateRef.current.isMounted()) return;
      setSyncJob(snapshot);
      if (snapshot.status === "starting" || snapshot.status === "running") {
        stopSyncPolling();
        syncPollRef.current = setInterval(() => {
          void pollSyncStatus();
        }, 2000);
      } else {
        setSyncBusy(false);
        if (snapshot.status === "failed" && snapshot.errorSummary) {
          setSyncError(snapshot.errorSummary);
        }
      }
    } catch (err) {
      if (requestGateRef.current.isMounted()) {
        setSyncBusy(false);
        setSyncError(
          err instanceof Error ? err.message : "Failed to start contact sync"
        );
      }
    }
  };

  const showInitialWebLoading = shouldShowInitialWebLoading(
    hasLoadedWebStatus,
    initialWebLoading
  );

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

      {/* Primary: WhatsApp Web QR */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Connect with WhatsApp QR
          </h3>
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
            Primary
          </span>
        </div>

        {showInitialWebLoading ? (
          <div className="flex items-center gap-2 py-3 text-xs text-[var(--inbox-muted)]">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Checking WhatsApp Web status...
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--inbox-surface-2)] p-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[var(--inbox-muted)]">
                  Status
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 font-semibold">
                  {webStatus?.state === "CONNECTED" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      <span className="text-emerald-400">
                        {webStatusLabel(webStatus.state)}
                      </span>
                    </>
                  ) : webStatus?.state === "QR_READY" ||
                    webStatus?.state === "RECONNECTING" ? (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                      <span className="text-amber-400">
                        {webStatusLabel(webStatus.state)}
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-zinc-400" />
                      <span className="text-zinc-400">
                        {webStatus ? webStatusLabel(webStatus.state) : "Unknown"}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {isRefreshingWeb ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-[var(--inbox-muted)]">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Refreshing…
                  </span>
                ) : null}
                {webStatus?.phoneMasked ? (
                  <div className="flex items-center gap-1 font-mono text-[11px]">
                    <Phone className="h-3 w-3 text-emerald-400" />
                    {webStatus.phoneMasked}
                  </div>
                ) : null}
              </div>
            </div>

            {webStatus ? (
              <div
                className="rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] p-2.5 text-[11px] text-[var(--inbox-muted)]"
                data-testid="whatsapp-web-inbound-diagnostics"
              >
                <div className="font-semibold text-[var(--inbox-fg)]">
                  Inbound diagnostics
                </div>
                <ul className="mt-1 space-y-0.5 font-mono">
                  <li>state={webStatus.state}</li>
                  <li>
                    socketOpen={webStatus.socketOpen === true ? "yes" : "no"}
                  </li>
                  <li>
                    inboundListener=
                    {webStatus.inboundListenerAttached === true
                      ? webStatus.inboundListenerOperational === true
                        ? "operational"
                        : "attached"
                      : "missing"}
                  </li>
                  <li>
                    lastRawUpsert=
                    {webStatus.lastRawUpsertAt
                      ? new Date(webStatus.lastRawUpsertAt).toLocaleString()
                      : "—"}
                  </li>
                  <li>
                    lastEvent=
                    {webStatus.lastInboundEventAt
                      ? new Date(webStatus.lastInboundEventAt).toLocaleString()
                      : "—"}
                  </li>
                  <li>
                    lastStored=
                    {webStatus.lastInboundStoredAt
                      ? new Date(webStatus.lastInboundStoredAt).toLocaleString()
                      : "—"}
                  </li>
                  <li>
                    lastIgnored=
                    {webStatus.lastIgnoredReason
                      ? `${webStatus.lastIgnoredReason}${
                          webStatus.lastIgnoredAt
                            ? `@${new Date(webStatus.lastIgnoredAt).toLocaleString()}`
                            : ""
                        }`
                      : "—"}
                  </li>
                  <li>
                    lastPersistFail=
                    {webStatus.lastPersistFailureCode
                      ? `${webStatus.lastPersistFailureCode}${
                          webStatus.lastPersistFailureAt
                            ? `@${new Date(
                                webStatus.lastPersistFailureAt
                              ).toLocaleString()}`
                            : ""
                        }`
                      : "—"}
                  </li>
                  <li>
                    generation={webStatus.activeSocketGeneration ?? "—"}
                  </li>
                  <li>session={webStatus.activeSessionKey ?? "—"}</li>
                </ul>
              </div>
            ) : null}

            {webStatus && !webStatus.enabled ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-[11px] text-amber-300">
                WhatsApp Web QR is disabled on the server
                (WHATSAPP_WEB_QR_ENABLED=false).
              </div>
            ) : null}

            {webError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
                {webError}
              </div>
            ) : null}

            {qr?.qrDataUrl ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-[var(--inbox-border)] p-4">
                <img
                  src={qr.qrDataUrl}
                  alt="WhatsApp link QR code"
                  className="h-56 w-56 rounded bg-white p-2"
                />
                <p className="max-w-sm text-center text-[11px] text-[var(--inbox-muted)]">
                  WhatsApp → Linked Devices → Link a Device → Scan this QR
                </p>
                {qr.expiresAt ? (
                  <p className="text-[10px] text-[var(--inbox-muted)]">
                    QR expires at {new Date(qr.expiresAt).toLocaleTimeString()}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <button
                type="button"
                disabled={webBusy || webStatus?.enabled === false}
                onClick={() => void handleGenerateQr()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 shadow-md"
              >
                {webBusy ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Working...
                  </>
                ) : webStatus?.state === "CONNECTED" ? (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Reconnect
                  </>
                ) : (
                  <>
                    <Smartphone className="h-4 w-4" />
                    Generate QR Code
                  </>
                )}
              </button>
              {webStatus?.state === "CONNECTED" ? (
                <button
                  type="button"
                  disabled={webBusy || syncBusy}
                  onClick={() => void handleSyncContactsHistory()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  {syncBusy ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Syncing available contacts &amp; history…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      Sync available WhatsApp contacts and history
                    </>
                  )}
                </button>
              ) : null}
              <p className="text-[10px] leading-relaxed text-[var(--inbox-muted)]">
                Imports only contacts and messages already available to this
                companion WhatsApp Web session. WhatsApp may not provide a
                complete seven-day archive.
              </p>
              {syncError ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-[11px] text-red-400">
                  {syncError}
                </div>
              ) : null}
              {syncJob &&
              (syncJob.outcome === "history_not_available" ||
                syncJob.historyAvailability === "empty_companion_cache" ||
                syncJob.historyAvailability === "history_not_available") ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                  No session-available history was ready to import (empty
                  companion cache or missing history cursor).
                </div>
              ) : null}
              {syncJob?.outcome === "partial" ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                  {syncJob.cancelled
                    ? "Sync interrupted (cancel/disconnect) with partial results."
                    : "Sync finished with partial results."}
                </div>
              ) : null}
              {syncJob?.durabilityWarning ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                  {syncJob.durabilityWarning}
                </div>
              ) : null}
              {syncJob?.outcome === "failed" || syncJob?.status === "failed" ? (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">
                  Sync failed{syncJob.errorSummary ? `: ${syncJob.errorSummary}` : "."}
                </div>
              ) : null}
              {syncJob && syncJob.status !== "idle" ? (
                <div className="space-y-1 rounded-lg border border-[var(--inbox-border)] bg-[var(--inbox-surface-2)] p-3 text-[11px] text-[var(--inbox-muted)]">
                  <div className="font-semibold text-[var(--inbox-fg)]">
                    Sync: {syncJob.status}
                    {syncJob.outcome ? ` · ${syncJob.outcome}` : ""}
                  </div>
                  <div>
                    Contacts: {syncJob.contactsDiscovered} discovered ·{" "}
                    {syncJob.contactsCreated} created ·{" "}
                    {syncJob.contactsUpdated} updated ·{" "}
                    {syncJob.contactsSkipped ?? 0} skipped
                  </div>
                  <div>
                    Chats: {syncJob.chatsInspected} inspected ·{" "}
                    {syncJob.conversationsCreated} conversations created ·{" "}
                    {syncJob.conversationsUpdated} updated
                  </div>
                  <div>
                    Messages: {syncJob.messagesDiscovered ?? 0} discovered ·{" "}
                    {syncJob.messagesImported} imported ·{" "}
                    {syncJob.messagesSkipped ?? syncJob.duplicatesSkipped} skipped ·{" "}
                    {syncJob.failedChats} failed chats
                  </div>
                  <div>
                    History: {syncJob.historyAvailability ?? syncJob.historyCoverage}
                    {syncJob.historySourceReady ? "" : " · source not ready"}
                    {syncJob.historyProviderEventObserved
                      ? " · provider history event observed"
                      : " · no provider history event"}
                  </div>
                  {syncJob.startedAt ? (
                    <div>Started: {new Date(syncJob.startedAt).toLocaleString()}</div>
                  ) : null}
                  {syncJob.completedAt ? (
                    <div>
                      Last run: {new Date(syncJob.completedAt).toLocaleString()}
                    </div>
                  ) : null}
                  {syncJob.errorSummary ? (
                    <div className="text-amber-300">{syncJob.errorSummary}</div>
                  ) : null}
                </div>
              ) : null}
              {webStatus?.state === "CONNECTED" ||
              webStatus?.state === "RECONNECTING" ||
              webStatus?.state === "QR_READY" ? (
                <button
                  type="button"
                  disabled={webBusy}
                  onClick={() => void handleWebDisconnect()}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--inbox-border)] px-4 py-2 text-xs font-semibold text-[var(--inbox-fg)] hover:bg-[var(--inbox-surface-2)] disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : null}
              <button
                type="button"
                disabled={webBusy}
                onClick={() => void handleWebLogout()}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 px-4 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                Logout / Remove device
              </button>
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-[var(--inbox-muted)]">
              <Shield className="h-3.5 w-3.5 text-emerald-400" />
              Session credentials stay on the server. Never stored in the browser.
            </div>
          </>
        )}
      </section>

      {/* Secondary: Meta Embedded Signup (retained, not primary) */}
      <section className="space-y-2 border-t border-[var(--inbox-border)] pt-3">
        <button
          type="button"
          onClick={() => {
            const next = !showMetaAdvanced;
            setShowMetaAdvanced(next);
            if (next && !metaStatus) void loadMetaStatus();
          }}
          className="flex w-full items-center justify-between text-left text-[11px] text-[var(--inbox-muted)] hover:text-[var(--inbox-fg)]"
        >
          <span>Advanced: Meta Cloud API (secondary / restore path)</span>
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
              Meta Embedded Signup is kept for restore only. Prefer WhatsApp QR above.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
