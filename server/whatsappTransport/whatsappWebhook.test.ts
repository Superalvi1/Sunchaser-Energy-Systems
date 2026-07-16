/**
 * WhatsApp webhook transport tests.
 * Run: npm run test:whatsapp-transport
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import type { AddressInfo } from "net";
import { isPublicApiRoute } from "../middleware/publicRoutes.ts";
import { readWhatsAppConfig } from "./whatsappConfig.ts";
import {
  WHATSAPP_WEBHOOK_MAX_BODY_BYTES,
  WHATSAPP_WEBHOOK_PATH,
} from "./whatsappConstants.ts";
import { installWhatsAppRawBodyMiddleware } from "./index.ts";
import { InMemoryWhatsAppRepository } from "./whatsappRepository.ts";
import { verifyWhatsAppSignature, sha256Hex } from "./whatsappSignature.ts";
import { createWhatsAppWebhookRouter } from "./whatsappWebhookRoutes.ts";

let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`, err);
  }
}

const APP_SECRET = "test-whatsapp-app-secret";
const VERIFY_TOKEN = "test-verify-token";

function sign(raw: Buffer, secret = APP_SECRET): string {
  const hex = createHmac("sha256", secret).update(raw).digest("hex");
  return `sha256=${hex}`;
}

function enabledConfig(overrides: Record<string, string> = {}) {
  return readWhatsAppConfig({
    WHATSAPP_CONVERSATIONS_ENABLED: "true",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_ACCESS_TOKEN: "token",
    WHATSAPP_PHONE_NUMBER_ID: "pnid-1",
    WHATSAPP_GRAPH_API_VERSION: "v21.0",
    ...overrides,
  });
}

function inboundTextEnvelope(opts: {
  waMessageId?: string;
  text?: string;
  from?: string;
  phoneNumberId?: string;
  type?: string;
} = {}) {
  const waMessageId = opts.waMessageId ?? "wamid.TEXT1";
  const type = opts.type ?? "text";
  const message: Record<string, unknown> = {
    from: opts.from ?? "923001234567",
    id: waMessageId,
    timestamp: "1700000000",
    type,
  };
  if (type === "text") {
    message.text = { body: opts.text ?? "Hello from Meta" };
  } else if (type === "image") {
    message.image = { id: "img-1", mime_type: "image/jpeg" };
  }
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA123",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551234567",
                phone_number_id: opts.phoneNumberId ?? "pnid-1",
              },
              contacts: [
                {
                  profile: { name: "Ali" },
                  wa_id: opts.from ?? "923001234567",
                },
              ],
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

function statusEnvelope(opts: {
  waMessageId?: string;
  status?: string;
  timestamp?: string;
} = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA123",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551234567",
                phone_number_id: "pnid-1",
              },
              statuses: [
                {
                  id: opts.waMessageId ?? "wamid.OUT1",
                  status: opts.status ?? "delivered",
                  timestamp: opts.timestamp ?? "1700000100",
                  recipient_id: "923001234567",
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

type HttpResult = { status: number; body: any; text: string };

async function withWebhookServer(
  repo: InMemoryWhatsAppRepository,
  config: ReturnType<typeof enabledConfig>,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  installWhatsAppRawBodyMiddleware(app);
  app.use(express.json({ limit: "1mb" }));
  app.post("/api/echo-json", (req, res) => {
    res.status(200).json({ parsed: req.body, isBuffer: Buffer.isBuffer(req.body) });
  });
  app.use(
    "/api/integrations/whatsapp",
    createWhatsAppWebhookRouter({ repo, config })
  );

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

async function getWebhook(
  baseUrl: string,
  query: Record<string, string>
): Promise<HttpResult> {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${baseUrl}${WHATSAPP_WEBHOOK_PATH}?${qs}`);
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

async function postWebhook(
  baseUrl: string,
  payload: unknown,
  opts: { secret?: string; signature?: string | null; raw?: Buffer } = {}
): Promise<HttpResult> {
  const raw =
    opts.raw ??
    Buffer.from(
      typeof payload === "string" ? payload : JSON.stringify(payload),
      "utf8"
    );
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.signature === null) {
    // omit signature
  } else if (opts.signature) {
    headers["x-hub-signature-256"] = opts.signature;
  } else {
    headers["x-hub-signature-256"] = sign(raw, opts.secret ?? APP_SECRET);
  }
  const res = await fetch(`${baseUrl}${WHATSAPP_WEBHOOK_PATH}`, {
    method: "POST",
    headers,
    body: new Uint8Array(raw),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
}

// --- GET verification ---

await test("1. Correct token returns challenge", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const res = await getWebhook(base, {
      "hub.mode": "subscribe",
      "hub.verify_token": VERIFY_TOKEN,
      "hub.challenge": "challenge-123",
    });
    assert.equal(res.status, 200);
    assert.equal(res.text, "challenge-123");
  });
});

await test("2. Wrong token returns 403", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const res = await getWebhook(base, {
      "hub.mode": "subscribe",
      "hub.verify_token": "wrong",
      "hub.challenge": "x",
    });
    assert.equal(res.status, 403);
  });
});

await test("3. Disabled returns 404", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(
    repo,
    enabledConfig({ WHATSAPP_CONVERSATIONS_ENABLED: "false" }),
    async (base) => {
      const res = await getWebhook(base, {
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "x",
      });
      assert.equal(res.status, 404);
    }
  );
});

await test("4. Missing configured token returns 503", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(
    repo,
    enabledConfig({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: "" }),
    async (base) => {
      const res = await getWebhook(base, {
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "x",
      });
      assert.equal(res.status, 503);
    }
  );
});

// --- Signature unit checks ---

await test("5. Known-good raw-body HMAC passes", () => {
  const raw = Buffer.from('{"hello":"world"}', "utf8");
  const result = verifyWhatsAppSignature(raw, sign(raw), APP_SECRET);
  assert.equal(result.ok, true);
});

await test("6. Invalid signature fails", () => {
  const raw = Buffer.from('{"hello":"world"}', "utf8");
  const result = verifyWhatsAppSignature(
    raw,
    "sha256=" + "ab".repeat(32),
    APP_SECRET
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid");
});

await test("7. Missing signature fails", () => {
  const raw = Buffer.from("{}", "utf8");
  const result = verifyWhatsAppSignature(raw, undefined, APP_SECRET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing");
});

await test("8. Malformed signature fails", () => {
  const raw = Buffer.from("{}", "utf8");
  assert.equal(verifyWhatsAppSignature(raw, "sha1=abc", APP_SECRET).ok, false);
  assert.equal(
    verifyWhatsAppSignature(raw, "sha256=not-hex", APP_SECRET).ok,
    false
  );
  assert.equal(
    verifyWhatsAppSignature(raw, "sha256=abcd", APP_SECRET).ok,
    false
  );
});

await test("9. Missing app secret fails closed", () => {
  const raw = Buffer.from("{}", "utf8");
  const result = verifyWhatsAppSignature(raw, sign(raw), "");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "missing_secret");
});

await test("10. Signature is checked against raw bytes, not re-serialized JSON", () => {
  // Key order differs from JSON.stringify of a parsed object.
  const raw = Buffer.from('{"b":1,"a":2}', "utf8");
  const good = verifyWhatsAppSignature(raw, sign(raw), APP_SECRET);
  assert.equal(good.ok, true);

  const reSerialized = Buffer.from(JSON.stringify({ b: 1, a: 2 }), "utf8");
  // Depending on engine key order, re-serialized may differ; force a different byte sequence.
  const differentBytes = Buffer.from('{"a":2,"b":1}', "utf8");
  assert.notEqual(raw.toString("utf8"), differentBytes.toString("utf8"));
  const againstDifferent = verifyWhatsAppSignature(
    differentBytes,
    sign(raw),
    APP_SECRET
  );
  assert.equal(againstDifferent.ok, false);

  // Prove re-serialized signature would not match original raw when bytes differ.
  if (reSerialized.toString("utf8") !== raw.toString("utf8")) {
    const againstReserializedSig = verifyWhatsAppSignature(
      raw,
      sign(reSerialized),
      APP_SECRET
    );
    assert.equal(againstReserializedSig.ok, false);
  }
});

// --- Webhook POST ---

await test("11. Valid signed inbound text persists once", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = inboundTextEnvelope({ waMessageId: "wamid.ONCE" });
    const res = await postWebhook(base, payload);
    assert.equal(res.status, 200);
    assert.equal(repo.messages.size, 1);
    assert.equal(repo.contacts.size, 1);
    assert.equal(repo.conversations.size, 1);
    const msg = [...repo.messages.values()][0];
    assert.equal(msg.waMessageId, "wamid.ONCE");
    assert.equal(msg.textBody, "Hello from Meta");
    assert.equal(msg.direction, "inbound");
  });
});

await test("12. Identical processed envelope replay returns 200 without duplicate", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = inboundTextEnvelope({ waMessageId: "wamid.REPLAY" });
    const first = await postWebhook(base, payload);
    const second = await postWebhook(base, payload);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(repo.messages.size, 1);
    assert.ok(
      repo.auditEvents.some((e) => e.eventType === "webhook_duplicate_completed")
    );
  });
});

await test("13. Existing envelope with processed=false safely reprocesses", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const payload = inboundTextEnvelope({ waMessageId: "wamid.REPROCESS" });
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const hash = sha256Hex(raw);
  await repo.claimWebhookEvent(hash);
  // Leave processed=false; no messages yet.
  assert.equal(repo.messages.size, 0);

  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const res = await postWebhook(base, payload, { raw });
    assert.equal(res.status, 200);
    assert.equal(repo.messages.size, 1);
    const event = repo.webhookEvents.get(hash);
    assert.equal(event?.processed, true);
  });
});

await test("14. Duplicate WAMID does not duplicate a message", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const a = inboundTextEnvelope({
      waMessageId: "wamid.SAME",
      text: "first",
    });
    const b = inboundTextEnvelope({
      waMessageId: "wamid.SAME",
      text: "second-different-envelope",
    });
    const r1 = await postWebhook(base, a);
    const r2 = await postWebhook(base, b);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(repo.messages.size, 1);
  });
});

await test("15. Delivery statuses remain individually idempotent", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = statusEnvelope({
      waMessageId: "wamid.STAT",
      status: "delivered",
      timestamp: "1700000100",
    });
    const r1 = await postWebhook(base, payload);
    const r2 = await postWebhook(base, payload);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(repo.statusEvents.size, 1);

    const other = statusEnvelope({
      waMessageId: "wamid.STAT",
      status: "read",
      timestamp: "1700000200",
    });
    const r3 = await postWebhook(base, other);
    assert.equal(r3.status, 200);
    assert.equal(repo.statusEvents.size, 2);
  });
});

await test("16. Unsupported image event does not crash", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = inboundTextEnvelope({
      waMessageId: "wamid.IMG",
      type: "image",
    });
    const res = await postWebhook(base, payload);
    assert.equal(res.status, 200);
    assert.equal(repo.messages.size, 0);
    assert.ok(
      repo.auditEvents.some((e) => e.eventType === "unsupported_message_ignored")
    );
  });
});

await test("17. Signed malformed JSON returns 400", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const raw = Buffer.from('{"entry":', "utf8");
    const res = await postWebhook(base, null, { raw });
    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /Malformed/i);
  });
});

await test("18. Supabase inactive returns 503", async () => {
  const repo = new InMemoryWhatsAppRepository();
  repo.active = false;
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const res = await postWebhook(base, inboundTextEnvelope());
    assert.equal(res.status, 503);
  });
});

await test("19. Oversized payload returns 413", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const huge = Buffer.alloc(WHATSAPP_WEBHOOK_MAX_BODY_BYTES + 1024, 0x61);
    const res = await postWebhook(base, null, {
      raw: huge,
      signature: sign(huge),
    });
    assert.equal(res.status, 413);
  });
});

await test("20. Partial persistence leaves webhook event incomplete/error", async () => {
  const repo = new InMemoryWhatsAppRepository();
  repo.failPersistAfterClaim = "forced partial failure";
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = inboundTextEnvelope({ waMessageId: "wamid.PARTIAL" });
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    const res = await postWebhook(base, payload, { raw });
    assert.equal(res.status, 500);
    const event = repo.webhookEvents.get(sha256Hex(raw));
    assert.ok(event);
    assert.equal(event!.processed, false);
    assert.match(String(event!.error), /forced partial failure/);
  });
});

// --- Regression helpers for public allowlist / JSON parsing ---

await test("33a. WhatsApp webhook paths are public allowlisted", () => {
  assert.equal(isPublicApiRoute("GET", WHATSAPP_WEBHOOK_PATH), true);
  assert.equal(isPublicApiRoute("POST", WHATSAPP_WEBHOOK_PATH), true);
});

await test("35. Ordinary JSON endpoint still receives parsed JSON with raw middleware installed", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const res = await fetch(`${base}/api/echo-json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.parsed, { hello: "world" });
    assert.equal(body.isBuffer, false);
  });
});

await test("POST disabled feature returns 404", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(
    repo,
    enabledConfig({ WHATSAPP_CONVERSATIONS_ENABLED: "false" }),
    async (base) => {
      const res = await postWebhook(base, inboundTextEnvelope());
      assert.equal(res.status, 404);
    }
  );
});

await test("POST missing app secret returns 503", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(
    repo,
    enabledConfig({ WHATSAPP_APP_SECRET: "" }),
    async (base) => {
      const res = await postWebhook(base, inboundTextEnvelope());
      assert.equal(res.status, 503);
    }
  );
});

if (failed > 0) {
  console.error(`\n${failed} webhook test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp webhook transport tests passed.");
