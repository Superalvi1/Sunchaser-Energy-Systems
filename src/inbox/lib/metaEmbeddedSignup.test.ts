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
  classifyIgnoredEmbeddedSignupMessage,
  extractEmbeddedSignupProviderError,
  isAllowedMetaMessageOrigin,
  launchMetaEmbeddedSignup,
  loadFacebookSdk,
  logMetaEmbeddedSignupDebug,
  META_EMBEDDED_SIGNUP_ACCEPTED_EVENTS,
  MetaEmbeddedSignupError,
  originHostFromMessageOrigin,
  parseEmbeddedSignupMessageData,
  resetMetaSdkLoaderForTests,
  resolveMetaEmbeddedSignupConfig,
  sanitizeEmbeddedSignupError,
  sanitizeProviderErrorForDebug,
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

async function withCapturedConsoleError<T>(
  fn: () => Promise<T> | T
): Promise<{ result: T; logs: unknown[][] }> {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args);
  };
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.error = original;
  }
}

function debugLogPayloads(logs: unknown[][]): Array<Record<string, unknown>> {
  return logs
    .filter(
      (args) =>
        args[0] === "[MetaEmbeddedSignup DEBUG]" &&
        args[1] != null &&
        typeof args[1] === "object"
    )
    .map((args) => args[1] as Record<string, unknown>);
}

function traceLogPayloads(logs: unknown[][]): Array<Record<string, unknown>> {
  return logs
    .filter(
      (args) =>
        args[0] === "[MetaEmbeddedSignup TRACE]" &&
        args[1] != null &&
        typeof args[1] === "object"
    )
    .map((args) => args[1] as Record<string, unknown>);
}

function serializeLogs(logs: unknown[][]): string {
  return logs
    .map((args) =>
      args
        .map((arg) => {
          try {
            return typeof arg === "string" ? arg : JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(" ")
    )
    .join("\n");
}

function assertSafeDebugLogs(
  logs: unknown[][],
  forbiddenSnippets: string[]
): void {
  for (const payload of debugLogPayloads(logs)) {
    assert.deepEqual(Object.keys(payload).sort(), ["phase", "providerError"]);
    assert.equal(typeof payload.phase, "string");
  }

  const serialized = serializeLogs(logs);
  for (const snippet of forbiddenSnippets) {
    assert.equal(
      serialized.includes(snippet),
      false,
      `debug logs must not contain ${snippet}`
    );
  }

  assert.equal(serialized.includes("sdkResponse"), false);
  assert.equal(serialized.includes("stack"), false);
  assert.equal(serialized.includes("MetaEmbeddedSignupError:"), false);
  assert.equal(serialized.includes("Error:"), false);
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
    {
      status: "error",
      event: "ERROR",
      providerError: { message: "denied" },
    }
  );
});

await test("ERROR extracts allowlisted Meta providerError fields only", () => {
  assert.deepEqual(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: {
        message: "Meta denied onboarding",
        code: 403,
        error_subcode: 1885316,
        fbtrace_id: "A1trace",
        httpStatus: 200,
        waba_id: "must-not-copy",
        access_token: "must-not-copy",
      },
    }),
    {
      status: "error",
      event: "ERROR",
      providerError: {
        message: "Meta denied onboarding",
        code: 403,
        error_subcode: 1885316,
        fbtrace_id: "A1trace",
        httpStatus: 200,
      },
    }
  );
});

await test("providerError omitted when Meta supplied no allowlisted fields", () => {
  assert.deepEqual(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "ERROR",
      data: { waba_id: "waba-only", current_step: "x" },
    }),
    { status: "error", event: "ERROR" }
  );
  assert.equal(
    extractEmbeddedSignupProviderError({
      authResponse: { code: "oauth-code" },
      status: "unknown",
    }),
    undefined
  );
  const appErr = new MetaEmbeddedSignupError(
    "login_error",
    "Embedded Signup reported an error from Meta"
  );
  assert.equal(extractEmbeddedSignupProviderError(appErr), undefined);
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
  assert.equal(capturedLoginOpts?.config_id, "cfg");
  assert.equal(capturedLoginOpts?.response_type, "code");
  assert.equal(capturedLoginOpts?.override_default_response_type, true);
  assert.equal(
    (capturedLoginOpts?.extras as { featureType?: string } | undefined)
      ?.featureType,
    "whatsapp_business_app_onboarding"
  );
  assert.equal(
    (capturedLoginOpts?.extras as { sessionInfoVersion?: string } | undefined)
      ?.sessionInfoVersion,
    "3"
  );
  assert.deepEqual(
    (capturedLoginOpts?.extras as { setup?: unknown } | undefined)?.setup,
    {}
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(capturedLoginOpts ?? {}, "featureType"),
    false
  );
  assert.equal(messageTarget.listenerCount(), 0);
});

