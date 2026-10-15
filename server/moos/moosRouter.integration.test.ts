/**
 * Moos router integration tests — full HTTP orchestration against the real
 * in-memory inbox repositories (ownership, idempotency, messages) with the
 * Meta/credential/storage/actor seams stubbed.
 *
 * Covers: auth, MOOS_ENABLED kill switch, ownership gate, 24h window,
 * idempotent sends, duplicate suppression, quote re-validation
 * (expired/unapproved/missing/invalid PDF), provider failure mapping
 * (failed-known vs outcome-unknown vs unknown-retry), draft replay
 * protection, handoff, and customer isolation.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=0 tsx server/moos/moosRouter.integration.test.ts
 *
 * Deterministic — no network, no Supabase, no Meta. The live Meta path
 * (media upload → document send) is unit-tested in
 * server/whatsappTransport/whatsappGraphClient.test.ts; device delivery is
 * verified in staging.
 */
import assert from "node:assert/strict";
import express from "express";
import { createMoosRouter } from "./moosRouter.ts";
import { createInMemoryWhatsAppInboxRepositories } from "../whatsappTransport/whatsappInboxRepository.ts";

const TOKEN = "test-moos-token";

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

const nowIso = () => new Date().toISOString();
const hoursAgoIso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function validQuote(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `${id} title`,
    description: `${id} description`,
    capacityKw: 10,
    approved: true,
    expiresAt: "2030-12-31T00:00:00.000Z",
    storagePath: `quotes/${id}.pdf`,
    systemType: "hybrid",
    phase: "single",
    batteryIncluded: true,
    ...overrides,
  };
}

type Ctx = {
  base: string;
  close: () => Promise<void>;
  calls: {
    sendText: any[];
    deliverDocument: any[];
    createQuote: any[];
    handoffs: any[];
  };
  inbox: ReturnType<typeof createInMemoryWhatsAppInboxRepositories>;
  deliverBehavior: { kind: "ok" | "timeout" | "provider" };
  pdfBytes: Buffer | null;
  /** Artificial delay (ms) for the stubbed PDF fetch — race-condition tests. */
  fetchDelayMs: number;
  /** Fresh legacy-agent switch for send-boundary mutual-exclusion tests. */
  legacyAiOn: boolean;
  /** wamid → { conversationId, direction } index for draft-binding tests. */
  wamidIndex: Map<string, { conversationId: string; direction: string }>;
  seedConversation: (id: string, opts?: { state?: string; assigned?: string | null; status?: string; inboundHoursAgo?: number | null; phone?: string }) => void;
  seedInboundWamid: (conversationId: string, wamid: string, direction?: string) => void;
};

