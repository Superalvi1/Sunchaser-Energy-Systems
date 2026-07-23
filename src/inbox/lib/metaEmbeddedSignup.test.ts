/**
 * Meta Embedded Signup frontend helper tests (RC-1.2.4B / Task 12).
 * No fabricated production IDs — only injected SDK doubles.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "vite";
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

type MessageTarget = {
  addEventListener(type: string, fn: EventListener): void;
  removeEventListener(type: string, fn: EventListener): void;
  dispatch(origin: string, data: unknown): void;
  listenerCount(): number;
};

function makeMessageTarget(): MessageTarget {
  const listeners = new Map<string, Set<EventListener>>();
  return {
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
    listenerCount() {
      return (listeners.get("message") || new Set()).size;
    },
  };
}

await test("Vite can statically replace the direct import.meta.env access", async () => {
  const sourcePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "metaEmbeddedSignup.ts"
  );
  const source = fs.readFileSync(sourcePath, "utf8");
  const transformed = await transformWithEsbuild(source, sourcePath, {
    loader: "ts",
    format: "esm",
  });

  assert.match(transformed.code, /return import\.meta\.env \?\? \{\}/);
  assert.doesNotMatch(transformed.code, /const meta = import\.meta/);
});

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
  assert.equal(isAllowedMetaMessageOrigin("https://business.facebook.com"), true);
  assert.equal(isAllowedMetaMessageOrigin("https://evil.example"), false);
  assert.equal(isAllowedMetaMessageOrigin("https://facebook.com.evil.com"), false);
});

await test("parses FINISH success as object or JSON string", () => {
  const payload = {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH",
    data: { waba_id: "waba-1", phone_number_id: "phone-1" },
  };
  assert.deepEqual(parseEmbeddedSignupMessageData(payload), {
    status: "success",
    event: "FINISH",
    wabaId: "waba-1",
    phoneNumberId: "phone-1",
  });
  assert.deepEqual(parseEmbeddedSignupMessageData(JSON.stringify(payload)), {
    status: "success",
    event: "FINISH",
    wabaId: "waba-1",
    phoneNumberId: "phone-1",
  });
  assert.deepEqual(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data: { waba_id: "waba-2", phone_number_id: "phone-2" },
    }),
    {
      status: "success",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      wabaId: "waba-2",
      phoneNumberId: "phone-2",
    }
  );
});

await test("CANCEL / ERROR classified before requiring asset IDs", () => {
  assert.deepEqual(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "CANCEL",
      data: { current_step: "PHONE_NUMBER_SETUP" },
    }),
    { status: "cancelled", event: "CANCEL" }
  );
  assert.deepEqual(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: { error_message: "denied" },
    }),
    { status: "error", event: "ERROR" }
  );
});

await test("FINISH_ONLY_WABA is explicit missing_phone, incomplete FINISH is malformed", () => {
  assert.deepEqual(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_ONLY_WABA",
      data: { waba_id: "waba-only", business_id: "biz-1" },
    }),
    {
      status: "missing_phone",
      event: "FINISH_ONLY_WABA",
      wabaId: "waba-only",
    }
  );
  assert.deepEqual(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "waba-1" },
    }),
    { status: "malformed" }
  );
  assert.equal(parseEmbeddedSignupMessageData({ type: "OTHER" }), null);
});

await test("A: FB.login never callbacks — timeout settles cleanly", async () => {
  const messageTarget = makeMessageTarget();
  let unhandled: unknown = null;
  const onUnhandled = (reason: unknown) => {
    unhandled = reason;
  };
  process.on("unhandledRejection", onUnhandled);

  const started = Date.now();
  try {
    await assert.rejects(
      () =>
        launchMetaEmbeddedSignup({
          state: "oauth-state-timeout",
          config: { appId: "a", configId: "c", graphVersion: "v21.0" },
          fb: {
            init() {},
            login() {
              /* never invokes callback */
            },
          },
          messageTarget: messageTarget as unknown as Window,
          timeoutMs: 40,
        }),
      (err: unknown) =>
        err instanceof MetaEmbeddedSignupError && err.code === "timeout"
    );
    assert.ok(Date.now() - started < 1500, "must settle promptly on timeout");
    assert.equal(messageTarget.listenerCount(), 0);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(unhandled, null);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

