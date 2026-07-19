/**
 * Public lead gateway tests.
 * Run: npm test   (or npm run test:public-lead-gateway)
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import {
  authenticatePublicLeadRequest,
  secureCompareSecrets,
} from "./publicLeadAuth.ts";
import {
  normalizeIdempotencyKey,
  type IdempotencyStore,
  type IdempotencyRecord,
} from "./publicLeadIdempotency.ts";
import {
  createPublicLeadRateLimit,
  resetPublicLeadRateLimitStore,
} from "./publicLeadRateLimit.ts";
import { createPublicLeadRouter } from "./publicLeadRoutes.ts";
import { createPublicLead } from "./publicLeadService.ts";
import { validatePublicLeadPayload } from "./publicLeadValidation.ts";

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

class MapIdempotencyStore implements IdempotencyStore {
  private map = new Map<string, IdempotencyRecord>();
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, record: IdempotencyRecord) {
    this.map.set(key, record);
  }
}

const TEST_KEY = "test-public-lead-api-key-32chars!!";

function mockReq(headers: Record<string, string>) {
  return { headers } as never;
}

await test("secureCompareSecrets accepts equal keys", () => {
  assert.equal(secureCompareSecrets("abc123", "abc123"), true);
});

await test("secureCompareSecrets rejects mismatched keys", () => {
  assert.equal(secureCompareSecrets("abc123", "abc124"), false);
  assert.equal(secureCompareSecrets("short", "longer-secret"), false);
  assert.equal(secureCompareSecrets("", "x"), false);
});

await test("authenticatePublicLeadRequest rejects missing/wrong key", () => {
  const env = { PUBLIC_LEAD_API_KEY: TEST_KEY };
  const missing = authenticatePublicLeadRequest(mockReq({}), env);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.status, 401);

  const wrong = authenticatePublicLeadRequest(
    mockReq({ "x-public-lead-key": "nope" }),
    env
  );
  assert.equal(wrong.ok, false);
});

await test("authenticatePublicLeadRequest accepts header and bearer", () => {
  const env = { PUBLIC_LEAD_API_KEY: TEST_KEY };
  const viaHeader = authenticatePublicLeadRequest(
    mockReq({ "x-public-lead-key": TEST_KEY }),
    env
  );
  assert.equal(viaHeader.ok, true);

  const viaBearer = authenticatePublicLeadRequest(
    mockReq({ authorization: `Bearer ${TEST_KEY}` }),
    env
  );
  assert.equal(viaBearer.ok, true);
});

await test("validatePublicLeadPayload accepts valid payload", () => {
  const result = validatePublicLeadPayload({
    name: "Ali Khan",
    email: "ali@example.com",
    phone: "+92 300 1234567",
    city: "Lahore",
    monthlyBill: 25000,
    message: "Need 10kW quote",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.email, "ali@example.com");
    assert.equal(result.value.location, "Lahore");
  }
});

await test("validatePublicLeadPayload rejects invalid auth fields and unknown keys", () => {
  assert.equal(validatePublicLeadPayload({ email: "a@b.com", phone: "03001234567" }).ok, false);
  assert.equal(
    validatePublicLeadPayload({
      name: "A",
      email: "bad",
      phone: "03001234567",
    }).ok,
    false
  );
  assert.equal(
    validatePublicLeadPayload({
      name: "A",
      email: "a@b.com",
      phone: "1",
    }).ok,
    false
  );
  const unknown = validatePublicLeadPayload({
    name: "A",
    email: "a@b.com",
    phone: "03001234567",
    password: "secret",
  });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.error, /Unknown field/);
});

await test("normalizeIdempotencyKey rejects unsafe keys", () => {
  assert.equal(normalizeIdempotencyKey("ok-key_1"), "ok-key_1");
  assert.equal(normalizeIdempotencyKey("bad key"), null);
  assert.equal(normalizeIdempotencyKey(""), null);
});

await test("createPublicLead returns CRM leadId only after persist", async () => {
  let persisted = false;
  const result = await createPublicLead(
    {
      name: "Test",
      email: "t@example.com",
      phone: "03001234567",
    },
    async (lead) => {
      persisted = true;
      assert.ok(lead.id.startsWith("lead-"));
      return { leadId: lead.id };
    }
  );
  assert.equal(persisted, true);
  assert.ok(result.leadId.startsWith("lead-"));
});

await test("createPublicLead surfaces persistence failure", async () => {
  await assert.rejects(
    () =>
      createPublicLead(
        { name: "T", email: "t@example.com", phone: "03001234567" },
        async () => {
          throw new Error("db down");
        }
      ),
    /db down/
  );
});

type HttpResult = { status: number; body: any };

async function withServer(
  persist: (lead: any) => Promise<{ leadId: string }>,
  store: IdempotencyStore,
  rateStore: Map<string, any>,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use((err: any, _req: any, res: any, next: any) => {
    if (err instanceof SyntaxError || err?.type === "entity.parse.failed") {
      return res.status(400).json({ error: "Malformed JSON." });
    }
    next(err);
  });
  app.use(
    "/api/public",
    createPublicLeadRouter({
      persistLead: persist,
      idempotencyStore: store,
      rateLimit: createPublicLeadRateLimit({
        store: rateStore,
        windowMs: 60_000,
        maxAttempts: 3,
      }),
      env: { PUBLIC_LEAD_API_KEY: TEST_KEY },
    })
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

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<HttpResult> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const validBody = {
  name: "Sara Ahmed",
  email: "sara@example.com",
  phone: "03301234567",
  city: "Lahore",
  message: "Interested in hybrid solar",
};

await test("integration: valid request succeeds with leadId", async () => {
  const store = new MapIdempotencyStore();
  const rateStore = new Map();
  await withServer(
    async (lead) => ({ leadId: lead.id }),
    store,
    rateStore,
    async (base) => {
      const res = await postJson(base, "/api/public/leads", validBody, {
        "x-public-lead-key": TEST_KEY,
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.success, true);
      assert.equal(res.body.message, "Lead created");
      assert.ok(String(res.body.leadId).startsWith("lead-"));
    }
  );
});

await test("integration: missing API key returns 401", async () => {
  await withServer(
    async (lead) => ({ leadId: lead.id }),
    new MapIdempotencyStore(),
    new Map(),
    async (base) => {
      const res = await postJson(base, "/api/public/leads", validBody, {});
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, "Unauthorized");
    }
  );
});

await test("integration: incorrect API key returns 401", async () => {
  await withServer(
    async (lead) => ({ leadId: lead.id }),
    new MapIdempotencyStore(),
    new Map(),
    async (base) => {
      const res = await postJson(base, "/api/public/leads", validBody, {
        "x-public-lead-key": "wrong",
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.ok, false);
      assert.equal(res.body.error, "Unauthorized");
    }
  );
});

await test("integration: Bearer auth succeeds with leadId", async () => {
  await withServer(
    async (lead) => ({ leadId: lead.id }),
    new MapIdempotencyStore(),
    new Map(),
    async (base) => {
      const res = await postJson(base, "/api/public/leads", validBody, {
        authorization: `Bearer ${TEST_KEY}`,
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.ok, true);
      assert.ok(String(res.body.leadId).startsWith("lead-"));
    }
  );
});

await test("integration: GET returns 405", async () => {
  await withServer(
    async (lead) => ({ leadId: lead.id }),
    new MapIdempotencyStore(),
    new Map(),
    async (base) => {
      const res = await fetch(`${base}/api/public/leads`, { method: "GET" });
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("allow"), "POST");
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.match(String(body.error), /Method not allowed/i);
    }
  );
});

await test("integration: invalid payload returns 400", async () => {
  await withServer(
    async (lead) => ({ leadId: lead.id }),
    new MapIdempotencyStore(),
    new Map(),
    async (base) => {
      const res = await postJson(
        base,
        "/api/public/leads",
        { name: "X", email: "not-an-email", phone: "03301234567" },
        { "x-public-lead-key": TEST_KEY }
      );
      assert.equal(res.status, 400);
      assert.equal(res.body.ok, false);
      assert.match(String(res.body.error), /email/i);
    }
  );
});

await test("integration: duplicate Idempotency-Key does not create duplicate leads", async () => {
  let persistCount = 0;
  const store = new MapIdempotencyStore();
  await withServer(
    async (lead) => {
      persistCount += 1;
      return { leadId: lead.id };
    },
    store,
    new Map(),
    async (base) => {
      const headers = {
        "x-public-lead-key": TEST_KEY,
        "Idempotency-Key": "idem-001",
      };
      const first = await postJson(base, "/api/public/leads", validBody, headers);
      const second = await postJson(base, "/api/public/leads", validBody, headers);
      assert.equal(first.status, 201);
      assert.equal(second.status, 200);
      assert.equal(first.body.leadId, second.body.leadId);
      assert.equal(persistCount, 1);
    }
  );
});

await test("integration: rate limiting returns 429", async () => {
  const rateStore = new Map();
  resetPublicLeadRateLimitStore(rateStore);
  await withServer(
    async (lead) => ({ leadId: lead.id }),
    new MapIdempotencyStore(),
    rateStore,
    async (base) => {
      const headers = { "x-public-lead-key": TEST_KEY };
      const r1 = await postJson(base, "/api/public/leads", validBody, headers);
      const r2 = await postJson(base, "/api/public/leads", validBody, headers);
      const r3 = await postJson(base, "/api/public/leads", validBody, headers);
      const r4 = await postJson(base, "/api/public/leads", validBody, headers);
      assert.equal(r1.status, 201);
      assert.equal(r2.status, 201);
      assert.equal(r3.status, 201);
      assert.equal(r4.status, 429);
      assert.match(String(r4.body.error), /Too many/i);
    }
  );
});

await test("integration: persistence failure returns 500 without success", async () => {
  await withServer(
    async () => {
      throw new Error("simulated persistence failure");
    },
    new MapIdempotencyStore(),
    new Map(),
    async (base) => {
      const res = await postJson(base, "/api/public/leads", validBody, {
        "x-public-lead-key": TEST_KEY,
      });
      assert.equal(res.status, 500);
      assert.equal(res.body.success, undefined);
      assert.equal(res.body.error, "Failed to create lead.");
    }
  );
});

await test("integration: malformed JSON returns 400", async () => {
  await withServer(
    async (lead) => ({ leadId: lead.id }),
    new MapIdempotencyStore(),
    new Map(),
    async (base) => {
      const res = await fetch(`${base}/api/public/leads`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-public-lead-key": TEST_KEY,
        },
        body: '{"name":"A",',
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(String(body.error), /Malformed|JSON|object/i);
    }
  );
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll public lead gateway tests passed.");