async function setup(quotes: any[] = []): Promise<Ctx> {
  const prevToken = process.env.MOOS_SERVICE_TOKEN;
  const prevEnabled = process.env.MOOS_ENABLED;
  const prevRecipientScope = process.env.MOOS_TEST_ONLY_RECIPIENT_E164;
  delete process.env.MOOS_TEST_ONLY_RECIPIENT_E164;
  process.env.MOOS_SERVICE_TOKEN = TOKEN;
  process.env.MOOS_ENABLED = "true";

  const inbox = createInMemoryWhatsAppInboxRepositories();
  const calls = { sendText: [] as any[], deliverDocument: [] as any[], createQuote: [] as any[], handoffs: [] as any[] };
  const ctx: Ctx = {
    base: "",
    close: async () => {
      if (prevToken === undefined) delete process.env.MOOS_SERVICE_TOKEN;
      else process.env.MOOS_SERVICE_TOKEN = prevToken;
      if (prevEnabled === undefined) delete process.env.MOOS_ENABLED;
      else process.env.MOOS_ENABLED = prevEnabled;
      if (prevRecipientScope === undefined) delete process.env.MOOS_TEST_ONLY_RECIPIENT_E164;
      else process.env.MOOS_TEST_ONLY_RECIPIENT_E164 = prevRecipientScope;
    },
    calls,
    inbox,
    deliverBehavior: { kind: "ok" },
    pdfBytes: Buffer.from("%PDF-1.4 fake-bytes-for-tests"),
    fetchDelayMs: 0,
    legacyAiOn: false,
    wamidIndex: new Map(),
    seedConversation(id, opts = {}) {
      const {
        state = "AI_ACTIVE",
        assigned = null,
        status = "open",
        inboundHoursAgo = 1,
        phone = "923001234567",
      } = opts;
      inbox.store.conversations.set(id, {
        id,
        companyId: "sunchaser",
        channelId: "ch-1",
        contactId: `ct-${id}`,
        status: status as any,
        lastMessageAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        assignedUserId: assigned,
        assignedAt: null,
        assignedBy: null,
        lockVersion: 1,
        hasFailedMessage: false,
        aiOwnershipState: state as any,
        phoneE164: phone,
      });
      if (inboundHoursAgo !== null) {
        const at = hoursAgoIso(inboundHoursAgo);
        inbox.store.messages.set(`msg-${id}`, {
          id: `msg-${id}`,
          companyId: "sunchaser",
          conversationId: id,
          direction: "inbound",
          status: "received",
          textBody: "hello",
          createdAt: at,
          occurredAt: at,
        });
      }
      (ctx as any).phones = { ...(ctx as any).phones, [id]: phone };
    },
    seedInboundWamid(conversationId, wamid, direction = "inbound") {
      ctx.wamidIndex.set(wamid, { conversationId, direction });
    },
  };

  const conversationRepoFake = {
    isActive: () => true,
    getConversationBundle: async (conversationId: string) => {
      const convo = inbox.store.conversations.get(conversationId);
      if (!convo) return null;
      const phones = (ctx as any).phones || {};
      return {
        conversation: {},
        contact: { phoneE164: phones[conversationId] || "923001234567" },
        channel: { phoneNumberId: "243825222156651" },
      };
    },
    getMessageByWaMessageId: async (wamid: string) => {
      const hit = ctx.wamidIndex.get(String(wamid || ""));
      if (!hit) return null;
      return {
        id: `wmsg-${wamid}`,
        companyId: "sunchaser",
        conversationId: hit.conversationId,
        direction: hit.direction,
        waMessageId: wamid,
      };
    },
    insertHistoricalOutboundMessage: async (row: any) => {
      (ctx as any).outboundLog = [...((ctx as any).outboundLog || []), row];
    },
    updateConversationLastMessageAt: async () => {},
    insertAuditEvent: async (evt: any) => {
      (ctx as any).audits = [...((ctx as any).audits || []), evt];
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/moos",
    createMoosRouter({
      createQuote: async (requirements: any, phone: string, messageId: string) => {
        calls.createQuote.push({ requirements, phone, messageId });
        if (requirements?.__fail) throw new Error("Panel sizing requires a consultant review.");
        return {
          quoteNumber: `SES-20261015-${String(calls.createQuote.length).padStart(4, "0")}`,
          totalPkr: 1234567,
          url: "https://crm.example/files/q.pdf",
        };
      },
      inboxRepos: () => inbox,
      conversationRepo: () => conversationRepoFake as any,
      loadSettings: async () => ({ settings: { quotations: quotes } as any }),
      fetchQuotePdf: async () => {
        if (ctx.fetchDelayMs) await new Promise((r) => setTimeout(r, ctx.fetchDelayMs));
        return ctx.pdfBytes;
      },
      resolveActor: async () => ({ username: "moos-service" }) as any,
      sendOutboundText: async (conversationId: string, text: string, opts: any) => {
        calls.sendText.push({ conversationId, text, opts });
        return { httpStatus: 201, providerMessageId: "wamid.send1", messageId: "mid-1", status: "sent" } as any;
      },
      deliverDocument: async (input: any) => {
        calls.deliverDocument.push(input);
        if (ctx.deliverBehavior.kind === "timeout") {
          return { ok: false, kind: "timeout", error: "timeout" };
        }
        if (ctx.deliverBehavior.kind === "provider") {
          return { ok: false, kind: "provider", error: "provider rejected the document" };
        }
        return { ok: true, providerMessageId: "wamid.doc1" };
      },
      // Fresh legacy-agent read at the send boundary (tests toggle ctx.legacyAiOn).
      checkLegacyAi: async () => ctx.legacyAiOn,
    })
  );
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  ctx.base = `http://127.0.0.1:${addr.port}/api/moos`;
  const prevClose = ctx.close;
  ctx.close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await prevClose();
  };
  return ctx;
}

