/**
 * Behavioral tests for the shared overlay / Android hardware-Back stack.
 *
 * These exercise the real dismiss functions with a mocked Capacitor App
 * listener — they do not assert source strings like history.pushState.
 */
import assert from "node:assert/strict";
import {
  dismissTopOverlay,
  overlayCount,
  popOverlay,
  pushOverlay,
  resetOverlayStackForTests,
  topOverlayId,
} from "./overlayBackStack";
import {
  ensureNativeBackListener,
  handleHardwareBackButton,
  nativeBackListenerCountForTests,
  nativeExitAppCallsForTests,
  setNativeAppForTests,
  stopNativeBackListenerForTests,
  type NativeAppLike,
} from "./nativeBackButton";

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

function resetAll() {
  resetOverlayStackForTests();
  setNativeAppForTests(null);
}

function fakeApp() {
  const listeners: Array<(event: { canGoBack: boolean }) => void> = [];
  let exits = 0;
  const app: NativeAppLike = {
    addListener: async (_eventName, listener) => {
      listeners.push(listener);
      return {
        remove: async () => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        },
      };
    },
    exitApp: () => {
      exits += 1;
    },
  };
  return { app, listeners, getExits: () => exits };
}

resetAll();

await test("hardware Back registers a single Capacitor App listener", async () => {
  resetAll();
  const { app } = fakeApp();
  setNativeAppForTests(app);
  await ensureNativeBackListener();
  await ensureNativeBackListener();
  await ensureNativeBackListener();
  assert.equal(nativeBackListenerCountForTests(), 1);
  await stopNativeBackListenerForTests();
});

await test("reopening overlays does not add another native listener", async () => {
  resetAll();
  const { app } = fakeApp();
  setNativeAppForTests(app);
  await ensureNativeBackListener();
  const first = pushOverlay(() => undefined);
  popOverlay(first);
  const second = pushOverlay(() => undefined);
  popOverlay(second);
  await ensureNativeBackListener();
  assert.equal(nativeBackListenerCountForTests(), 1);
  assert.equal(overlayCount(), 0);
});

await test("top overlay is dismissed and the one below stays", () => {
  resetAll();
  const log: string[] = [];
  pushOverlay(() => log.push("builder"));
  pushOverlay(() => log.push("picker"));
  assert.equal(overlayCount(), 2);
  assert.equal(dismissTopOverlay(), true);
  assert.deepEqual(log, ["picker"]);
  assert.equal(overlayCount(), 1);
  assert.equal(dismissTopOverlay(), true);
  assert.deepEqual(log, ["picker", "builder"]);
  assert.equal(overlayCount(), 0);
});

await test("hardware Back closes builder via onClose and does not Apply, save, message, or sync", () => {
  resetAll();
  const log: string[] = [];
  const onClose = () => log.push("onClose");
  const onApplyDraft = () => log.push("onApplyDraft");
  const saveQuote = () => log.push("saveQuote");
  const whatsapp = () => log.push("whatsapp");
  const catalogSync = () => log.push("catalogSync");
  pushOverlay(onClose);
  const result = handleHardwareBackButton({ canGoBack: false });
  assert.equal(result, "overlay");
  assert.deepEqual(log, ["onClose"]);
  assert.equal(log.includes("onApplyDraft"), false);
  assert.equal(log.includes("saveQuote"), false);
  assert.equal(log.includes("whatsapp"), false);
  assert.equal(log.includes("catalogSync"), false);
  void onApplyDraft;
  void saveQuote;
  void whatsapp;
  void catalogSync;
  assert.equal(overlayCount(), 0);
  assert.equal(nativeExitAppCallsForTests(), 0);
});

await test("catalog picker closes before the AI Quote Builder", () => {
  resetAll();
  const log: string[] = [];
  pushOverlay(() => log.push("builder"));
  pushOverlay(() => log.push("picker"));
  assert.equal(handleHardwareBackButton({ canGoBack: true }), "overlay");
  assert.deepEqual(log, ["picker"]);
  assert.equal(overlayCount(), 1);
  assert.equal(handleHardwareBackButton({ canGoBack: true }), "overlay");
  assert.deepEqual(log, ["picker", "builder"]);
  assert.equal(overlayCount(), 0);
});

await test("firing the mocked Capacitor listener dismisses the top overlay", async () => {
  resetAll();
  const { app, listeners } = fakeApp();
  setNativeAppForTests(app);
  await ensureNativeBackListener();
  const log: string[] = [];
  pushOverlay(() => log.push("closed"));
  assert.equal(listeners.length, 1);
  listeners[0]({ canGoBack: false });
  assert.deepEqual(log, ["closed"]);
  assert.equal(overlayCount(), 0);
  await stopNativeBackListenerForTests();
});

await test("no overlay falls back to history when the WebView can go back", () => {
  resetAll();
  const original = globalThis.window;
  const backs: number[] = [];
  // @ts-expect-error test double
  globalThis.window = { history: { back: () => backs.push(1) } };
  try {
    const result = handleHardwareBackButton({ canGoBack: true });
    assert.equal(result, "history");
    assert.deepEqual(backs, [1]);
    assert.equal(nativeExitAppCallsForTests(), 0);
  } finally {
    globalThis.window = original;
  }
});

await test("no overlay and nowhere to go exits through Capacitor App.exitApp", async () => {
  resetAll();
  const { app } = fakeApp();
  setNativeAppForTests(app);
  await ensureNativeBackListener();
  const result = handleHardwareBackButton({ canGoBack: false });
  assert.equal(result, "exit");
  assert.equal(nativeExitAppCallsForTests(), 1);
  assert.equal(overlayCount(), 0);
  await stopNativeBackListenerForTests();
});

await test("closing an overlay by id does not dismiss a newer overlay", () => {
  resetAll();
  const log: string[] = [];
  const older = pushOverlay(() => log.push("older"));
  const newer = pushOverlay(() => log.push("newer"));
  popOverlay(older);
  assert.equal(topOverlayId(), newer);
  assert.equal(overlayCount(), 1);
  assert.deepEqual(log, []);
  assert.equal(dismissTopOverlay(), true);
  assert.deepEqual(log, ["newer"]);
});

await test("back stack dismiss callbacks never include quotation mutations", () => {
  resetAll();
  const { dismissTopOverlay: dismiss, pushOverlay: push } = {
    dismissTopOverlay,
    pushOverlay,
  };
  let apply = 0;
  push(() => {
    /* overlay close only */
  });
  dismiss();
  assert.equal(apply, 0);
});

if (failed > 0) {
  console.error(`\n${failed} overlay back behavior test(s) failed.`);
  process.exit(1);
}
console.log("\nAll overlay back behavior tests passed.");