await test("B: success with JSON-string FINISH + login code", async () => {
  const messageTarget = makeMessageTarget();
  let capturedLoginOpts: Record<string, unknown> | null = null;
  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void,
      opts: Record<string, unknown>
    ) {
      capturedLoginOpts = opts;
      messageTarget.dispatch(
        "https://www.facebook.com",
        JSON.stringify({
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: { waba_id: "111", phone_number_id: "222" },
        })
      );
      cb({ authResponse: { code: "real-auth-code" }, status: "connected" });
    },
  };

  const result = await launchMetaEmbeddedSignup({
    state: "server-issued-oauth-state",
    config: { appId: "app", configId: "cfg", graphVersion: "v21.0" },
    fb,
    messageTarget: messageTarget as unknown as Window,
    timeoutMs: 2000,
  });
  assert.equal(result.code, "real-auth-code");
  assert.equal(result.state, "server-issued-oauth-state");
  assert.equal(result.wabaId, "111");
  assert.equal(result.phoneNumberId, "222");
  assert.equal(capturedLoginOpts?.state, "server-issued-oauth-state");
  assert.equal(messageTarget.listenerCount(), 0);
});

await test("C: success with object-form FINISH", async () => {
  const messageTarget = makeMessageTarget();
  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void
    ) {
      messageTarget.dispatch("https://www.facebook.com", {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "333", phone_number_id: "444" },
      });
      cb({ authResponse: { code: "code-obj" }, status: "connected" });
    },
  };

  const result = await launchMetaEmbeddedSignup({
    state: "state-obj",
    config: { appId: "app", configId: "cfg", graphVersion: "v21.0" },
    fb,
    messageTarget: messageTarget as unknown as Window,
    timeoutMs: 2000,
  });
  assert.deepEqual(result, {
    code: "code-obj",
    state: "state-obj",
    wabaId: "333",
    phoneNumberId: "444",
  });
});

await test("D: CANCEL without asset IDs cancels immediately", async () => {
  const messageTarget = makeMessageTarget();
  const fb = {
    init() {},
    login() {
      messageTarget.dispatch("https://www.facebook.com", {
        type: "WA_EMBEDDED_SIGNUP",
        event: "CANCEL",
        data: { current_step: "PHONE_NUMBER_SETUP" },
      });
    },
  };

  await assert.rejects(
    () =>
      launchMetaEmbeddedSignup({
        state: "oauth-cancel",
        config: { appId: "a", configId: "c", graphVersion: "v21.0" },
        fb,
        messageTarget: messageTarget as unknown as Window,
        timeoutMs: 2000,
      }),
    (err: unknown) =>
      err instanceof MetaEmbeddedSignupError && err.code === "cancelled"
  );
  assert.equal(messageTarget.listenerCount(), 0);
});

await test("E: ERROR without asset IDs returns sanitized provider error", async () => {
  const messageTarget = makeMessageTarget();
  const fb = {
    init() {},
    login() {
      messageTarget.dispatch("https://www.facebook.com", {
        type: "WA_EMBEDDED_SIGNUP",
        event: "ERROR",
        data: {
          error_message: "denied EAAGabcdefghijklmnop",
          error_code: "123",
        },
      });
    },
  };

  let caught: unknown = null;
  try {
    await launchMetaEmbeddedSignup({
      state: "oauth-error",
      config: { appId: "a", configId: "c", graphVersion: "v21.0" },
      fb,
      messageTarget: messageTarget as unknown as Window,
      timeoutMs: 2000,
    });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof MetaEmbeddedSignupError);
  assert.equal(caught.code, "login_error");
  const sanitized = sanitizeEmbeddedSignupError(caught);
  assert.ok(!sanitized.includes("EAAGabcdefghijklmnop"));
  assert.equal(messageTarget.listenerCount(), 0);
});