async function api(ctx: Ctx, method: string, path: string, body?: any, token: string | null = TOKEN) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${ctx.base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ---------- auth ----------

await test("health needs no auth; others 401 without token", async () => {
  const ctx = await setup();
  try {
    const h = await api(ctx, "GET", "/health", undefined, null);
    assert.equal(h.status, 200);
    assert.equal(h.data.ok, true);
    const q = await api(ctx, "GET", "/approved-quotes", undefined, null);
    assert.equal(q.status, 401);
    const bad = await api(ctx, "GET", "/approved-quotes", undefined, "wrong");
    assert.equal(bad.status, 401);
    const s = await api(ctx, "POST", "/send-text", { conversationId: "x", text: "y", idempotencyKey: "k12345678" }, null);
    assert.equal(s.status, 401);
  } finally {
    await ctx.close();
  }
});

await test("mutating endpoints 503 with moos_disabled when MOOS_ENABLED=false", async () => {
  const ctx = await setup();
  process.env.MOOS_ENABLED = "false";
  try {
    for (const [method, path, body] of [
      ["POST", "/send-text", { conversationId: "c", text: "t", idempotencyKey: "k12345678" }],
      ["POST", "/send-approved-pdf", { conversationId: "c", quoteId: "q", idempotencyKey: "k12345678" }],
      ["POST", "/custom-quote-draft", { conversationId: "c", inboundMessageId: "wamid.x", requirements: {} }],
      ["POST", "/handoff", { conversationId: "c", reason: "r" }],
    ] as const) {
      const r = await api(ctx, method, path, body);
      assert.equal(r.status, 503, `${method} ${path}`);
      assert.equal(r.data.error, "moos_disabled", `${method} ${path}`);
    }
  } finally {
    await ctx.close();
  }
});

// ---------- approved-quotes ----------

await test("approved-quotes returns only approved + unexpired", async () => {
  const ctx = await setup([
    validQuote("q-ok"),
    validQuote("q-expired", { expiresAt: "2020-01-01T00:00:00.000Z" }),
    validQuote("q-unapproved", { approved: false }),
  ]);
  try {
    const r = await api(ctx, "GET", "/approved-quotes");
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.quotes.map((q: any) => q.id), ["q-ok"]);
    assert.equal(r.data.quotes[0].systemType, "hybrid");
    // capacity filter
    const f = await api(ctx, "GET", "/approved-quotes?capacityKw=99");
    assert.deepEqual(f.data.quotes, []);
  } finally {
    await ctx.close();
  }
});

// ---------- send-text ----------

await test("send-text happy path: ownership + window + idempotency", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-1");
  try {
    const r = await api(ctx, "POST", "/send-text", {
      conversationId: "conv-1",
      text: "Assalam-o-Alaikum",
      idempotencyKey: "key-send-001",
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    assert.equal(r.data.providerMessageId, "wamid.send1");
    assert.equal(ctx.calls.sendText.length, 1);
    assert.equal(ctx.calls.sendText[0].conversationId, "conv-1");
    // duplicate key → 409, no second send
    const d = await api(ctx, "POST", "/send-text", {
      conversationId: "conv-1",
      text: "Assalam-o-Alaikum",
      idempotencyKey: "key-send-001",
    });
    assert.equal(d.status, 409);
    assert.equal(ctx.calls.sendText.length, 1);
  } finally {
    await ctx.close();
  }
});

await test("send-text blocked: human-owned conversation", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-h", { state: "HUMAN_HANDLING" });
  try {
    const r = await api(ctx, "POST", "/send-text", {
      conversationId: "conv-h",
      text: "hi",
      idempotencyKey: "key-human-001",
    });
    assert.equal(r.status, 409);
    assert.equal(ctx.calls.sendText.length, 0);
  } finally {
    await ctx.close();
  }
});