await test(
  "coexistence launch: FB.login extras include whatsapp_business_app_onboarding",
  async () => {
    const messageTarget = makeMessageTarget();
    let capturedLoginOpts: Record<string, unknown> | null = null;
    const fb = {
      init() {},
      login(
        cb: (r: {
          authResponse?: { code?: string } | null;
          status?: string;
        }) => void,
        opts: Record<string, unknown>
      ) {
        capturedLoginOpts = opts;
        messageTarget.dispatch("https://www.facebook.com", {
          type: "WA_EMBEDDED_SIGNUP",
          event: "FINISH",
          data: { waba_id: "w1", phone_number_id: "p1" },
        });
        cb({ authResponse: { code: "code-1" }, status: "connected" });
      },
    };

    await launchMetaEmbeddedSignup({
      state: "oauth-coexistence",
      config: { appId: "app", configId: "cfg-coex", graphVersion: "v25.0" },
      fb,
      messageTarget: messageTarget as unknown as Window,
      timeoutMs: 2000,
    });

    assert.ok(capturedLoginOpts);
    assert.equal(capturedLoginOpts.config_id, "cfg-coex");
    assert.equal(capturedLoginOpts.response_type, "code");
    assert.equal(capturedLoginOpts.override_default_response_type, true);
    assert.equal(capturedLoginOpts.state, "oauth-coexistence");
    assert.equal(
      Object.prototype.hasOwnProperty.call(capturedLoginOpts, "featureType"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(capturedLoginOpts, "coexistence"),
      false
    );

    const extras = capturedLoginOpts.extras as Record<string, unknown>;
    assert.deepEqual(extras.setup, {});
    assert.equal(extras.sessionInfoVersion, "3");
    assert.equal(extras.featureType, "whatsapp_business_app_onboarding");
    assert.equal(
      Object.prototype.hasOwnProperty.call(extras, "coexistence"),
      false
    );
  }
);

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
          error_message: "denied",
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
  assert.deepEqual(caught.providerError, {
    message: "denied",
    code: "123",
  });
  const sanitized = sanitizeEmbeddedSignupError(caught);
  assert.equal(sanitized, "Embedded Signup reported an error from Meta");
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
  let capturedLoginOpts: Record<string, unknown> | null = null;
  const fb = {
    init() {},
    login(
      cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void,
      opts: Record<string, unknown>
    ) {
      capturedLoginOpts = opts;
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

  // Assets alone are insufficient — final submit stays blocked until code arrives.
  assert.equal(
    (capturedLoginOpts?.extras as { featureType?: string } | undefined)
      ?.featureType,
    "whatsapp_business_app_onboarding"
  );
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

// ---------------------------------------------------------------------------
// Task 18 — deterministic Meta SDK loader
// ---------------------------------------------------------------------------

type MockFb = {
  initCalls: number;
  loginCalls: number;
  init: (opts: Record<string, unknown>) => void;
  login: (
    cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void,
    opts: Record<string, unknown>
  ) => void;
};

function createMockFb(): MockFb {
  const fb: MockFb = {
    initCalls: 0,
    loginCalls: 0,
    init() {
      fb.initCalls += 1;
    },
    login(cb) {
      fb.loginCalls += 1;
      cb({ authResponse: null, status: "unknown" });
    },
  };
  return fb;
}

type BrowserMock = {
  window: {
    FB?: MockFb;
    fbAsyncInit?: () => void;
    document: DocumentMock;
  };
  document: DocumentMock;
  scripts: ScriptMock[];
  restore: () => void;
};

type ScriptMock = {
  id: string;
  async: boolean;
  src: string;
  onerror: ((ev?: unknown) => void) | null;
  onload: ((ev?: unknown) => void) | null;
  addEventListener: (
    type: string,
    fn: EventListener,
    opts?: { once?: boolean }
  ) => void;
  dispatchError: () => void;
};

type DocumentMock = {
  getElementById: (id: string) => ScriptMock | null;
  createElement: (tag: string) => ScriptMock;
  body: { appendChild: (el: ScriptMock) => ScriptMock };
};

function installBrowserMock(): BrowserMock {
  const scripts: ScriptMock[] = [];
  const byId = new Map<string, ScriptMock>();

  const createScript = (): ScriptMock => {
    const errorListeners = new Set<EventListener>();
    const script: ScriptMock = {
      id: "",
      async: false,
      src: "",
      onerror: null,
      onload: null,
      addEventListener(type, fn, opts) {
        if (type !== "error") return;
        if (opts?.once) {
          const wrap: EventListener = (ev) => {
            errorListeners.delete(wrap);
            fn(ev);
          };
          errorListeners.add(wrap);
          return;
        }
        errorListeners.add(fn);
      },
      dispatchError() {
        if (script.onerror) script.onerror(new Event("error"));
        for (const fn of [...errorListeners]) {
          fn(new Event("error") as Event);
        }
      },
    };
    return script;
  };

  const documentMock: DocumentMock = {
    getElementById(id) {
      return byId.get(id) ?? null;
    },
    createElement(tag) {
      assert.equal(tag, "script");
      return createScript();
    },
    body: {
      appendChild(el) {
        if (el.id) byId.set(el.id, el);
        scripts.push(el);
        return el;
      },
    },
  };

  const win: BrowserMock["window"] = {
    FB: undefined,
    fbAsyncInit: undefined,
    document: documentMock,
  };

  const prevWindow = (globalThis as any).window;
  const prevDocument = (globalThis as any).document;
  (globalThis as any).window = win;
  (globalThis as any).document = documentMock;

  resetMetaSdkLoaderForTests();

  return {
    window: win,
    document: documentMock,
    scripts,
    restore() {
      resetMetaSdkLoaderForTests();
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
      if (prevDocument === undefined) delete (globalThis as any).document;
      else (globalThis as any).document = prevDocument;
    },
  };
}

await test("SDK loader: fresh script load resolves via fbAsyncInit", async () => {
  const browser = installBrowserMock();
  try {
    const pending = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    assert.equal(browser.scripts.length, 1);
    assert.equal(browser.scripts[0]?.id, "facebook-jssdk");
    const fb = createMockFb();
    browser.window.FB = fb;
    assert.equal(typeof browser.window.fbAsyncInit, "function");
    browser.window.fbAsyncInit?.();
    const ready = await pending;
    assert.equal(ready, fb);
    assert.equal(fb.initCalls, 1);
    // No duplicate script on shared in-flight / ready path.
    await loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    assert.equal(browser.scripts.length, 1);
    assert.equal(fb.initCalls, 1);
  } finally {
    browser.restore();
  }
});

await test("SDK loader: existing script + ready window.FB resolves", async () => {
  const browser = installBrowserMock();
  try {
    const existing = browser.document.createElement("script");
    existing.id = "facebook-jssdk";
    existing.src = "https://connect.facebook.net/en_US/sdk.js";
    browser.document.body.appendChild(existing);
    const fb = createMockFb();
    browser.window.FB = fb;

    const ready = await loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    assert.equal(ready, fb);
    assert.equal(fb.initCalls, 1);
    assert.equal(browser.scripts.length, 1);
  } finally {
    browser.restore();
  }
});

await test("SDK loader: existing script + delayed FB readiness resolves", async () => {
  const browser = installBrowserMock();
  try {
    const existing = browser.document.createElement("script");
    existing.id = "facebook-jssdk";
    browser.document.body.appendChild(existing);

    const pending = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    assert.equal(browser.scripts.length, 1);

    await new Promise((r) => setTimeout(r, 30));
    const fb = createMockFb();
    browser.window.FB = fb;
    // Poll should pick this up without requiring a second script tag.
    const ready = await pending;
    assert.equal(ready, fb);
    assert.equal(fb.initCalls, 1);
    assert.equal(browser.scripts.length, 1);
  } finally {
    browser.restore();
  }
});

await test(
  "SDK loader: existing script never ready rejects after timeout",
  async () => {
    const browser = installBrowserMock();
    try {
      const existing = browser.document.createElement("script");
      existing.id = "facebook-jssdk";
      browser.document.body.appendChild(existing);

      const started = Date.now();
      await assert.rejects(
        () => loadFacebookSdk("app", "v25.0", { timeoutMs: 80 }),
        (err: unknown) =>
          err instanceof MetaEmbeddedSignupError &&
          err.code === "sdk_load_failed" &&
          /Meta SDK did not finish loading/i.test(err.message)
      );
      assert.ok(Date.now() - started < 1500);
      assert.equal(browser.scripts.length, 1);
    } finally {
      browser.restore();
    }
  }
);

await test("SDK loader: script error rejects", async () => {
  const browser = installBrowserMock();
  try {
    const pending = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    assert.equal(browser.scripts.length, 1);
    browser.scripts[0]?.dispatchError();
    await assert.rejects(
      () => pending,
      (err: unknown) =>
        err instanceof MetaEmbeddedSignupError &&
        err.code === "sdk_load_failed" &&
        /Failed to load the Facebook JavaScript SDK/i.test(err.message)
    );
  } finally {
    browser.restore();
  }
});

await test("SDK loader: retry after failed/partial load does not hang", async () => {
  const browser = installBrowserMock();
  try {
    const existing = browser.document.createElement("script");
    existing.id = "facebook-jssdk";
    browser.document.body.appendChild(existing);

    await assert.rejects(
      () => loadFacebookSdk("app", "v25.0", { timeoutMs: 60 }),
      (err: unknown) =>
        err instanceof MetaEmbeddedSignupError && err.code === "sdk_load_failed"
    );

    // Retry after partial load — must resolve when FB appears (no hang).
    const pending = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    const fb = createMockFb();
    browser.window.FB = fb;
    const ready = await pending;
    assert.equal(ready, fb);
    assert.equal(browser.scripts.length, 1);
  } finally {
    browser.restore();
  }
});

await test("SDK loader: FB.login is not called before SDK readiness", async () => {
  const browser = installBrowserMock();
  const messageTarget = makeMessageTarget();
  try {
    const pending = launchMetaEmbeddedSignup({
      state: "oauth-state-sdk",
      config: { appId: "a", configId: "c", graphVersion: "v25.0" },
      messageTarget: messageTarget as unknown as Window,
      timeoutMs: 2000,
      sdkLoadTimeoutMs: 1000,
    });

    // While SDK is not ready, login must not have run.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(browser.window.FB, undefined);
    assert.equal(browser.scripts.length, 1);

    const readyFb = createMockFb();
    readyFb.login = (cb) => {
      readyFb.loginCalls += 1;
      cb({ authResponse: null, status: "unknown" });
    };
    browser.window.FB = readyFb;
    browser.window.fbAsyncInit?.();

    await assert.rejects(
      () => pending,
      (err: unknown) =>
        err instanceof MetaEmbeddedSignupError && err.code === "cancelled"
    );
    assert.ok(readyFb.loginCalls >= 1);
    assert.equal(browser.scripts.length, 1);
  } finally {
    browser.restore();
  }
});

// ---------------------------------------------------------------------------
// Task 19 — config isolation + fbAsyncInit chaining
// ---------------------------------------------------------------------------

await test("SDK loader: same-key concurrent callers share one promise", async () => {
  const browser = installBrowserMock();
  try {
    const a = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    const b = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    assert.equal(a, b);
    assert.equal(browser.scripts.length, 1);

    const fb = createMockFb();
    browser.window.FB = fb;
    browser.window.fbAsyncInit?.();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, fb);
    assert.equal(rb, fb);
    assert.equal(fb.initCalls, 1);
    assert.equal(browser.scripts.length, 1);
  } finally {
    browser.restore();
  }
});

await test(
  "SDK loader: different-key concurrent caller does not receive the first promise",
  async () => {
    const browser = installBrowserMock();
    try {
      const first = loadFacebookSdk("app-a", "v25.0", { timeoutMs: 1000 });
      const second = loadFacebookSdk("app-b", "v25.0", { timeoutMs: 1000 });
      assert.notEqual(first, second);
      assert.equal(browser.scripts.length, 1);

      await assert.rejects(
        () => second,
        (err: unknown) =>
          err instanceof MetaEmbeddedSignupError &&
          err.code === "sdk_config_conflict"
      );

      const fb = createMockFb();
      browser.window.FB = fb;
      browser.window.fbAsyncInit?.();
      assert.equal(await first, fb);
    } finally {
      browser.restore();
    }
  }
);

await test("SDK loader: different-key conflict rejects clearly", async () => {
  const browser = installBrowserMock();
  try {
    void loadFacebookSdk("app-a", "v25.0", { timeoutMs: 1000 });
    await assert.rejects(
      () => loadFacebookSdk("app-a", "v24.0", { timeoutMs: 1000 }),
      (err: unknown) =>
        err instanceof MetaEmbeddedSignupError &&
        err.code === "sdk_config_conflict" &&
        /different app configuration/i.test(err.message)
    );
    assert.equal(browser.scripts.length, 1);
  } finally {
    browser.restore();
  }
});

await test("SDK loader: existing fbAsyncInit is called", async () => {
  const browser = installBrowserMock();
  try {
    let previousCalls = 0;
    browser.window.fbAsyncInit = () => {
      previousCalls += 1;
    };

    const pending = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    const fb = createMockFb();
    browser.window.FB = fb;
    browser.window.fbAsyncInit?.();
    await pending;
    assert.equal(previousCalls, 1);
  } finally {
    browser.restore();
  }
});

await test(
  "SDK loader: existing fbAsyncInit throwing does not prevent resolution",
  async () => {
    const browser = installBrowserMock();
    try {
      browser.window.fbAsyncInit = () => {
        throw new Error("previous handler boom");
      };
      const pending = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
      const fb = createMockFb();
      browser.window.FB = fb;
      browser.window.fbAsyncInit?.();
      assert.equal(await pending, fb);
      assert.equal(fb.initCalls, 1);
    } finally {
      browser.restore();
    }
  }
);

await test("SDK loader: existing handler is not called twice", async () => {
  const browser = installBrowserMock();
  try {
    let previousCalls = 0;
    browser.window.fbAsyncInit = () => {
      previousCalls += 1;
    };
    const pending = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
    const chained = browser.window.fbAsyncInit;
    assert.equal(typeof chained, "function");
    const fb = createMockFb();
    browser.window.FB = fb;
    // Duplicate Meta callbacks against the loader-owned wrapper.
    chained?.();
    chained?.();
    await pending;
    assert.equal(previousCalls, 1);
  } finally {
    browser.restore();
  }
});

await test(
  "SDK loader: cleanup does not overwrite a newer fbAsyncInit handler",
  async () => {
    const browser = installBrowserMock();
    try {
      const previous = () => {};
      browser.window.fbAsyncInit = previous;
      const pending = loadFacebookSdk("app", "v25.0", { timeoutMs: 1000 });
      const loaderHandler = browser.window.fbAsyncInit;
      assert.notEqual(loaderHandler, previous);

      const newer = () => {};
      browser.window.fbAsyncInit = newer;

      const fb = createMockFb();
      browser.window.FB = fb;
      // Poll settle path (does not go through overwritten handler).
      await pending;
      assert.equal(browser.window.fbAsyncInit, newer);
    } finally {
      browser.restore();
    }
  }
);

// ---------------------------------------------------------------------------
// Task 20 — clear in-flight state after successful load
// ---------------------------------------------------------------------------

await test(
  "SDK loader: after successful app-a load, no stale in-flight key remains",
  async () => {
    const browser = installBrowserMock();
    try {
      const pendingA = loadFacebookSdk("app-a", "v25.0", { timeoutMs: 1000 });
      const fb = createMockFb();
      browser.window.FB = fb;
      browser.window.fbAsyncInit?.();
      await pendingA;

      // Simulate a later navigation/session where FB is not yet visible but
      // in-flight bookkeeping must not still claim app-a.
      browser.window.FB = undefined;
      let conflict = false;
      const pendingB = loadFacebookSdk("app-b", "v25.0", { timeoutMs: 1000 });
      pendingB.catch((err) => {
        if (
          err instanceof MetaEmbeddedSignupError &&
          err.code === "sdk_config_conflict"
        ) {
          conflict = true;
        }
      });
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(conflict, false);

      const fbB = createMockFb();
      browser.window.FB = fbB;
      const readyB = await pendingB;
      assert.equal(readyB, fbB);
    } finally {
      browser.restore();
    }
  }
);

await test(
  "SDK loader: later app-b is not rejected as conflict after app-a success",
  async () => {
    const browser = installBrowserMock();
    try {
      const fb = createMockFb();
      const pendingA = loadFacebookSdk("app-a", "v25.0", { timeoutMs: 1000 });
      browser.window.FB = fb;
      browser.window.fbAsyncInit?.();
      await pendingA;

      // FB still ready — app-b must take the ready path, not conflict.
      const readyB = await loadFacebookSdk("app-b", "v25.0", { timeoutMs: 1000 });
      assert.equal(readyB, fb);
      assert.equal(fb.initCalls, 2);
    } finally {
      browser.restore();
    }
  }
);

await test(
  "SDK loader: success cleanup does not occur before initFbOnce succeeds",
  async () => {
    const browser = installBrowserMock();
    try {
      let sawConflictDuringInit = false;
      const pending = loadFacebookSdk("app-a", "v25.0", { timeoutMs: 1000 });
      const fb = createMockFb();
      fb.init = () => {
        fb.initCalls += 1;
        // Hide FB so the probe hits the in-flight key path (not the ready path).
        const savedFb = browser.window.FB;
        browser.window.FB = undefined;
        try {
          void loadFacebookSdk("app-b", "v25.0", { timeoutMs: 1000 }).then(
            () => {
              sawConflictDuringInit = false;
            },
            (err) => {
              if (
                err instanceof MetaEmbeddedSignupError &&
                err.code === "sdk_config_conflict"
              ) {
                sawConflictDuringInit = true;
              }
            }
          );
        } finally {
          browser.window.FB = savedFb;
        }
      };
      browser.window.FB = fb;
      browser.window.fbAsyncInit?.();
      await pending;
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(sawConflictDuringInit, true);
      assert.equal(fb.initCalls, 1);
    } finally {
      browser.restore();
    }
  }
);

await test(
  "safe debug logs: allowlisted sanitized providerError only",
  async () => {
    const forbidden = [
      "oauth-auth-code-SECRETVALUE001",
      "EAAGsecretTokenValueABCDEF",
      "Bearer secret.bearer.token.value",
      "oauth-state-SECRETVALUE002",
      "waba-SECRET-ID-999001",
      "phone-SECRET-ID-999002",
      "+15551212999",
      "app-secret-SECRETVALUE003",
      "nonce-SECRETVALUE004",
      "longOpaqueTokenABCDEFGH1234567890",
      "111222333444555",
      "999888777666555",
    ];

    // 1) Full safe provider fields are logged.
    {
      const messageTarget = makeMessageTarget();
      const { logs } = await withCapturedConsoleError(async () => {
        await assert.rejects(() =>
          launchMetaEmbeddedSignup({
            state: "oauth-debug-full",
            config: { appId: "a", configId: "c", graphVersion: "v25.0" },
            fb: {
              init() {},
              login() {
                messageTarget.dispatch("https://www.facebook.com", {
                  type: "WA_EMBEDDED_SIGNUP",
                  event: "ERROR",
                  data: {
                    message: "Meta denied onboarding",
                    code: 403,
                    error_subcode: 1885316,
                    fbtrace_id: "A1trace",
                    httpStatus: 200,
                    waba_id: "waba-SECRET-ID-999001",
                    phone_number_id: "phone-SECRET-ID-999002",
                    access_token: "EAAGsecretTokenValueABCDEF",
                    state: "oauth-state-SECRETVALUE002",
                    customer_phone: "+15551212999",
                    app_secret: "app-secret-SECRETVALUE003",
                    auth_code: "oauth-auth-code-SECRETVALUE001",
                  },
                });
              },
            },
            messageTarget: messageTarget as unknown as Window,
            timeoutMs: 2000,
          })
        );
      });
      const settle = debugLogPayloads(logs).find(
        (p) => p.phase === "launchMetaEmbeddedSignup.settleErr"
      );
      assert.deepEqual(settle?.providerError, {
        message: "Meta denied onboarding",
        code: 403,
        error_subcode: 1885316,
        fbtrace_id: "A1trace",
        httpStatus: 200,
      });
      assertSafeDebugLogs(logs, forbidden);
    }

    // 2) Missing optional fields stay absent.
    {
      const messageTarget = makeMessageTarget();
      const { logs } = await withCapturedConsoleError(async () => {
        await assert.rejects(() =>
          launchMetaEmbeddedSignup({
            state: "oauth-debug-partial",
            config: { appId: "a", configId: "c", graphVersion: "v25.0" },
            fb: {
              init() {},
              login() {
                messageTarget.dispatch("https://www.facebook.com", {
                  type: "WA_EMBEDDED_SIGNUP",
                  event: "ERROR",
                  data: { error_message: "denied" },
                });
              },
            },
            messageTarget: messageTarget as unknown as Window,
            timeoutMs: 2000,
          })
        );
      });
      const settle = debugLogPayloads(logs).find(
        (p) => p.phase === "launchMetaEmbeddedSignup.settleErr"
      );
      assert.deepEqual(settle?.providerError, { message: "denied" });
      assert.equal(
        Object.prototype.hasOwnProperty.call(settle?.providerError ?? {}, "code"),
        false
      );
      assertSafeDebugLogs(logs, forbidden);
    }

    // 3) Malformed payload logs no providerError.
    {
      const messageTarget = makeMessageTarget();
      const { logs } = await withCapturedConsoleError(async () => {
        await assert.rejects(() =>
          launchMetaEmbeddedSignup({
            state: "oauth-debug-empty",
            config: { appId: "a", configId: "c", graphVersion: "v25.0" },
            fb: {
              init() {},
              login() {
                messageTarget.dispatch("https://www.facebook.com", {
                  type: "WA_EMBEDDED_SIGNUP",
                  event: "ERROR",
                  data: {
                    waba_id: "waba-SECRET-ID-999001",
                    phone_number_id: "phone-SECRET-ID-999002",
                    access_token: "EAAGsecretTokenValueABCDEF",
                    state: "oauth-state-SECRETVALUE002",
                  },
                });
              },
            },
            messageTarget: messageTarget as unknown as Window,
            timeoutMs: 2000,
          })
        );
      });
      const settle = debugLogPayloads(logs).find(
        (p) => p.phase === "launchMetaEmbeddedSignup.settleErr"
      );
      assert.equal(settle?.providerError, undefined);
      assertSafeDebugLogs(logs, forbidden);
    }

    // 4/5) Secrets in rejected fields never appear; secrets in message are redacted.
    {
      const messageTarget = makeMessageTarget();
      const { logs } = await withCapturedConsoleError(async () => {
        await assert.rejects(() =>
          launchMetaEmbeddedSignup({
            state: "oauth-debug-message-secret",
            config: { appId: "a", configId: "c", graphVersion: "v25.0" },
            fb: {
              init() {},
              login() {
                messageTarget.dispatch("https://www.facebook.com", {
                  type: "WA_EMBEDDED_SIGNUP",
                  event: "ERROR",
                  data: {
                    message:
                      "denied token=EAAGsecretTokenValueABCDEF phone=+15551212999 id=111222333444555",
                    code: 403,
                  },
                });
              },
            },
            messageTarget: messageTarget as unknown as Window,
            timeoutMs: 2000,
          })
        );
      });
      const settle = debugLogPayloads(logs).find(
        (p) => p.phase === "launchMetaEmbeddedSignup.settleErr"
      );
      const providerError = settle?.providerError as
        | { message?: string; code?: number }
        | undefined;
      assert.equal(providerError?.code, 403);
      assert.equal(typeof providerError?.message, "string");
      assert.ok(providerError?.message?.includes("[REDACTED]"));
      assert.equal(
        providerError?.message?.includes("EAAGsecretTokenValueABCDEF"),
        false
      );
      assert.equal(providerError?.message?.includes("+15551212999"), false);
      assert.equal(providerError?.message?.includes("111222333444555"), false);
      assertSafeDebugLogs(logs, forbidden);
    }

    // 6) Extra runtime properties on providerError are ignored.
    {
      const dirty = {
        message: "ok",
        code: 1,
        access_token: "EAAGsecretTokenValueABCDEF",
        state: "oauth-state-SECRETVALUE002",
        wabaId: "waba-SECRET-ID-999001",
        stack: "Error: boom",
        sdkResponse: { raw: true },
      };
      const sanitized = sanitizeProviderErrorForDebug(
        dirty as unknown as {
          message?: string;
          code?: string | number;
        }
      );
      assert.deepEqual(sanitized, { message: "ok", code: 1 });
      const { logs } = await withCapturedConsoleError(() => {
        logMetaEmbeddedSignupDebug(
          "unit.extra-props",
          dirty as unknown as {
            message?: string;
            code?: string | number;
          }
        );
      });
      assert.deepEqual(logs, [
        [
          "[MetaEmbeddedSignup DEBUG]",
          {
            phase: "unit.extra-props",
            providerError: { message: "ok", code: 1 },
          },
        ],
      ]);
      assertSafeDebugLogs(logs, forbidden);
      // Fresh object — not the same reference.
      assert.notEqual(sanitized, dirty);
    }

    // 7/8) Token-like, phone-like, and ID-like values are redacted.
    {
      const sanitized = sanitizeProviderErrorForDebug({
        message:
          "x longOpaqueTokenABCDEFGH1234567890 y +15551212999 z 999888777666555",
        fbtrace_id: "shortTrace",
        code: 403,
      });
      assert.equal(sanitized?.code, 403);
      assert.equal(sanitized?.fbtrace_id, "shortTrace");
      assert.ok(sanitized?.message?.includes("[REDACTED]"));
      assert.equal(
        sanitized?.message?.includes("longOpaqueTokenABCDEFGH1234567890"),
        false
      );
      assert.equal(sanitized?.message?.includes("+15551212999"), false);
      assert.equal(sanitized?.message?.includes("999888777666555"), false);
    }

    // 9) Never log attached providerError object directly (fresh sanitized copy).
    {
      const attached = {
        message: "denied EAAGsecretTokenValueABCDEF",
        code: 403,
      };
      const { logs } = await withCapturedConsoleError(() => {
        logMetaEmbeddedSignupDebug("unit.fresh-copy", attached);
      });
      const logged = debugLogPayloads(logs)[0]?.providerError as {
        message?: string;
      };
      assert.notEqual(logged, attached);
      assert.ok(logged?.message?.includes("[REDACTED]"));
      assert.equal(logged?.message?.includes("EAAGsecretTokenValueABCDEF"), false);
      assertSafeDebugLogs(logs, forbidden);
    }

    // 10) Signup control flow remains unchanged (success still requires code + FINISH).
    {
      const messageTarget = makeMessageTarget();
      let loginCb:
        | ((r: {
            authResponse?: { code?: string } | null;
            status?: string;
          }) => void)
        | null = null;
      const pending = launchMetaEmbeddedSignup({
        state: "oauth-flow-unchanged",
        config: { appId: "a", configId: "c", graphVersion: "v25.0" },
        fb: {
          init() {},
          login(cb) {
            loginCb = cb;
          },
        },
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
        state: "oauth-flow-unchanged",
        wabaId: "555",
        phoneNumberId: "666",
      });
    }
  }
);

await test("accepted Embedded Signup event names are documented", () => {
  assert.ok(META_EMBEDDED_SIGNUP_ACCEPTED_EVENTS.includes("FINISH"));
  assert.ok(META_EMBEDDED_SIGNUP_ACCEPTED_EVENTS.includes("FINISH_ONLY_WABA"));
  assert.ok(META_EMBEDDED_SIGNUP_ACCEPTED_EVENTS.includes("CANCEL"));
  assert.ok(META_EMBEDDED_SIGNUP_ACCEPTED_EVENTS.includes("ERROR"));
  assert.equal(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "1", phone_number_id: "2" },
    })?.status,
    "success"
  );
  assert.equal(
    parseEmbeddedSignupMessageData({
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_ONLY_WABA",
      data: { waba_id: "1" },
    })?.status,
    "missing_phone"
  );
});

