/**
 * Meta Embedded Signup frontend helper tests (RC-1.2.4B).
 * No fabricated production IDs — only injected SDK doubles.
 */
import assert from "node:assert/strict";
import {
  isAllowedMetaMessageOrigin,
  launchMetaEmbeddedSignup,
  MetaEmbeddedSignupError,
  parseEmbeddedSignupMessageData,
  resolveMetaEmbeddedSignupConfig,
  sanitizeEmbeddedSignupError,
} from "./metaEmbeddedSignup.ts";

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

await test("required Meta env config fails closed when missing", () => {
  assert.throws(
    () => resolveMetaEmbeddedSignupConfig({}),
    (err: unknown) =>
      err instanceof MetaEmbeddedSignupError && err.code === "missing_config"
  );
  assert.throws(
    () =>
      resolveMetaEmbeddedSignupConfig({
        VITE_META_APP_ID: "1",
        VITE_META_CONFIG_ID: "",
        VITE_META_GRAPH_VERSION: "v21.0",
      }),
    (err: unknown) => err instanceof MetaEmbeddedSignupError
  );
});

await test("required Meta env config accepts complete values", () => {
  const cfg = resolveMetaEmbeddedSignupConfig({
    VITE_META_APP_ID: "app-1",
    VITE_META_CONFIG_ID: "cfg-1",
    VITE_META_GRAPH_VERSION: "v21.0",
  });
  assert.equal(cfg.appId, "app-1");
  assert.equal(cfg.configId, "cfg-1");
});

await test("validates Meta message origins", () => {
  assert.equal(isAllowedMetaMessageOrigin("https://www.facebook.com"), true);
  assert.equal(isAllowedMetaMessageOrigin("https://web.facebook.com"), true);
  assert.equal(isAllowedMetaMessageOrigin("https://evil.example"), false);
  assert.equal(isAllowedMetaMessageOrigin("https://facebook.com.evil.com"), false);
});

await test("parses WA_EMBEDDED_SIGNUP payload and rejects malformed", () => {
  const ok = parseEmbeddedSignupMessageData(
    JSON.stringify({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "waba-1", phone_number_id: "phone-1" },
    })
  );
  assert.deepEqual(ok, {
    wabaId: "waba-1",
    phoneNumberId: "phone-1",
    event: "FINISH",
  });
  assert.equal(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "waba-1" },
    }),
    null
  );
  assert.equal(parseEmbeddedSignupMessageData({ type: "OTHER" }), null);
});

await test("SDK success returns code + assets from postMessage", async () => {
  const listeners = new Map<string, Set<EventListener>>();
  const messageTarget = {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(origin: string, data: unknown) {
      const event = { origin, data } as MessageEvent;
      for (const fn of listeners.get("message") || []) {
        fn(event);
      }
    },
  };

  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void
    ) {
      // Assets arrive before login callback completes.
      messageTarget.dispatch("https://www.facebook.com", {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "111", phone_number_id: "222" },
      });
      cb({ authResponse: { code: "real-auth-code" }, status: "connected" });
    },
  };

  const result = await launchMetaEmbeddedSignup({
    config: {
      appId: "app",
      configId: "cfg",
      graphVersion: "v21.0",
    },
    fb,
    messageTarget: messageTarget as unknown as Window,
    timeoutMs: 2000,
  });
  assert.equal(result.code, "real-auth-code");
  assert.equal(result.wabaId, "111");
  assert.equal(result.phoneNumberId, "222");
  assert.equal((listeners.get("message") || new Set()).size, 0);
});

await test("SDK cancel rejects without fabricating IDs", async () => {
  const listeners = new Map<string, Set<EventListener>>();
  const messageTarget = {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
  };
  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void
    ) {
      cb({ authResponse: null, status: "unknown" });
    },
  };
  await assert.rejects(
    () =>
      launchMetaEmbeddedSignup({
        config: { appId: "a", configId: "c", graphVersion: "v21.0" },
        fb,
        messageTarget: messageTarget as unknown as Window,
        timeoutMs: 1000,
      }),
    (err: unknown) =>
      err instanceof MetaEmbeddedSignupError && err.code === "cancelled"
  );
});

await test("invalid postMessage origin is ignored; timeout fails closed", async () => {
  const listeners = new Map<string, Set<EventListener>>();
  const messageTarget = {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(origin: string, data: unknown) {
      const event = { origin, data } as MessageEvent;
      for (const fn of listeners.get("message") || []) fn(event);
    },
  };
  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void
    ) {
      messageTarget.dispatch("https://attacker.example", {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "evil", phone_number_id: "evil" },
      });
      cb({ authResponse: { code: "code-1" }, status: "connected" });
    },
  };
  await assert.rejects(
    () =>
      launchMetaEmbeddedSignup({
        config: { appId: "a", configId: "c", graphVersion: "v21.0" },
        fb,
        messageTarget: messageTarget as unknown as Window,
        timeoutMs: 50,
      }),
    (err: unknown) =>
      err instanceof MetaEmbeddedSignupError && err.code === "timeout"
  );
});

await test("malformed WA payload from Meta origin fails closed", async () => {
  const listeners = new Map<string, Set<EventListener>>();
  const messageTarget = {
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(origin: string, data: unknown) {
      const event = { origin, data } as MessageEvent;
      for (const fn of listeners.get("message") || []) fn(event);
    },
  };
  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void
    ) {
      messageTarget.dispatch("https://www.facebook.com", {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "only-waba" },
      });
      cb({ authResponse: { code: "code-1" }, status: "connected" });
    },
  };
  await assert.rejects(
    () =>
      launchMetaEmbeddedSignup({
        config: { appId: "a", configId: "c", graphVersion: "v21.0" },
        fb,
        messageTarget: messageTarget as unknown as Window,
        timeoutMs: 1000,
      }),
    (err: unknown) =>
      err instanceof MetaEmbeddedSignupError && err.code === "malformed_payload"
  );
});

await test("sanitizeEmbeddedSignupError never echoes raw codes", () => {
  const msg = sanitizeEmbeddedSignupError(
    new Error("failed EAAGabcdefghijklmnop")
  );
  assert.ok(!msg.includes("EAAGabcdefghijklmnop"));
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