await test("send-text blocked: staff-assigned and closed conversations", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-a", { assigned: "user-9" });
  ctx.seedConversation("conv-c", { status: "closed" });
  // conv-ghost is never seeded → unknown conversation fails closed.
  try {
    for (const id of ["conv-a", "conv-c", "conv-ghost"]) {
      const r = await api(ctx, "POST", "/send-text", {
        conversationId: id,
        text: "hi",
        idempotencyKey: `key-block-${id}`,
      });
      assert.equal(r.status, 409, id);
    }
    assert.equal(ctx.calls.sendText.length, 0);
  } finally {
    await ctx.close();
  }
});

await test("send-text blocked: outside 24h window", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-w", { inboundHoursAgo: 25 });
  ctx.seedConversation("conv-now", { inboundHoursAgo: 1 });
  try {
    const r = await api(ctx, "POST", "/send-text", {
      conversationId: "conv-w",
      text: "hi",
      idempotencyKey: "key-window-001",
    });
    assert.equal(r.status, 422);
    assert.equal(ctx.calls.sendText.length, 0);
    const ok = await api(ctx, "POST", "/send-text", {
      conversationId: "conv-now",
      text: "hi",
      idempotencyKey: "key-window-002",
    });
    assert.equal(ok.status, 200);
  } finally {
    await ctx.close();
  }
});

// ---------- send-approved-pdf ----------

await test("send-approved-pdf happy path: bytes validated, document delivered, logged", async () => {
  const ctx = await setup([validQuote("q-10")]);
  ctx.seedConversation("conv-1", { phone: "923009876543" });
  try {
    const r = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-1",
      quoteId: "q-10",
      idempotencyKey: "key-pdf-001",
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.providerMessageId, "wamid.doc1");
    assert.equal(ctx.calls.deliverDocument.length, 1);
    const d = ctx.calls.deliverDocument[0];
    assert.equal(d.quoteId, "q-10");
    assert.equal(d.contactPhoneE164, "923009876543"); // customer isolation: this conversation's contact
    assert.ok(Buffer.from(d.pdfBytes).subarray(0, 5).toString() === "%PDF-");
    assert.ok(d.filename.includes("10kW"));
    const logged = (ctx as any).outboundLog || [];
    assert.equal(logged.length, 1);
    assert.equal(logged[0].messageType, "document");
  } finally {
    await ctx.close();
  }
});

await test("send-approved-pdf refuses expired / unapproved / unknown quotes", async () => {
  const ctx = await setup([
    validQuote("q-exp", { expiresAt: "2020-01-01T00:00:00.000Z" }),
    validQuote("q-unap", { approved: false }),
  ]);
  ctx.seedConversation("conv-1");
  try {
    for (const quoteId of ["q-exp", "q-unap", "q-nope"]) {
      const r = await api(ctx, "POST", "/send-approved-pdf", {
        conversationId: "conv-1",
        quoteId,
        idempotencyKey: `key-pdf-${quoteId}`,
      });
      assert.equal(r.status, 410, quoteId);
    }
    assert.equal(ctx.calls.deliverDocument.length, 0);
  } finally {
    await ctx.close();
  }
});

