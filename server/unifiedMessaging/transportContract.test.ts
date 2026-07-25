/**
 * Transport-neutral messaging contract characterization tests (Task 2).
 * Run: npm run test:unified-messaging-contract
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertCapability,
  capabilitySet,
  emptyCapabilitySet,
  exampleCapabilityProfile,
  hasCapability,
  OPERATION_REQUIRED_CAPABILITY,
  outboundCapabilityForMessageType,
  requireCapability,
  TRANSPORT_CAPABILITIES,
} from "./transportCapabilities.ts";
import {
  errResult,
  isPermanentTransportError,
  isRetryableTransportError,
  PERMANENT_ERROR_CATEGORIES,
  requireOutboundIdempotencyKey,
  RETRYABLE_ERROR_CATEGORIES,
  TransportContractError,
  TRANSPORT_ERROR_CATEGORIES,
} from "./transportErrors.ts";
import {
  CONNECTION_STATES,
  DELIVERY_STATUSES,
  FORBIDDEN_BROWSER_CONNECTION_FIELDS,
  getTransportChannelDescriptor,
  isExperimentalInternalTransport,
  isMessagingTransport,
  MESSAGE_ORIGINS,
  MESSAGE_TYPES,
  MESSAGING_EVENT_KINDS,
  MESSAGING_TRANSPORTS,
  META_COMPAT_DELIVERY_STATUSES,
  TRANSPORT_CHANNEL_DESCRIPTORS,
  type BrowserSafeConnectionStatus,
  type ConnectionState,
  type MessagingTransport,
  type NormalizedMessageType,
  type TransportCapability,
} from "./index.ts";

let failed = 0;

async function test(
  name: string,
  fn: () => void | Promise<void>
): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Production contract sources only (exclude tests that mention forbidden patterns by name). */
function readProductionModuleSources(): Array<{ file: string; source: string }> {
  return fs
    .readdirSync(MODULE_ROOT)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({
      file: f,
      source: fs.readFileSync(path.join(MODULE_ROOT, f), "utf8"),
    }));
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const re =
    /\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    specs.push(match[1] ?? match[2] ?? "");
  }
  return specs;
}

// ---------------------------------------------------------------------------
// 1–2. Channel identifiers + QR experimental/internal-only
// ---------------------------------------------------------------------------

await test("contract: all required channel identifiers are represented", () => {
  assert.deepEqual([...MESSAGING_TRANSPORTS].sort(), [
    "instagram",
    "messenger",
    "meta_whatsapp_cloud",
    "website_chat",
    "whatsapp_web_qr",
  ]);
  for (const transport of MESSAGING_TRANSPORTS) {
    assert.equal(isMessagingTransport(transport), true);
    assert.ok(TRANSPORT_CHANNEL_DESCRIPTORS[transport]);
    assert.equal(
      getTransportChannelDescriptor(transport).transport,
      transport
    );
  }
  assert.equal(isMessagingTransport("sms"), false);
  assert.equal(isMessagingTransport(null), false);
});

await test(
  "contract: QR channel is experimental, internal-only, independently disableable",
  () => {
    const qr = TRANSPORT_CHANNEL_DESCRIPTORS.whatsapp_web_qr;
    assert.equal(qr.visibility, "experimental");
    assert.equal(qr.audience, "internal_only");
    assert.equal(qr.independentlyDisableable, true);
    assert.equal(isExperimentalInternalTransport("whatsapp_web_qr"), true);
    assert.equal(
      isExperimentalInternalTransport("meta_whatsapp_cloud"),
      false
    );
  }
);

// ---------------------------------------------------------------------------
// 3–4. Connection states, message types, origins
// ---------------------------------------------------------------------------

await test("contract: required connection states are represented", () => {
  const required = [
    "unconfigured",
    "connecting",
    "awaiting_qr",
    "connected",
    "degraded",
    "reconnecting",
    "disconnected",
    "expired",
    "disabled",
    "failed",
  ] as const;
  for (const state of required) {
    assert.ok(
      (CONNECTION_STATES as readonly string[]).includes(state),
      `missing connection state ${state}`
    );
  }
  assert.equal(CONNECTION_STATES.length, required.length);
});