await test("F: FINISH_ONLY_WABA returns missing_phone_number_id without timeout", async () => {
  const messageTarget = makeMessageTarget();
  const started = Date.now();
  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void
    ) {
      messageTarget.dispatch("https://www.facebook.com", {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH_ONLY_WABA",
        data: { waba_id: "waba-only" },
      });
      cb({ authResponse: { code: "code-1" }, status: "connected" });
    },
  };

  await assert.rejects(
    () =>
      launchMetaEmbeddedSignup({
        state: "oauth-finish-only-waba",
        config: { appId: "a", configId: "c", graphVersion: "v21.0" },
        fb,
        messageTarget: messageTarget as unknown as Window,
        timeoutMs: 2000,
      }),
    (err: unknown) =>
      err instanceof MetaEmbeddedSignupError &&
      err.code === "missing_phone_number_id"
  );
  assert.ok(Date.now() - started < 1000);
});

await test("G: late callbacks/messages after settlement are ignored", async () => {
  const messageTarget = makeMessageTarget();
  let loginCb:
    | ((r: { authResponse?: { code?: string } | null; status?: string }) => void)
    | null = null;
  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void
    ) {
      loginCb = cb;
      messageTarget.dispatch("https://www.facebook.com", {
        type: "WA_EMBEDDED_SIGNUP",
        event: "FINISH",
        data: { waba_id: "111", phone_number_id: "222" },
      });
      cb({ authResponse: { code: "first-code" }, status: "connected" });
    },
  };

  const result = await launchMetaEmbeddedSignup({
    state: "oauth-late",
    config: { appId: "a", configId: "c", graphVersion: "v21.0" },
    fb,
    messageTarget: messageTarget as unknown as Window,
    timeoutMs: 2000,
  });
  assert.equal(result.code, "first-code");

  // Late events must not throw or re-resolve.
  messageTarget.dispatch("https://www.facebook.com", {
    type: "WA_EMBEDDED_SIGNUP",
    event: "CANCEL",
    data: { current_step: "PHONE_NUMBER_SETUP" },
  });
  loginCb?.({ authResponse: { code: "second-code" }, status: "connected" });
  assert.equal(messageTarget.listenerCount(), 0);
});

await test("H: does not resolve until code + wabaId + phoneNumberId are present", async () => {
  const messageTarget = makeMessageTarget();
  let loginCb:
    | ((r: { authResponse?: { code?: string } | null; status?: string }) => void)
    | null = null;
  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void
    ) {
      loginCb = cb;
    },
  };

  const pending = launchMetaEmbeddedSignup({
    state: "oauth-partial",
    config: { appId: "a", configId: "c", graphVersion: "v21.0" },
    fb,
    messageTarget: messageTarget as unknown as Window,
    timeoutMs: 500,
  });

  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );

  // Assets alone are insufficient.
  messageTarget.dispatch("https://www.facebook.com", {
    type: "WA_EMBEDDED_SIGNUP",
    event: "FINISH",
    data: { waba_id: "555", phone_number_id: "666" },
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false);

  loginCb?.({ authResponse: { code: "final-code" }, status: "connected" });
  const result = await pending;
  assert.deepEqual(result, {
    code: "final-code",
    state: "oauth-partial",
    wabaId: "555",
    phoneNumberId: "666",
  });
});

await test("missing OAuth state fails closed before FB.login", async () => {
  let loginCalled = false;
  const fb = {
    init() {},
    login() {
      loginCalled = true;
    },
  };
  await assert.rejects(
    () =>
      launchMetaEmbeddedSignup({
        state: "   ",
        config: { appId: "a", configId: "c", graphVersion: "v21.0" },
        fb,
        timeoutMs: 1000,
      }),
    (err: unknown) =>
      err instanceof MetaEmbeddedSignupError && err.code === "missing_state"
  );
  assert.equal(loginCalled, false);
});

await test("SDK cancel rejects without fabricating IDs", async () => {
  const messageTarget = makeMessageTarget();
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
        state: "oauth-state-1",
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
  const messageTarget = makeMessageTarget();
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
        state: "oauth-state-2",
        config: { appId: "a", configId: "c", graphVersion: "v21.0" },
        fb,
        messageTarget: messageTarget as unknown as Window,
        timeoutMs: 50,
      }),
    (err: unknown) =>
      err instanceof MetaEmbeddedSignupError && err.code === "timeout"
  );
});

await test("malformed WA FINISH payload from Meta origin fails closed", async () => {
  const messageTarget = makeMessageTarget();
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
        state: "oauth-state-3",
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