await test("send-approved-pdf: missing/invalid PDF → 502 failed-known, retry suppressed", async () => {
  const ctx = await setup([validQuote("q-10")]);
  ctx.seedConversation("conv-1");
  try {
    ctx.pdfBytes = null;
    const r1 = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-1",
      quoteId: "q-10",
      idempotencyKey: "key-pdf-miss",
    });
    assert.equal(r1.status, 502);
    assert.equal(ctx.calls.deliverDocument.length, 0);
    // same key again → 409 (failed-known is terminal for this key)
    const r2 = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-1",
      quoteId: "q-10",
      idempotencyKey: "key-pdf-miss",
    });
    assert.equal(r2.status, 409);

    ctx.pdfBytes = Buffer.from("not a pdf at all");
    const r3 = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-1",
      quoteId: "q-10",
      idempotencyKey: "key-pdf-bad",
    });
    assert.equal(r3.status, 502);
    assert.match(r3.data.error, /invalid/i);
  } finally {
    await ctx.close();
  }
});

await test("send-approved-pdf: provider timeout → 202 outcome-unknown, never retried", async () => {
  const ctx = await setup([validQuote("q-10")]);
  ctx.seedConversation("conv-1");
  ctx.deliverBehavior.kind = "timeout";
  try {
    const r1 = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-1",
      quoteId: "q-10",
      idempotencyKey: "key-pdf-timeout",
    });
    assert.equal(r1.status, 202);
    assert.equal(r1.data.status, "outcome_unknown");
    // retry with the same key is suppressed, not re-attempted
    const r2 = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-1",
      quoteId: "q-10",
      idempotencyKey: "key-pdf-timeout",
    });
    assert.equal(r2.status, 409);
    assert.equal(ctx.calls.deliverDocument.length, 1);
  } finally {
    await ctx.close();
  }
});

await test("send-approved-pdf: provider rejection → 502", async () => {
  const ctx = await setup([validQuote("q-10")]);
  ctx.seedConversation("conv-1");
  ctx.deliverBehavior.kind = "provider";
  try {
    const r = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-1",
      quoteId: "q-10",
      idempotencyKey: "key-pdf-reject",
    });
    assert.equal(r.status, 502);
  } finally {
    await ctx.close();
  }
});

// ---------- custom-quote-draft ----------

await test("custom-quote-draft creates draft; replay returns existing draft (no duplicate)", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-d1", { phone: "923001234567" });
  ctx.seedInboundWamid("conv-d1", "wamid.draft1");
  try {
    const req = {
      conversationId: "conv-d1",
      inboundMessageId: "wamid.draft1",
      requirements: { name: "Ali", city: "Lahore", systemCapacityKw: 10 },
    };
    const r1 = await api(ctx, "POST", "/custom-quote-draft", req);
    assert.equal(r1.status, 200);
    assert.equal(r1.data.status, "draft_pending_staff_approval");
    assert.ok(r1.data.draftId);
    assert.equal(ctx.calls.createQuote.length, 1);
    // The recipient phone is derived from the CRM bundle, not the request.
    assert.equal(ctx.calls.createQuote[0].phone, "923001234567");
    // replay the same worker request → same draft, no second creation
    const r2 = await api(ctx, "POST", "/custom-quote-draft", req);
    assert.equal(r2.status, 200);
    assert.equal(r2.data.duplicate, true);
    assert.equal(r2.data.draftId, r1.data.draftId);
    assert.equal(ctx.calls.createQuote.length, 1);
  } finally {
    await ctx.close();
  }
});

await test("custom-quote-draft validation failure → 422 needs_human_review", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-d2");
  ctx.seedInboundWamid("conv-d2", "wamid.draft2");
  try {
    const r = await api(ctx, "POST", "/custom-quote-draft", {
      conversationId: "conv-d2",
      inboundMessageId: "wamid.draft2",
      requirements: { name: "Ali", __fail: true },
    });
    assert.equal(r.status, 422);
    assert.equal(r.data.status, "needs_human_review");
  } finally {
    await ctx.close();
  }
});

// ---------- P0: draft binding ----------