await test("safe TRACE logs never expose payload values, codes, tokens, or origin URL parts", async () => {
  const forbidden = [
    "oauth-auth-code-SECRETVALUE001",
    "EAAGsecretTokenValueABCDEF",
    "oauth-state-SECRETVALUE002",
    "111222333444555",
    "999888777666555",
    "+15551212999",
    "access_token_value",
    "https://www.facebook.com/dialog/oauth?x=1",
    "/dialog/oauth",
    "?x=1",
    "raw-secret-payload",
  ];

  assert.equal(
    originHostFromMessageOrigin("https://www.facebook.com/dialog/oauth?x=1"),
    "www.facebook.com"
  );

  const messageTarget = makeMessageTarget();
  const { logs } = await withCapturedConsoleError(async () => {
    const result = await launchMetaEmbeddedSignup({
      state: "oauth-trace-safety",
      config: { appId: "a", configId: "c", graphVersion: "v25.0" },
      timeoutMs: 2000,
      fb: {
        init() {},
        login(cb) {
          // Malformed JSON string from Meta origin.
          messageTarget.dispatch(
            "https://www.facebook.com/dialog/oauth?x=1",
            "{not-json"
          );
          // Object payload with secrets — only allowlisted key NAMES may appear.
          messageTarget.dispatch("https://www.facebook.com", {
            type: "WA_EMBEDDED_SIGNUP",
            event: "FINISH",
            data: {
              waba_id: "111222333444555",
              phone_number_id: "999888777666555",
              access_token: "EAAGsecretTokenValueABCDEF",
              customer_phone: "+15551212999",
              raw: "raw-secret-payload",
            },
          });
          cb({
            authResponse: { code: "oauth-auth-code-SECRETVALUE001" },
            status: "connected",
          });
        },
      },
      messageTarget: messageTarget as unknown as Window,
    });
    assert.equal(result.code, "oauth-auth-code-SECRETVALUE001");
  });

  const serialized = serializeLogs(logs);
  for (const snippet of forbidden) {
    assert.equal(
      serialized.includes(snippet),
      false,
      `TRACE/DEBUG must not contain ${snippet}`
    );
  }

  const received = traceLogPayloads(logs).filter(
    (p) => p.phase === "window.message.received"
  );
  assert.ok(received.length >= 2);
  for (const payload of received) {
    assert.equal(payload.originHost, "www.facebook.com");
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "data"), false);
    assert.deepEqual(Object.keys(payload).sort(), [
      "dataKeys",
      "dataType",
      "event",
      "originHost",
      "parsed",
      "phase",
      "type",
    ]);
  }

  const finishReceived = received.find((p) => p.event === "FINISH");
  assert.deepEqual(finishReceived?.dataKeys, ["phone_number_id", "waba_id"]);

  const ignoredJson = traceLogPayloads(logs).find(
    (p) =>
      p.phase === "window.message.ignored" && p.reason === "json_parse_failed"
  );
  assert.ok(ignoredJson);

  const loginTrace = traceLogPayloads(logs).find(
    (p) => p.phase === "fb.login.callback"
  );
  assert.deepEqual(loginTrace, {
    phase: "fb.login.callback",
    callbackReceived: true,
    hasAuthResponse: true,
    hasAuthorizationCode: true,
    status: "connected",
  });
});

