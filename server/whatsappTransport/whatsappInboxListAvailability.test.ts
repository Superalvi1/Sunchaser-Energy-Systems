/**
 * Transport-aware Inbox list availability.
 * Run via: npm run test:whatsapp-inbox-routes
 */
import assert from "node:assert/strict";
import {
  createWhatsAppInboxListAvailabilityResolver,
  isMetaWhatsAppDisconnectedForInbox,
  isWhatsAppWebQrConnectedForInbox,
  resolveWhatsAppInboxListAvailability,
} from "./whatsappInboxListAvailability.ts";

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

await test("QR CONNECTED is the only QR state treated as connected", () => {
  assert.equal(isWhatsAppWebQrConnectedForInbox("CONNECTED"), true);
  for (const state of [
    "DISCONNECTED",
    "QR_READY",
    "CONNECTING",
    "RECONNECTING",
    "LOGGED_OUT",
    "ERROR",
  ]) {
    assert.equal(isWhatsAppWebQrConnectedForInbox(state), false, state);
  }
  assert.equal(isMetaWhatsAppDisconnectedForInbox("DISCONNECTED"), true);
  assert.equal(isMetaWhatsAppDisconnectedForInbox("CONNECTED"), false);
  assert.equal(isMetaWhatsAppDisconnectedForInbox("WEBHOOK_PENDING"), false);
});

await test("Meta DISCONNECTED + QR CONNECTED → not all disconnected", async () => {
  const result = await resolveWhatsAppInboxListAvailability({
    getMetaConnectionStatus: async () => ({ status: "DISCONNECTED" }),
    getQrConnectionStatus: async () => ({ state: "CONNECTED" }),
  });
  assert.equal(result.allTransportsDisconnected, false);
});

await test("Meta CONNECTED + QR DISCONNECTED → not all disconnected", async () => {
  const result = await resolveWhatsAppInboxListAvailability({
    getMetaConnectionStatus: async () => ({ status: "CONNECTED" }),
    getQrConnectionStatus: async () => ({ state: "DISCONNECTED" }),
  });
  assert.equal(result.allTransportsDisconnected, false);
});

await test("both explicitly disconnected → allTransportsDisconnected", async () => {
  const result = await resolveWhatsAppInboxListAvailability({
    getMetaConnectionStatus: async () => ({ status: "DISCONNECTED" }),
    getQrConnectionStatus: async () => ({ state: "DISCONNECTED" }),
  });
  assert.equal(result.allTransportsDisconnected, true);
});

await test("Meta DISCONNECTED + QR_READY/CONNECTING/RECONNECTING → empty short-circuit", async () => {
  for (const state of ["QR_READY", "CONNECTING", "RECONNECTING"]) {
    const result = await resolveWhatsAppInboxListAvailability({
      getMetaConnectionStatus: async () => ({ status: "DISCONNECTED" }),
      getQrConnectionStatus: async () => ({ state }),
    });
    assert.equal(result.allTransportsDisconnected, true, state);
  }
});

await test("Meta lookup failure + QR CONNECTED → fail-through", async () => {
  const result = await resolveWhatsAppInboxListAvailability({
    getMetaConnectionStatus: async () => {
      throw new Error("meta store down");
    },
    getQrConnectionStatus: async () => ({ state: "CONNECTED" }),
  });
  assert.equal(result.allTransportsDisconnected, false);
});

await test("QR lookup failure must not silently hide conversations", async () => {
  const result = await resolveWhatsAppInboxListAvailability({
    getMetaConnectionStatus: async () => ({ status: "DISCONNECTED" }),
    getQrConnectionStatus: async () => {
      throw new Error("qr status unavailable");
    },
  });
  assert.equal(result.allTransportsDisconnected, false);
});

await test("factory defaults QR to DISCONNECTED for Meta-only DI", async () => {
  const resolve = createWhatsAppInboxListAvailabilityResolver({
    getMetaConnectionStatus: async () => ({ status: "DISCONNECTED" }),
  });
  assert.equal((await resolve()).allTransportsDisconnected, true);

  const resolveConnectedMeta = createWhatsAppInboxListAvailabilityResolver({
    getMetaConnectionStatus: async () => ({ status: "CONNECTED" }),
  });
  assert.equal((await resolveConnectedMeta()).allTransportsDisconnected, false);
});

if (failed > 0) {
  console.error(`\n${failed} inbox list availability test(s) failed`);
  process.exit(1);
}
console.log("\nAll inbox list availability tests passed.");