await test("custom-quote-draft requires conversationId + inboundMessageId", async () => {
  const ctx = await setup();
  try {
    const r1 = await api(ctx, "POST", "/custom-quote-draft", {
      requirements: { name: "Ali" },
    });
    assert.equal(r1.status, 400);
    const r2 = await api(ctx, "POST", "/custom-quote-draft", {
      conversationId: "conv-x",
      requirements: { name: "Ali" },
    });
    assert.equal(r2.status, 400);
    assert.equal(ctx.calls.createQuote.length, 0);
  } finally {
    await ctx.close();
  }
});

await test("custom-quote-draft rejects unknown conversation (404)", async () => {
  const ctx = await setup();
  try {
    const r = await api(ctx, "POST", "/custom-quote-draft", {
      conversationId: "conv-nope",
      inboundMessageId: "wamid.zzz",
      requirements: { name: "Ali" },
    });
    assert.equal(r.status, 404);
    assert.equal(ctx.calls.createQuote.length, 0);
  } finally {
    await ctx.close();
  }
});

await test("custom-quote-draft rejects unverified inbound wamid (422, no quote)", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-d3");
  ctx.seedInboundWamid("conv-d3", "wamid.real");
  try {
    const r = await api(ctx, "POST", "/custom-quote-draft", {
      conversationId: "conv-d3",
      inboundMessageId: "wamid.unknown",
      requirements: { name: "Ali" },
    });
    assert.equal(r.status, 422);
    assert.equal(ctx.calls.createQuote.length, 0);
    const audits = (ctx as any).audits || [];
    assert.ok(audits.some((a: any) => a.eventType === "moos_draft_rejected"));
  } finally {
    await ctx.close();
  }
});

await test("custom-quote-draft rejects wamid from another conversation (contact B via conversation A fails)", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-A", { phone: "923001111111" });
  ctx.seedConversation("conv-B", { phone: "923002222222" });
  ctx.seedInboundWamid("conv-B", "wamid.from-b");
  try {
    // Attacker/worker bug: conversation A claimed, but the wamid belongs to B.
    const r = await api(ctx, "POST", "/custom-quote-draft", {
      conversationId: "conv-A",
      inboundMessageId: "wamid.from-b",
      requirements: { name: "Ali" },
    });
    assert.equal(r.status, 422);
    assert.equal(ctx.calls.createQuote.length, 0);
  } finally {
    await ctx.close();
  }
});

await test("custom-quote-draft rejects outbound wamid (direction must be inbound)", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-d4");
  ctx.seedInboundWamid("conv-d4", "wamid.out1", "outbound");
  try {
    const r = await api(ctx, "POST", "/custom-quote-draft", {
      conversationId: "conv-d4",
      inboundMessageId: "wamid.out1",
      requirements: { name: "Ali" },
    });
    assert.equal(r.status, 422);
    assert.equal(ctx.calls.createQuote.length, 0);
  } finally {
    await ctx.close();
  }
});

await test("custom-quote-draft blocked on human-owned conversation (409)", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-d5", { state: "HUMAN_HANDLING" });
  ctx.seedInboundWamid("conv-d5", "wamid.h1");
  try {
    const r = await api(ctx, "POST", "/custom-quote-draft", {
      conversationId: "conv-d5",
      inboundMessageId: "wamid.h1",
      requirements: { name: "Ali" },
    });
    assert.equal(r.status, 409);
    assert.equal(ctx.calls.createQuote.length, 0);
  } finally {
    await ctx.close();
  }
});

// ---------- P0: send-time mutual exclusion ----------

await test("send-text blocked when legacy AI turns on after relay (send-boundary check)", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-race1");
  try {
    // Relay-time state: legacy AI off → event flows to the worker.
    ctx.legacyAiOn = false;
    // ...then the legacy AI is enabled before the worker's send lands.
    ctx.legacyAiOn = true;
    const r = await api(ctx, "POST", "/send-text", {
      conversationId: "conv-race1",
      text: "hello",
      idempotencyKey: "key-race-001",
    });
    assert.equal(r.status, 409);
    assert.match(String(r.data.error), /Legacy WhatsApp AI agent is active/);
    assert.equal(ctx.calls.sendText.length, 0);
    const audits = (ctx as any).audits || [];
    assert.ok(audits.some((a: any) => a.eventType === "MOOS_SEND_SUPPRESSED_LEGACY_AI"));
  } finally {
    await ctx.close();
  }
});

