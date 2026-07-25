/**
 * WhatsApp Web QR display helpers — keeps QR visible during background polls.
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
    Pick<WhatsAppWebSafeStatus, "state" | "qrAvailable">
): WhatsAppWebSafeStatus {
  return {
    enabled: true,
    state: partial.state,
    qrAvailable: partial.qrAvailable,
    phoneMasked: partial.phoneMasked ?? null,
    updatedAt: partial.updatedAt ?? "2026-07-25T12:01:00.000Z",
    qrExpiresAt: partial.qrExpiresAt ?? null,
    safeMessage: partial.safeMessage ?? null,
  };
}

function qr(
  dataUrl: string,
  expiresAt = "2026-07-25T12:02:00.000Z"
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
    status({ state: "QR_READY", qrAvailable: true }),
    qr("data:image/png;base64,AAA")
  );
  assert.equal(next.status?.state, "QR_READY");
  assert.equal(next.qr?.qrDataUrl, "data:image/png;base64,AAA");
  assert.equal(next.hasLoadedOnce, true);
  assert.equal(next.error, null);
});

await test("background poll does not hide an existing QR", () => {
  const previous: WhatsAppWebDisplaySnapshot = {
    status: status({ state: "QR_READY", qrAvailable: true }),
    qr: qr("data:image/png;base64,OLD"),
    hasLoadedOnce: true,
    error: null,
  };
  // Same QR returned again — keep visible
  const same = applySuccessfulWebStatusPoll(
    previous,
    status({ state: "QR_READY", qrAvailable: true }),
    qr("data:image/png;base64,OLD")
  );
  assert.equal(same.qr?.qrDataUrl, "data:image/png;base64,OLD");
  // QR fetch failed on background poll — preserve previous
  const fetchMiss = applySuccessfulWebStatusPoll(
    previous,
    status({ state: "QR_READY", qrAvailable: true }),
    null
  );
  assert.equal(fetchMiss.qr?.qrDataUrl, "data:image/png;base64,OLD");
  assert.equal(shouldShowInitialWebLoading(true, false), false);
});

await test("updated QR replaces the previous QR safely", () => {
  const previous: WhatsAppWebDisplaySnapshot = {
    status: status({ state: "QR_READY", qrAvailable: true }),
    qr: qr("data:image/png;base64,OLD", "2026-07-25T12:01:00.000Z"),
    hasLoadedOnce: true,
    error: null,
  };
  const updated = applySuccessfulWebStatusPoll(
    previous,
    status({ state: "QR_READY", qrAvailable: true }),
    qr("data:image/png;base64,NEW", "2026-07-25T12:03:00.000Z")
  );
  assert.equal(updated.qr?.qrDataUrl, "data:image/png;base64,NEW");
  assert.equal(updated.qr?.expiresAt, "2026-07-25T12:03:00.000Z");
  // Identical payload keeps the previous reference.
  assert.equal(
    mergeDisplayedQr(
      previous.qr,
      qr("data:image/png;base64,OLD", "2026-07-25T12:01:00.000Z")
    ),
    previous.qr
  );
});

await test("poll failure preserves last usable state and sets safe error", () => {
  const previous: WhatsAppWebDisplaySnapshot = {
    status: status({ state: "QR_READY", qrAvailable: true }),
    qr: qr("data:image/png;base64,KEEP"),
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

await test("LOGGED_OUT and DISCONNECTED clear QR and represent state", () => {
  const previous: WhatsAppWebDisplaySnapshot = {
    status: status({ state: "QR_READY", qrAvailable: true }),
    qr: qr("data:image/png;base64,GONE"),
    hasLoadedOnce: true,
    error: null,
  };
  const loggedOut = applySuccessfulWebStatusPoll(
    previous,
    status({ state: "LOGGED_OUT", qrAvailable: false }),
    null
  );
  assert.equal(loggedOut.status?.state, "LOGGED_OUT");
  assert.equal(loggedOut.qr, null);
  assert.equal(shouldClearDisplayedQr({ state: "LOGGED_OUT", qrAvailable: false }), true);

  const disconnected = applySuccessfulWebStatusPoll(
    previous,
    status({ state: "DISCONNECTED", qrAvailable: false }),
    null
  );
  assert.equal(disconnected.status?.state, "DISCONNECTED");
  assert.equal(disconnected.qr, null);
  assert.equal(
    shouldClearDisplayedQr({ state: "DISCONNECTED", qrAvailable: false }),
    true
  );
});

await test("panel uses background poll mode and initial-only full loading", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const panel = fs.readFileSync(
    path.join(here, "../components/WhatsAppConnectionPanel.tsx"),
    "utf8"
  );
  assert.match(panel, /loadWebStatus\("background"\)/);
  assert.match(panel, /loadWebStatus\("initial"\)/);
  assert.match(panel, /shouldShowInitialWebLoading/);
  assert.match(panel, /Refreshing…/);
  assert.match(panel, /Checking WhatsApp Web status\.\.\./);
  // Must not force full-screen loading on every poll
  assert.equal(/setWebLoading\(true\)/.test(panel), false);
  // Polling cleanup on unmount
  assert.match(panel, /clearInterval\(pollRef\.current\)/);
});

if (failed > 0) {
  console.error(`\n${failed} WhatsApp Web QR display test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp Web QR display tests passed.");