await test("TRACE A: code received but no FINISH reports waiting then timeout counterpart", async () => {
  const messageTarget = makeMessageTarget();
  const { logs } = await withCapturedConsoleError(async () => {
    await assert.rejects(
      () =>
        launchMetaEmbeddedSignup({
          state: "oauth-trace-a",
          config: { appId: "a", configId: "c", graphVersion: "v25.0" },
          timeoutMs: 60,
          fb: {
            init() {},
            login(cb) {
              cb({
                authResponse: { code: "oauth-auth-code-SECRETVALUE001" },
                status: "connected",
              });
            },
          },
          messageTarget: messageTarget as unknown as Window,
        }),
      (err: unknown) =>
        err instanceof MetaEmbeddedSignupError && err.code === "timeout"
    );
  });

  const waiting = traceLogPayloads(logs).find(
    (p) => p.phase === "terminal.waiting_for_counterpart"
  );
  assert.deepEqual(waiting, {
    phase: "terminal.waiting_for_counterpart",
    hasAuthorizationCode: true,
    hasFinishEvent: false,
  });

  const timeout = traceLogPayloads(logs).find(
    (p) => p.phase === "terminal.timeout"
  );
  assert.ok(timeout);
  assert.equal(timeout.loginCallbackReceived, true);
  assert.equal(timeout.hasAuthorizationCode, true);
  assert.equal(timeout.finishEventReceived, false);
  assert.equal(timeout.recognizedEmbeddedSignupMessageCount, 0);
  assert.equal(typeof timeout.elapsedMs, "number");
  assert.equal(
    serializeLogs(logs).includes("oauth-auth-code-SECRETVALUE001"),
    false
  );
});