await test("send-approved-pdf cancelled when legacy AI activates during PDF fetch", async () => {
  const ctx = await setup([validQuote("q-race")]);
  ctx.seedConversation("conv-race2");
  try {
    // Legacy AI is OFF when the request starts; it turns ON while the PDF
    // bytes are being fetched (slow storage read). The post-fetch
    // send-boundary check must still block the dispatch.
    ctx.legacyAiOn = false;
    ctx.fetchDelayMs = 60;
    setTimeout(() => {
      ctx.legacyAiOn = true;
    }, 15);
    const r = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-race2",
      quoteId: "q-race",
      idempotencyKey: "key-race-002",
    });
    assert.equal(r.status, 409);
    assert.match(String(r.data.error), /Legacy WhatsApp AI agent became active/);
    assert.equal(ctx.calls.deliverDocument.length, 0);
  } finally {
    await ctx.close();
  }
});

await test("send-approved-pdf cancelled when ownership changes during PDF fetch", async () => {
  const ctx = await setup([validQuote("q-race2")]);
  ctx.seedConversation("conv-race3");
  try {
    // Staff takes over mid-fetch (pre-fetch ownership check passes).
    ctx.fetchDelayMs = 60;
    setTimeout(() => {
      ctx.inbox.store.conversations.get("conv-race3")!.aiOwnershipState =
        "HUMAN_HANDLING" as any;
    }, 15);
    const r = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-race3",
      quoteId: "q-race2",
      idempotencyKey: "key-race-003",
    });
    assert.equal(r.status, 409);
    assert.match(String(r.data.error), /ownership changed/i);
    assert.equal(ctx.calls.deliverDocument.length, 0);
  } finally {
    await ctx.close();
  }
});

// ---------- P1: handoff CAS ----------

await test("handoff CAS conflict → 409, no success reported, audit only on success", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-cas");
  try {
    // Simulate a concurrent writer bumping lockVersion between our read and CAS.
    const conversations = ctx.inbox.conversations as any;
    const origCas = conversations.compareAndSet.bind(conversations);
    let calls = 0;
    conversations.compareAndSet = async (...args: any[]) => {
      calls++;
      return { ok: false, reason: "conflict", current: await conversations.getById(args[0], "sunchaser") };
    };
    const r = await api(ctx, "POST", "/handoff", {
      conversationId: "conv-cas",
      reason: "race",
    });
    conversations.compareAndSet = origCas;
    assert.equal(r.status, 409);
    assert.match(String(r.data.error), /changed during handoff/);
    assert.equal(calls, 3, "bounded reload-and-retry (3 attempts)");
    const audits = (ctx as any).audits || [];
    assert.ok(!audits.some((a: any) => a.eventType === "moos_handoff"), "no handoff audit on conflict");
    // Conversation must NOT be in HUMAN_HANDLING after a failed handoff.
    const convo = ctx.inbox.store.conversations.get("conv-cas")!;
    assert.notEqual(convo.aiOwnershipState, "HUMAN_HANDLING");
  } finally {
    await ctx.close();
  }
});

await test("handoff is idempotent when already HUMAN_HANDLING", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-cas2", { state: "HUMAN_HANDLING" });
  try {
    const r = await api(ctx, "POST", "/handoff", {
      conversationId: "conv-cas2",
      reason: "again",
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.state, "HUMAN_HANDLING");
    assert.equal(r.data.updated, false);
  } finally {
    await ctx.close();
  }
});

// ---------- outcome-unknown never retried ----------