await test(
  "contract: required message types and origins are represented",
  () => {
    for (const t of [
      "text",
      "image",
      "audio",
      "video",
      "document",
      "interactive",
      "template",
      "location",
      "reaction",
      "system",
    ] as const) {
      assert.ok((MESSAGE_TYPES as readonly string[]).includes(t));
    }
    for (const o of [
      "customer",
      "human",
      "ai",
      "bot_flow",
      "system",
      "broadcast",
    ] as const) {
      assert.ok((MESSAGE_ORIGINS as readonly string[]).includes(o));
    }
    for (const kind of MESSAGING_EVENT_KINDS) {
      assert.equal(typeof kind, "string");
    }
  }
);

// ---------------------------------------------------------------------------
// 5. Capability checks reject unsupported ops before dispatch
// ---------------------------------------------------------------------------

await test(
  "contract: capability checks reject unsupported operations before dispatch",
  () => {
    const website = exampleCapabilityProfile("website_chat");
    assert.equal(hasCapability(website, "templates"), false);

    let dispatched = false;
    const gate = assertCapability(
      "website_chat",
      website,
      "send_template"
    );
    assert.equal(gate.ok, false);
    if (!gate.ok) {
      assert.equal(gate.error.category, "capability_unsupported");
      assert.equal(gate.error.retryable, false);
    }
    // Simulate "would dispatch only if ok"
    if (gate.ok) dispatched = true;
    assert.equal(dispatched, false);

    assert.throws(
      () => requireCapability("website_chat", website, "broadcast"),
      (err: unknown) =>
        err instanceof TransportContractError &&
        err.category === "capability_unsupported"
    );

    // Meta profile example includes templates; website does not — no hard-coded universality.
    const meta = exampleCapabilityProfile("meta_whatsapp_cloud");
    assert.equal(hasCapability(meta, "templates"), true);
    assert.equal(hasCapability(website, "broadcasts"), false);
    assert.equal(hasCapability(meta, "broadcasts"), false);

    const qr = exampleCapabilityProfile("whatsapp_web_qr");
    assert.equal(hasCapability(qr, "qr_authentication"), true);
    assert.equal(hasCapability(meta, "qr_authentication"), false);
  }
);

// ---------------------------------------------------------------------------
// 6. Outbound idempotency key required
// ---------------------------------------------------------------------------

await test("contract: outbound requests require an idempotency key", () => {
  assert.equal(requireOutboundIdempotencyKey(undefined).ok, false);
  assert.equal(requireOutboundIdempotencyKey("").ok, false);
  assert.equal(requireOutboundIdempotencyKey("   ").ok, false);
  assert.equal(requireOutboundIdempotencyKey(123 as unknown as string).ok, false);

  const ok = requireOutboundIdempotencyKey(" idem-1 ");
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value, "idem-1");

  const missing = requireOutboundIdempotencyKey(null);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.error.category, "invalid_request");
    assert.equal(missing.error.retryable, false);
  }
});

// ---------------------------------------------------------------------------
// 7. Retryable vs permanent errors
// ---------------------------------------------------------------------------

await test(
  "contract: normalized errors distinguish retryable and permanent failures",
  () => {
    const timeout = new TransportContractError({
      category: "provider_timeout",
      safeMessage: "Provider timed out",
    });
    assert.equal(isRetryableTransportError(timeout), true);
    assert.equal(isPermanentTransportError(timeout), false);

    const unsupported = new TransportContractError({
      category: "capability_unsupported",
      safeMessage: "Not supported",
    });
    assert.equal(isPermanentTransportError(unsupported), true);
    assert.equal(isRetryableTransportError(unsupported), false);

    const rejected = errResult({
      category: "provider_rejected",
      safeMessage: "Rejected by provider",
      providerCode: "131047",
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.error.retryable, false);
      assert.equal(rejected.error.providerCode, "131047");
    }

    for (const category of RETRYABLE_ERROR_CATEGORIES) {
      const err = new TransportContractError({
        category,
        safeMessage: category,
      });
      assert.equal(err.retryable, true, category);
    }
    for (const category of PERMANENT_ERROR_CATEGORIES) {
      const err = new TransportContractError({
        category,
        safeMessage: category,
      });
      assert.equal(err.retryable, false, category);
    }

    assert.ok(TRANSPORT_ERROR_CATEGORIES.includes("signature_invalid"));
    assert.ok(TRANSPORT_ERROR_CATEGORIES.includes("credential_failure"));
  }
);