await test("TRACE B: FINISH received but no code reports waiting then timeout counterpart", async () => {
  const messageTarget = makeMessageTarget();
  const { logs } = await withCapturedConsoleError(async () => {
    await assert.rejects(
      () =>
        launchMetaEmbeddedSignup({
          state: "oauth-trace-b",
          config: { appId: "a", configId: "c", graphVersion: "v25.0" },
          timeoutMs: 60,
          fb: {
            init() {},
            login() {
              messageTarget.dispatch("https://www.facebook.com", {
                type: "WA_EMBEDDED_SIGNUP",
                event: "FINISH",
                data: {
                  waba_id: "111222333444555",
                  phone_number_id: "999888777666555",
                },
              });
              // No FB.login callback — production hang shape.
            },
          },
          messageTarget: messageTarget as unknown as Window,
        }),
      (err: unknown) =>
        err instanceof MetaEmbeddedSignupError && err.code === "timeout"
    );
  });

  const waiting = traceLogPayloads(logs).find(
    (p) => p.phase === "terminal.waiting_for_counterpart"
  );
  assert.deepEqual(waiting, {
    phase: "terminal.waiting_for_counterpart",
    hasAuthorizationCode: false,
    hasFinishEvent: true,
  });

  const timeout = traceLogPayloads(logs).find(
    (p) => p.phase === "terminal.timeout"
  );
  assert.ok(timeout);
  assert.equal(timeout.loginCallbackReceived, false);
  assert.equal(timeout.hasAuthorizationCode, false);
  assert.equal(timeout.finishEventReceived, true);
  assert.equal(timeout.recognizedEmbeddedSignupMessageCount, 1);
  assert.equal(serializeLogs(logs).includes("111222333444555"), false);
  assert.equal(serializeLogs(logs).includes("999888777666555"), false);

  const received = traceLogPayloads(logs).find(
    (p) => p.phase === "window.message.received" && p.parsed === true
  );
  assert.deepEqual(received?.dataKeys, ["phone_number_id", "waba_id"]);
});