await test("provider timeout → 202 outcome-unknown; retry with same key is suppressed (409)", async () => {
  const ctx = await setup([validQuote("q-tmo")]);
  ctx.seedConversation("conv-tmo");
  try {
    ctx.deliverBehavior.kind = "timeout";
    const r1 = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-tmo",
      quoteId: "q-tmo",
      idempotencyKey: "key-tmo-001",
    });
    assert.equal(r1.status, 202);
    assert.equal(ctx.calls.deliverDocument.length, 1);
    // Retry with the same key must NOT re-attempt the Meta send.
    const r2 = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-tmo",
      quoteId: "q-tmo",
      idempotencyKey: "key-tmo-001",
    });
    assert.equal(r2.status, 409);
    assert.equal(ctx.calls.deliverDocument.length, 1);
  } finally {
    await ctx.close();
  }
});

// ---------- handoff ----------

await test("handoff moves to HUMAN_HANDLING; later sends are blocked", async () => {
  const ctx = await setup();
  ctx.seedConversation("conv-1");
  try {
    const r = await api(ctx, "POST", "/handoff", {
      conversationId: "conv-1",
      reason: "customer_requested_staff",
      summary: "wants to talk",
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.state, "HUMAN_HANDLING");
    const audits = (ctx as any).audits || [];
    assert.ok(audits.some((a: any) => a.eventType === "moos_handoff"));
    // Moos can no longer send to this conversation
    const s = await api(ctx, "POST", "/send-text", {
      conversationId: "conv-1",
      text: "hi",
      idempotencyKey: "key-after-handoff",
    });
    assert.equal(s.status, 409);
    assert.equal(ctx.calls.sendText.length, 0);
    // unknown conversation → 404
    const h2 = await api(ctx, "POST", "/handoff", { conversationId: "conv-nope", reason: "x" });
    assert.equal(h2.status, 404);
  } finally {
    await ctx.close();
  }
});

await test("customer isolation: sends target each conversation's own contact", async () => {
  const ctx = await setup([validQuote("q-10")]);
  ctx.seedConversation("conv-A", { phone: "923001111111" });
  ctx.seedConversation("conv-B", { phone: "923002222222" });
  try {
    const r = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "conv-B",
      quoteId: "q-10",
      idempotencyKey: "key-iso-b",
    });
    assert.equal(r.status, 200);
    assert.equal(ctx.calls.deliverDocument[0].contactPhoneE164, "923002222222");
    assert.equal(ctx.calls.deliverDocument[0].conversationId, "conv-B");
  } finally {
    await ctx.close();
  }
});

// Test-only scope applies to both text and approved PDF sends.
// Never let a worker-supplied recipient override the CRM's verified contact.
await test("test-only recipient scope blocks other customer texts and PDFs", async () => {
  const ctx = await setup([validQuote("scope-q10")]);
  ctx.seedConversation("scope-approved", { phone: "923218486752" });
  ctx.seedConversation("scope-other", { phone: "923001234567" });
  process.env.MOOS_TEST_ONLY_RECIPIENT_E164 = "+923218486752";
  try {
    const blockedText = await api(ctx, "POST", "/send-text", {
      conversationId: "scope-other", text: "test", idempotencyKey: "scope-block-txt-001",
    });
    assert.equal(blockedText.status, 403);
    const blockedPdf = await api(ctx, "POST", "/send-approved-pdf", {
      conversationId: "scope-other", quoteId: "scope-q10", idempotencyKey: "scope-block-pdf-001",
    });
    assert.equal(blockedPdf.status, 403);
    assert.equal(ctx.calls.sendText.length, 0);
    assert.equal(ctx.calls.deliverDocument.length, 0);
    const allowedText = await api(ctx, "POST", "/send-text", {
      conversationId: "scope-approved", text: "test", idempotencyKey: "scope-allow-txt-001",
    });
    assert.equal(allowedText.status, 200);
    assert.equal(ctx.calls.sendText.length, 1);
  } finally {
    await ctx.close();
  }
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log("\nAll Moos router integration tests passed.");
}


