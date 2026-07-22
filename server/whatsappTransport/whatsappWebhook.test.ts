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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installWhatsAppRawBodyMiddleware } from "./index.ts";
import { InMemoryWhatsAppRepository } from "./whatsappRepository.ts";
import { parseWebhookRawBody } from "./whatsappEnvelope.ts";
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

await test("16. Inbound image metadata persists without downloading binaries", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              value: {
                messaging_product: "whatsapp",
                metadata: {
                  display_phone_number: "15550001111",
                  phone_number_id: "PNID1",
                },
                contacts: [{ wa_id: "923001234567", profile: { name: "Ali Customer" } }],
                messages: [
                  {
                    from: "923001234567",
                    id: "wamid.IMG1",
                    timestamp: "1700000000",
                    type: "image",
                    image: {
                      id: "MEDIA_IMG_123",
                      mime_type: "image/jpeg",
                      sha256: "img_hash_123",
                      caption: "Roof site photo",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await postWebhook(base, payload);
    assert.equal(res.status, 200);
    assert.equal(repo.messages.size, 1);
    const msg = [...repo.messages.values()][0];
    assert.equal(msg.messageType, "image");
    assert.equal(msg.metaMediaId, "MEDIA_IMG_123");
    assert.equal(msg.mimeType, "image/jpeg");
    assert.equal(msg.sha256, "img_hash_123");
    assert.equal(msg.caption, "Roof site photo");
  });
});

await test("16b. Inbound document metadata persists correctly", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PNID1" },
                contacts: [{ wa_id: "923001234567" }],
                messages: [
                  {
                    from: "923001234567",
                    id: "wamid.DOC1",
                    timestamp: "1700000000",
                    type: "document",
                    document: {
                      id: "MEDIA_DOC_456",
                      mime_type: "application/pdf",
                      filename: "solar_proposal.pdf",
                      caption: "Final Proposal",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await postWebhook(base, payload);
    assert.equal(res.status, 200);
    const msg = [...repo.messages.values()][0];
    assert.equal(msg.messageType, "document");
    assert.equal(msg.metaMediaId, "MEDIA_DOC_456");
    assert.equal(msg.filename, "solar_proposal.pdf");
  });
});

await test("16c. Inbound voice note and audio persist with voice flag", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PNID1" },
                contacts: [{ wa_id: "923001234567" }],
                messages: [
                  {
                    from: "923001234567",
                    id: "wamid.VOICE1",
                    timestamp: "1700000000",
                    type: "audio",
                    audio: {
                      id: "MEDIA_AUD_789",
                      mime_type: "audio/ogg",
                      voice: true,
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await postWebhook(base, payload);
    assert.equal(res.status, 200);
    const msg = [...repo.messages.values()][0];
    assert.equal(msg.messageType, "voice");
    assert.equal(msg.voice, true);
  });
});

await test("16d. Inbound video metadata persists correctly", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PNID1" },
                contacts: [{ wa_id: "923001234567" }],
                messages: [
                  {
                    from: "923001234567",
                    id: "wamid.VID1",
                    timestamp: "1700000000",
                    type: "video",
                    video: {
                      id: "MEDIA_VID_999",
                      mime_type: "video/mp4",
                      caption: "Roof inspection video",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await postWebhook(base, payload);
    assert.equal(res.status, 200);
    const msg = [...repo.messages.values()][0];
    assert.equal(msg.messageType, "video");
    assert.equal(msg.metaMediaId, "MEDIA_VID_999");
  });
});

await test("16e. Inbound location metadata persists coordinates and address", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PNID1" },
                contacts: [{ wa_id: "923001234567" }],
                messages: [
                  {
                    from: "923001234567",
                    id: "wamid.LOC1",
                    timestamp: "1700000000",
                    type: "location",
                    location: {
                      latitude: 31.5204,
                      longitude: 74.3587,
                      name: "Lahore Office",
                      address: "Gulberg III, Lahore",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await postWebhook(base, payload);
    assert.equal(res.status, 200);
    const msg = [...repo.messages.values()][0];
    assert.equal(msg.messageType, "location");
    assert.equal(msg.latitude, 31.5204);
    assert.equal(msg.longitude, 74.3587);
    assert.equal(msg.placeName, "Lahore Office");
  });
});

await test("16f. Unknown message type does not crash webhook", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA1",
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PNID1" },
                contacts: [{ wa_id: "923001234567" }],
                messages: [
                  {
                    from: "923001234567",
                    id: "wamid.UNKNOWN1",
                    timestamp: "1700000000",
                    type: "sticker",
                    sticker: { id: "sticker_123" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await postWebhook(base, payload);
    assert.equal(res.status, 200);
    assert.equal(repo.messages.size, 1);
    const msg = [...repo.messages.values()][0];
    assert.equal(msg.messageType, "sticker");
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

await test("22. Non-Buffer webhook body is rejected", async () => {
  const repo = new InMemoryWhatsAppRepository();
  const config = enabledConfig();
  const app = express();
  // Intentionally use JSON parser (no raw Buffer) to simulate misconfiguration.
  app.use(express.json());
  app.use(
    "/api/integrations/whatsapp",
    createWhatsAppWebhookRouter({ repo, config })
  );
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  try {
    const payload = inboundTextEnvelope({ waMessageId: "wamid.NOBUF" });
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    const res = await fetch(
      `http://127.0.0.1:${port}${WHATSAPP_WEBHOOK_PATH}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sign(raw),
        },
        body: raw,
      }
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(String(body.error), /Buffer/i);
    assert.equal(repo.messages.size, 0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

await test("10-14. Envelope hardening: wrong-type collections do not crash", () => {
  const badEntry = parseWebhookRawBody(
    Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: {} }), "utf8")
  );
  assert.equal(badEntry.ok, false);

  const nullEntry = parseWebhookRawBody(
    Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: null }), "utf8")
  );
  assert.equal(nullEntry.ok, false);

  const badChanges = parseWebhookRawBody(
    Buffer.from(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: "WABA", changes: {} }],
      }),
      "utf8"
    )
  );
  assert.equal(badChanges.ok, true);
  if (badChanges.ok) assert.equal(badChanges.events.length, 0);

  const badMessages = parseWebhookRawBody(
    Buffer.from(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA",
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "1" },
                  messages: {},
                },
              },
            ],
          },
        ],
      }),
      "utf8"
    )
  );
  assert.equal(badMessages.ok, true);
  if (badMessages.ok) assert.equal(badMessages.events.length, 0);

  const badStatuses = parseWebhookRawBody(
    Buffer.from(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA",
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "1" },
                  statuses: {},
                },
              },
            ],
          },
        ],
      }),
      "utf8"
    )
  );
  assert.equal(badStatuses.ok, true);
});

await test("13. Malformed sibling does not block valid sibling message", () => {
  const parsed = parseWebhookRawBody(
    Buffer.from(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA",
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "109876543210987" },
                  contacts: [
                    { wa_id: "923001111111", profile: { name: "One" } },
                    { wa_id: "923002222222", profile: { name: "Two" } },
                  ],
                  messages: [
                    "not-an-object",
                    {
                      from: "923002222222",
                      id: "wamid.VALID",
                      timestamp: "1700000000",
                      type: "text",
                      text: { body: "ok" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
      "utf8"
    )
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const texts = parsed.events.filter((e) => e.kind === "inbound_text");
    assert.equal(texts.length, 1);
    assert.equal(texts[0].kind, "inbound_text");
    if (texts[0].kind === "inbound_text") {
      assert.equal(texts[0].profileName, "Two");
      assert.equal(texts[0].text, "ok");
    }
  }
});

await test("malformed first entry plus valid second entry", () => {
  const parsed = parseWebhookRawBody(
    Buffer.from(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          "bad-entry",
          {
            id: "WABA2",
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "109876543210987" },
                  messages: [
                    {
                      from: "923001234567",
                      id: "wamid.E2",
                      timestamp: "1700000000",
                      type: "text",
                      text: { body: "second" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
      "utf8"
    )
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(
      parsed.events.filter((e) => e.kind === "inbound_text").length,
      1
    );
  }
});

await test("unsupported media does not block valid text sibling", () => {
  const parsed = parseWebhookRawBody(
    Buffer.from(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "WABA",
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "109876543210987" },
                  messages: [
                    {
                      from: "923001234567",
                      id: "wamid.BAD1",
                      timestamp: "1700000000",
                      type: "text",
                      text: { body: 123 as any },
                    },
                    {
                      from: "923001234567",
                      id: "wamid.TXT2",
                      timestamp: "1700000001",
                      type: "text",
                      text: { body: "hello" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
      "utf8"
    )
  );
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.ok(parsed.events.some((e) => e.kind === "unsupported"));
    assert.ok(parsed.events.some((e) => e.kind === "inbound_text"));
  }
});

await test("status event stored; missing related message audited", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = statusEnvelope({
      waMessageId: "wamid.MISSING_MSG",
      status: "delivered",
    });
    const res = await postWebhook(base, payload);
    assert.equal(res.status, 200);
    assert.equal(repo.statusEvents.size, 1);
    assert.ok(
      repo.auditEvents.some((e) => e.eventType === "status_message_not_found")
    );
  });
});

await test("status event insert succeeds but message update failure leaves incomplete", async () => {
  const repo = new InMemoryWhatsAppRepository();
  await repo.insertOutboundMessage({
    conversationId: "tmp",
    textBody: "x",
  });
  // Create a message with wa id for update path, then force update failure.
  const msg = [...repo.messages.values()][0];
  msg.waMessageId = "wamid.UPDFAIL";
  repo.failMessageUpdateAfterStatusInsert = true;

  await withWebhookServer(repo, enabledConfig(), async (base) => {
    const payload = statusEnvelope({
      waMessageId: "wamid.UPDFAIL",
      status: "delivered",
      timestamp: "1700000999",
    });
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    const res = await postWebhook(base, payload, { raw });
    assert.equal(res.status, 500);
    const event = repo.webhookEvents.get(sha256Hex(raw));
    assert.equal(event?.processed, false);
  });
});

await test("23. Migration does not expose WhatsApp tables via using(true)", () => {
  const sql = readFileSync(
    join(process.cwd(), "scripts/whatsapp-transport-schema.sql"),
    "utf8"
  );
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.whatsapp_/i);
  // No permissive create policy for WhatsApp tables.
  assert.equal(/\ncreate policy[\s\S]*whatsapp_[\s\S]*using\s*\(\s*true\s*\)/i.test(sql), false);
  assert.equal(/\ncreate policy[\s\S]*whatsapp_[\s\S]*with check\s*\(\s*true\s*\)/i.test(sql), false);
  // Explicitly ensure the old permissive policy text is not recreated.
  assert.equal(
    /create policy\s+"Enable full access for authenticated backend"/i.test(sql),
    false
  );
});

await test("channel uniqueness repair removes global unique and adds company-aware unique", () => {
  const sql = readFileSync(
    join(process.cwd(), "scripts/whatsapp-transport-schema.sql"),
    "utf8"
  );
  assert.match(
    sql,
    /drop constraint if exists whatsapp_channels_phone_number_id_unique/i
  );
  assert.match(
    sql,
    /drop index if exists public\.whatsapp_channels_phone_number_id_unique/i
  );
  assert.match(
    sql,
    /create unique index if not exists whatsapp_channels_company_phone_uidx/i
  );
  assert.match(
    sql,
    /whatsapp_channels_company_phone_uidx[\s\S]*\(company_id,\s*phone_number_id\)/i
  );
  // Repair comments document single-company / non-tenant scope.
  assert.match(sql, /NOT yet a true tenant security boundary/i);
  // Still no unrestricted RLS policies.
  assert.equal(/create policy[\s\S]*using\s*\(\s*true\s*\)/i.test(sql), false);
});

if (failed > 0) {
  console.error(`\n${failed} webhook test(s) failed`);
  process.exit(1);
}
console.log("\nAll WhatsApp webhook transport tests passed.");