await test("TRACE C: no recognized Meta message times out with zero recognized count", async () => {
  const messageTarget = makeMessageTarget();
  const { logs } = await withCapturedConsoleError(async () => {
    await assert.rejects(
      () =>
        launchMetaEmbeddedSignup({
          state: "oauth-trace-c",
          config: { appId: "a", configId: "c", graphVersion: "v25.0" },
          timeoutMs: 60,
          fb: {
            init() {},
            login() {
              messageTarget.dispatch("https://evil.example", {
                type: "WA_EMBEDDED_SIGNUP",
                event: "FINISH",
                data: { waba_id: "1", phone_number_id: "2" },
              });
              messageTarget.dispatch("https://www.facebook.com", {
                hello: "noise",
              });
            },
          },
          messageTarget: messageTarget as unknown as Window,
        }),
      (err: unknown) =>
        err instanceof MetaEmbeddedSignupError && err.code === "timeout"
    );
  });

  const ignoredOrigin = traceLogPayloads(logs).find(
    (p) =>
      p.phase === "window.message.ignored" && p.reason === "origin_not_allowed"
  );
  assert.ok(ignoredOrigin);
  assert.equal(ignoredOrigin.originHost, "evil.example");

  const ignoredType = traceLogPayloads(logs).find(
    (p) =>
      p.phase === "window.message.ignored" && p.reason === "wrong_message_type"
  );
  assert.ok(ignoredType);

  const timeout = traceLogPayloads(logs).find(
    (p) => p.phase === "terminal.timeout"
  );
  assert.ok(timeout);
  assert.equal(timeout.loginCallbackReceived, false);
  assert.equal(timeout.hasAuthorizationCode, false);
  assert.equal(timeout.finishEventReceived, false);
  assert.equal(timeout.messageCount, 2);
  assert.equal(timeout.recognizedEmbeddedSignupMessageCount, 0);
});

await test("classifyIgnoredEmbeddedSignupMessage covers malformed JSON and object payloads", () => {
  assert.deepEqual(
    classifyIgnoredEmbeddedSignupMessage("https://www.facebook.com", "{bad"),
    {
      reason: "json_parse_failed",
      originHost: "www.facebook.com",
    }
  );
  assert.equal(
    classifyIgnoredEmbeddedSignupMessage("https://www.facebook.com", {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH",
      data: { waba_id: "1", phone_number_id: "2" },
    }),
    null
  );
  assert.equal(
    classifyIgnoredEmbeddedSignupMessage("https://www.facebook.com", 42)?.reason,
    "unsupported_data_type"
  );
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