// ---------------------------------------------------------------------------
// 8. Browser-safe connection status cannot expose credentials
// ---------------------------------------------------------------------------

await test(
  "contract: browser-safe connection status cannot expose credential/session material",
  () => {
    const status: BrowserSafeConnectionStatus = {
      connectionId: "conn_1",
      organizationId: "sunchaser",
      transport: "meta_whatsapp_cloud",
      state: "connected",
      health: "healthy",
      lastSuccessfulActivityAt: "2026-07-24T00:00:00.000Z",
      lastErrorCategory: "none",
      reconnectEligible: true,
      experimental: false,
      internalOnly: false,
      independentlyDisableable: true,
      transportMetadata: {
        phoneNumberIdMasked: "12****0987",
        flags: { connectionMode: "COEXISTENCE" },
      },
      safeErrorSummary: null,
    };

    const serialized = JSON.stringify(status);
    for (const field of FORBIDDEN_BROWSER_CONNECTION_FIELDS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(status, field),
        false,
        `status must not have own property ${field}`
      );
      // Values must not appear as JSON keys either.
      assert.equal(
        serialized.includes(`"${field}"`),
        false,
        `serialized status must not include key ${field}`
      );
    }

    // Type-level shape: only safe fields.
    assert.equal(typeof status.transportMetadata.phoneNumberIdMasked, "string");
    assert.equal(
      (status as unknown as Record<string, unknown>).accessToken,
      undefined
    );
  }
);

// ---------------------------------------------------------------------------
// 9. Delivery statuses compatible with Meta baseline
// ---------------------------------------------------------------------------

await test(
  "contract: delivery statuses remain compatible with sent/delivered/read/failed",
  () => {
    for (const s of META_COMPAT_DELIVERY_STATUSES) {
      assert.ok((DELIVERY_STATUSES as readonly string[]).includes(s));
    }
    assert.deepEqual([...META_COMPAT_DELIVERY_STATUSES], [
      "sent",
      "delivered",
      "read",
      "failed",
    ]);
  }
);

// ---------------------------------------------------------------------------
// 10. No CRM / AI / QR library / browser-storage dependencies
// ---------------------------------------------------------------------------

await test(
  "contract: module has no dependency on CRM, AI, QR libraries, or browser storage",
  () => {
    const files = readProductionModuleSources();
    assert.ok(files.length >= 4, "expected production contract modules");

    const forbiddenSpecifierSubstrings = [
      "whatsappCrm",
      "whatsappInbox",
      "whatsappTransport",
      "aiEngine",
      "ai/providers",
      "@whiskeysockets/baileys",
      "whatsapp-web.js",
      "puppeteer",
      "qrcode",
      "localStorage",
      "sessionStorage",
    ];

    for (const { file, source } of files) {
      assert.equal(
        /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/.test(source),
        false,
        `${file} must not reference browser storage APIs`
      );

      for (const spec of extractImportSpecifiers(source)) {
        for (const banned of forbiddenSpecifierSubstrings) {
          assert.equal(
            spec.toLowerCase().includes(banned.toLowerCase()),
            false,
            `${file} imports forbidden module "${spec}" (matched ${banned})`
          );
        }
        // Only relative imports within this package (or type-only stdlib) are expected.
        assert.ok(
          spec.startsWith("./") || spec.startsWith("node:"),
          `${file} has unexpected import specifier "${spec}"`
        );
      }
    }

    // Contract module itself must stay free of QR SDKs. The experimental
    // connector may live under server/whatsappWeb/ with its own deps.
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(MODULE_ROOT, "../../package.json"),
        "utf8"
      )
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    for (const banned of ["whatsapp-web.js", "puppeteer", "playwright-core"]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(allDeps, banned),
        false,
        `package.json must not depend on ${banned} for WhatsApp connection`
      );
    }
    // If Baileys is present, it must not be imported by unifiedMessaging/.
    if (Object.prototype.hasOwnProperty.call(allDeps, "@whiskeysockets/baileys")) {
      for (const { file, source } of files) {
        assert.equal(
          source.includes("@whiskeysockets/baileys"),
          false,
          `${file} must not import Baileys`
        );
      }
    }
  }
);

