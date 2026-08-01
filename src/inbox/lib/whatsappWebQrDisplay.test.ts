/**
 * WhatsApp Web QR display + request-order helpers.
 * Run via: npm run test:whatsapp-inbox-ui
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  WhatsAppWebQrPayload,
  WhatsAppWebSafeStatus,
} from "../api/inboxApi";
import {
  applyFailedWebStatusPoll,
  applySuccessfulWebStatusPoll,
  createWhatsAppWebRequestGate,
  isStatusAtLeastAsNew,
  mergeDisplayedQr,
  shouldClearDisplayedQr,
  shouldShowInitialWebLoading,
  type WhatsAppWebDisplaySnapshot,
} from "./whatsappWebQrDisplay.ts";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

function status(
  partial: Partial<WhatsAppWebSafeStatus> &
    Pick<WhatsAppWebSafeStatus, "state" | "qrAvailable" | "updatedAt">
): WhatsAppWebSafeStatus {
  return {
    enabled: true,
    state: partial.state,
    qrAvailable: partial.qrAvailable,
    phoneMasked: partial.phoneMasked ?? null,
    updatedAt: partial.updatedAt,
    qrExpiresAt: partial.qrExpiresAt ?? null,
    safeMessage: partial.safeMessage ?? null,
    lastRawUpsertAt: partial.lastRawUpsertAt ?? null,
    lastInboundEventAt: partial.lastInboundEventAt ?? null,
    lastInboundStoredAt: partial.lastInboundStoredAt ?? null,
    lastIgnoredAt: partial.lastIgnoredAt ?? null,
    lastIgnoredReason: partial.lastIgnoredReason ?? null,
    lastPersistFailureAt: partial.lastPersistFailureAt ?? null,
    lastPersistFailureCode: partial.lastPersistFailureCode ?? null,
    socketOpen: partial.socketOpen ?? partial.state === "CONNECTED",
    inboundListenerAttached:
      partial.inboundListenerAttached ?? partial.state === "CONNECTED",
    inboundListenerOperational:
      partial.inboundListenerOperational ?? partial.state === "CONNECTED",
    activeSocketGeneration: partial.activeSocketGeneration ?? 0,
    activeSessionKey: partial.activeSessionKey ?? "web_qr:test:g0",
    reconnectScheduled: partial.reconnectScheduled ?? false,
    reconnectAttemptInProgress: partial.reconnectAttemptInProgress ?? false,
    reconnectAttempt: partial.reconnectAttempt ?? 0,
    lastDisconnectClassification: partial.lastDisconnectClassification ?? null,
    credentialsAvailable: partial.credentialsAvailable ?? false,
  };
}

function qr(
  dataUrl: string,
  expiresAt: string
): WhatsAppWebQrPayload {
  return {
    qrDataUrl: dataUrl,
    expiresAt,
    state: "QR_READY",
  };
}

const emptySnapshot = (): WhatsAppWebDisplaySnapshot => ({
  status: null,
  qr: null,
  hasLoadedOnce: false,
  error: null,
});

await test("initial request shows checking only before first load", () => {
  assert.equal(shouldShowInitialWebLoading(false, true), true);
  assert.equal(shouldShowInitialWebLoading(false, false), false);
  assert.equal(shouldShowInitialWebLoading(true, true), false);
  assert.equal(shouldShowInitialWebLoading(true, false), false);
});

await test("QR_READY successful poll renders/keeps QR", () => {
  const next = applySuccessfulWebStatusPoll(
    emptySnapshot(),
    status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:00.000Z",
    }),
    qr("data:image/png;base64,AAA", "2026-07-25T12:02:00.000Z")
  );
  assert.equal(next.status?.state, "QR_READY");
  assert.equal(next.qr?.qrDataUrl, "data:image/png;base64,AAA");
  assert.equal(next.hasLoadedOnce, true);
  assert.equal(next.error, null);
});

await test("background poll does not hide an existing QR", () => {
  const previous: WhatsAppWebDisplaySnapshot = {
    status: status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:00.000Z",
    }),
    qr: qr("data:image/png;base64,OLD", "2026-07-25T12:02:00.000Z"),
    hasLoadedOnce: true,
    error: null,
  };
  const same = applySuccessfulWebStatusPoll(
    previous,
    status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:05.000Z",
    }),
    qr("data:image/png;base64,OLD", "2026-07-25T12:02:00.000Z")
  );
  assert.equal(same.qr?.qrDataUrl, "data:image/png;base64,OLD");
  const fetchMiss = applySuccessfulWebStatusPoll(
    previous,
    status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:05.000Z",
    }),
    null
  );
  assert.equal(fetchMiss.qr?.qrDataUrl, "data:image/png;base64,OLD");
  assert.equal(shouldShowInitialWebLoading(true, false), false);
});

await test("updated QR replaces the previous QR safely", () => {
  const previous: WhatsAppWebDisplaySnapshot = {
    status: status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:00.000Z",
    }),
    qr: qr("data:image/png;base64,OLD", "2026-07-25T12:01:00.000Z"),
    hasLoadedOnce: true,
    error: null,
  };
  const updated = applySuccessfulWebStatusPoll(
    previous,
    status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:10.000Z",
    }),
    qr("data:image/png;base64,NEW", "2026-07-25T12:03:00.000Z")
  );
  assert.equal(updated.qr?.qrDataUrl, "data:image/png;base64,NEW");
  assert.equal(updated.qr?.expiresAt, "2026-07-25T12:03:00.000Z");
  assert.equal(
    mergeDisplayedQr(
      previous.qr,
      qr("data:image/png;base64,OLD", "2026-07-25T12:01:00.000Z")
    ),
    previous.qr
  );
});

await test("new QR cannot be replaced by an older QR", () => {
  const newer = qr("data:image/png;base64,NEW", "2026-07-25T12:05:00.000Z");
  const older = qr("data:image/png;base64,OLD", "2026-07-25T12:01:00.000Z");
  assert.equal(mergeDisplayedQr(newer, older), newer);

  const previous: WhatsAppWebDisplaySnapshot = {
    status: status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:02:00.000Z",
    }),
    qr: newer,
    hasLoadedOnce: true,
    error: null,
  };
  // Even with a later status timestamp, an older QR payload must not win.
  const applied = applySuccessfulWebStatusPoll(
    previous,
    status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:02:30.000Z",
    }),
    older
  );
  assert.equal(applied.qr?.qrDataUrl, "data:image/png;base64,NEW");
});

await test("slow old poll finishes after newer poll: old response ignored", () => {
  const gate = createWhatsAppWebRequestGate();
  const first = gate.begin("background");
  assert.equal(first.accepted, true);
  assert.equal(gate.isRefreshing(), true);

  // Overlapping background poll is rejected (single-flight).
  const overlap = gate.begin("background");
  assert.equal(overlap.accepted, false);

  // A newer operation (simulate completing a fresher poll path via action bump
  // then a new background after the first ends).
  const action = gate.begin("generate");
  assert.equal(action.accepted, true);
  assert.equal(gate.canCommit(first.generation), false);
  assert.equal(gate.canCommit(action.generation), true);

  // Stale first poll settles: cannot commit; refreshing clears only for that flight.
  const end = gate.endBackground(first.generation);
  assert.equal(end.clearRefreshing, true);
  assert.equal(gate.isRefreshing(), false);

  // Authoritative timestamps also reject older status snapshots.
  const newerSnap: WhatsAppWebDisplaySnapshot = {
    status: status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:30.000Z",
    }),
    qr: qr("data:image/png;base64,NEW", "2026-07-25T12:03:00.000Z"),
    hasLoadedOnce: true,
    error: null,
  };
  const stale = applySuccessfulWebStatusPoll(
    newerSnap,
    status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:00.000Z",
    }),
    qr("data:image/png;base64,OLD", "2026-07-25T12:02:00.000Z")
  );
  assert.equal(stale, newerSnap);
  assert.equal(
    isStatusAtLeastAsNew(
      newerSnap.status,
      status({
        state: "QR_READY",
        qrAvailable: true,
        updatedAt: "2026-07-25T12:01:00.000Z",
      })
    ),
    false
  );
});

await test("in-flight poll cannot overwrite Disconnect", () => {
  const gate = createWhatsAppWebRequestGate();
  const poll = gate.begin("background");
  assert.equal(poll.accepted, true);

  let display: WhatsAppWebDisplaySnapshot = {
    status: status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:00.000Z",
    }),
    qr: qr("data:image/png;base64,QR", "2026-07-25T12:02:00.000Z"),
    hasLoadedOnce: true,
    error: null,
  };

  const disconnect = gate.begin("disconnect");
  assert.equal(disconnect.accepted, true);
  assert.equal(gate.canCommit(poll.generation), false);

  display = applySuccessfulWebStatusPoll(
    display,
    status({
      state: "DISCONNECTED",
      qrAvailable: false,
      updatedAt: "2026-07-25T12:01:40.000Z",
    }),
    null
  );
  assert.equal(gate.canCommit(disconnect.generation), true);
  assert.equal(display.status?.state, "DISCONNECTED");
  assert.equal(display.qr, null);

  // Late poll response must not commit.
  assert.equal(gate.canCommit(poll.generation), false);
  gate.endBackground(poll.generation);
});

await test("in-flight poll cannot overwrite Logout", () => {
  const gate = createWhatsAppWebRequestGate();
  const poll = gate.begin("background");
  const logout = gate.begin("logout");
  assert.equal(gate.canCommit(poll.generation), false);
  assert.equal(gate.canCommit(logout.generation), true);

  const display = applySuccessfulWebStatusPoll(
    {
      status: status({
        state: "QR_READY",
        qrAvailable: true,
        updatedAt: "2026-07-25T12:01:00.000Z",
      }),
      qr: qr("data:image/png;base64,QR", "2026-07-25T12:02:00.000Z"),
      hasLoadedOnce: true,
      error: null,
    },
    status({
      state: "LOGGED_OUT",
      qrAvailable: false,
      updatedAt: "2026-07-25T12:01:50.000Z",
    }),
    null
  );
  assert.equal(display.status?.state, "LOGGED_OUT");
  assert.equal(display.qr, null);
  assert.equal(gate.canCommit(poll.generation), false);
});

await test("poll failures retain last usable QR/status", () => {
  const previous: WhatsAppWebDisplaySnapshot = {
    status: status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:00.000Z",
    }),
    qr: qr("data:image/png;base64,KEEP", "2026-07-25T12:02:00.000Z"),
    hasLoadedOnce: true,
    error: null,
  };
  const failedPoll = applyFailedWebStatusPoll(
    previous,
    "Failed to load WhatsApp Web status"
  );
  assert.equal(failedPoll.status?.state, "QR_READY");
  assert.equal(failedPoll.qr?.qrDataUrl, "data:image/png;base64,KEEP");
  assert.equal(failedPoll.error, "Failed to load WhatsApp Web status");
  assert.equal(failedPoll.hasLoadedOnce, true);
});

await test("no state commit after unmount/invalidation", () => {
  const gate = createWhatsAppWebRequestGate();
  const poll = gate.begin("background");
  assert.equal(poll.accepted, true);
  assert.equal(gate.isRefreshing(), true);

  gate.unmount();
  assert.equal(gate.isMounted(), false);
  assert.equal(gate.canCommit(poll.generation), false);
  assert.equal(gate.isRefreshing(), false);

  const afterUnmount = gate.begin("background");
  assert.equal(afterUnmount.accepted, false);
  assert.equal(gate.begin("generate").accepted, false);
});

await test("background polling remains non-blocking / single-flight", () => {
  const gate = createWhatsAppWebRequestGate();
  const a = gate.begin("background");
  assert.equal(a.accepted, true);
  assert.equal(gate.isRefreshing(), true);

  const b = gate.begin("background");
  assert.equal(b.accepted, false);
  // Refreshing stays true while the accepted refresh is still running.
  assert.equal(gate.isRefreshing(), true);

  const ended = gate.endBackground(a.generation);
  assert.equal(ended.clearRefreshing, true);
  assert.equal(gate.isRefreshing(), false);

  const c = gate.begin("background");
  assert.equal(c.accepted, true);
  assert.equal(gate.isRefreshing(), true);
  // Ending a stale generation must not clear an active refresh.
  assert.equal(gate.endBackground(a.generation).clearRefreshing, false);
  assert.equal(gate.isRefreshing(), true);
  assert.equal(gate.endBackground(c.generation).clearRefreshing, true);
  assert.equal(gate.isRefreshing(), false);
});

await test("LOGGED_OUT and DISCONNECTED clear QR and represent state", () => {
  const previous: WhatsAppWebDisplaySnapshot = {
    status: status({
      state: "QR_READY",
      qrAvailable: true,
      updatedAt: "2026-07-25T12:01:00.000Z",
    }),
    qr: qr("data:image/png;base64,GONE", "2026-07-25T12:02:00.000Z"),
    hasLoadedOnce: true,
    error: null,
  };
  const loggedOut = applySuccessfulWebStatusPoll(
    previous,
    status({
      state: "LOGGED_OUT",
      qrAvailable: false,
      updatedAt: "2026-07-25T12:01:10.000Z",
    }),
    null
  );
  assert.equal(loggedOut.status?.state, "LOGGED_OUT");
  assert.equal(loggedOut.qr, null);
  assert.equal(shouldClearDisplayedQr({ state: "LOGGED_OUT", qrAvailable: false }), true);

  const disconnected = applySuccessfulWebStatusPoll(
    previous,
    status({
      state: "DISCONNECTED",
      qrAvailable: false,
      updatedAt: "2026-07-25T12:01:10.000Z",
    }),
    null
  );
  assert.equal(disconnected.status?.state, "DISCONNECTED");
  assert.equal(disconnected.qr, null);
});

await test("panel uses request gate, background mode, initial-only loading", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const panel = fs.readFileSync(
    path.join(here, "../components/WhatsAppConnectionPanel.tsx"),
    "utf8"
  );
  assert.match(panel, /createWhatsAppWebRequestGate/);
  assert.match(panel, /canCommit/);
  assert.match(panel, /loadWebStatus\("background"\)/);
  assert.match(panel, /loadWebStatus\("initial"\)/);
  assert.match(panel, /shouldShowInitialWebLoading/);
  assert.match(panel, /Refreshing…/);
  assert.match(panel, /Checking WhatsApp Web status\.\.\./);
  assert.match(panel, /begin\("generate"\)/);
  assert.match(panel, /begin\("disconnect"\)/);
  assert.match(panel, /begin\("logout"\)/);
  assert.match(panel, /gate\.unmount\(\)/);
  assert.equal(/setWebLoading\(true\)/.test(panel), false);
  assert.match(panel, /clearInterval\(pollRef\.current\)/);
});

if (failed > 0) {
  console.error(`\n${failed} WhatsApp Web QR display test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp Web QR display tests passed.");