// ---------------------------------------------------------------------------
// 11. Existing Meta characterization module remains untouched (by path)
// ---------------------------------------------------------------------------

await test(
  "contract: Meta characterization baseline test file remains present; contract production code does not import it",
  () => {
    const baselinePath = path.resolve(
      MODULE_ROOT,
      "..",
      "whatsappTransport",
      "unifiedMessagingBaseline.test.ts"
    );
    assert.equal(fs.existsSync(baselinePath), true);

    for (const { file, source } of readProductionModuleSources()) {
      const specs = extractImportSpecifiers(source);
      assert.equal(
        specs.some((s) => s.includes("unifiedMessagingBaseline")),
        false,
        `${file} must not import the Meta baseline test`
      );
      assert.equal(
        specs.some((s) => s.includes("whatsappTransport")),
        false,
        `${file} must not import whatsappTransport`
      );
    }
  }
);

// ---------------------------------------------------------------------------
// 12. Type-level exhaustiveness for unions
// ---------------------------------------------------------------------------

await test(
  "contract: type-level exhaustiveness for channel, status, and capability unions",
  () => {
    function assertAllTransports(handler: (t: MessagingTransport) => string) {
      const seen = new Set<string>();
      for (const t of MESSAGING_TRANSPORTS) {
        seen.add(handler(t));
      }
      assert.equal(seen.size, MESSAGING_TRANSPORTS.length);
    }

    assertAllTransports((t) => {
      switch (t) {
        case "meta_whatsapp_cloud":
        case "whatsapp_web_qr":
        case "website_chat":
        case "instagram":
        case "messenger":
          return t;
        default: {
          const _exhaustive: never = t;
          return _exhaustive;
        }
      }
    });

    function assertAllStates(handler: (s: ConnectionState) => string) {
      for (const s of CONNECTION_STATES) {
        assert.equal(handler(s), s);
      }
    }

    assertAllStates((s) => {
      switch (s) {
        case "unconfigured":
        case "connecting":
        case "awaiting_qr":
        case "connected":
        case "degraded":
        case "reconnecting":
        case "disconnected":
        case "expired":
        case "disabled":
        case "failed":
          return s;
        default: {
          const _exhaustive: never = s;
          return _exhaustive;
        }
      }
    });

    function assertAllCapabilities(handler: (c: TransportCapability) => string) {
      for (const c of TRANSPORT_CAPABILITIES) {
        assert.equal(handler(c), c);
      }
    }

    assertAllCapabilities((c) => {
      switch (c) {
        case "text":
        case "inbound_media":
        case "outbound_media":
        case "templates":
        case "interactive_messages":
        case "delivery_receipts":
        case "read_receipts":
        case "reactions":
        case "voice_notes":
        case "broadcasts":
        case "reconnect":
        case "qr_authentication":
        case "webhook_verification":
          return c;
        default: {
          const _exhaustive: never = c;
          return _exhaustive;
        }
      }
    });

    // Exhaustiveness helper for message types used by capability mapping.
    for (const messageType of MESSAGE_TYPES) {
      const op = outboundCapabilityForMessageType(
        messageType as NormalizedMessageType
      );
      if (messageType === "system") {
        assert.equal(op, null);
      } else {
        assert.ok(op);
        assert.ok(
          Object.prototype.hasOwnProperty.call(
            OPERATION_REQUIRED_CAPABILITY,
            op
          )
        );
      }
    }

    // empty set starts fully disabled
    const empty = emptyCapabilitySet();
    for (const c of TRANSPORT_CAPABILITIES) {
      assert.equal(empty[c], false);
    }
    const enabled = capabilitySet(["text", "webhook_verification"]);
    assert.equal(enabled.text, true);
    assert.equal(enabled.webhook_verification, true);
    assert.equal(enabled.templates, false);
  }
);

if (failed > 0) {
  console.error(`\n${failed} unified-messaging contract test(s) failed`);
  process.exit(1);
}
console.log("\nAll unified-messaging transport contract tests passed.");
