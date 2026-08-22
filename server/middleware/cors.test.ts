/**
 * CORS allowlist tests for CRM ↔ Render API.
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/middleware/cors.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import { installWhatsAppRawBodyMiddleware } from "../whatsappTransport/index.ts";
import {
  applyCorsHeaders,
  createCorsMiddleware,
  isAllowedCorsOrigin,
  PRODUCTION_CRM_ORIGIN,
  resolveCorsAllowedOrigins,
} from "./cors.ts";

/**
 * Mirrors production bootstrap order in server.ts:
 * CORS → WhatsApp raw-body → json → urlencoded → body-parser error handler.
 */
function createProductionOrderedApp(): express.Express {
  const app = express();
  app.use(createCorsMiddleware());
  installWhatsAppRawBodyMiddleware(app);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (err instanceof SyntaxError || err?.type === "entity.parse.failed") {
        return res.status(400).json({ error: "Malformed JSON." });
      }
      return next(err);
    }
  );
  app.post("/api/inbox/conversations", (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

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

await test("allowlist includes production CRM and localhost defaults", () => {
  const allowed = resolveCorsAllowedOrigins({});
  assert.equal(allowed.has(PRODUCTION_CRM_ORIGIN), true);
  assert.equal(allowed.has("http://localhost:5173"), true);
  assert.equal(isAllowedCorsOrigin(PRODUCTION_CRM_ORIGIN, {}), true);
  assert.equal(isAllowedCorsOrigin("http://localhost:4173", {}), true);
  assert.equal(isAllowedCorsOrigin("http://127.0.0.1:9999", {}), true);
  assert.equal(isAllowedCorsOrigin("https://evil.example", {}), false);
});

await test("env CORS_ALLOWED_ORIGINS extends allowlist", () => {
  assert.equal(
    isAllowedCorsOrigin("https://preview.example", {
      CORS_ALLOWED_ORIGINS: "https://preview.example, https://other.example",
    }),
    true
  );
});

await test("applyCorsHeaders reflects CRM origin with credentials; never *", () => {
  const headers = new Map<string, string>();
  const res = {
    setHeader(key: string, value: string) {
      headers.set(key.toLowerCase(), value);
    },
  } as any;
  const req = {
    headers: { origin: PRODUCTION_CRM_ORIGIN },
  } as any;

  assert.equal(applyCorsHeaders(req, res), true);
  assert.equal(headers.get("access-control-allow-origin"), PRODUCTION_CRM_ORIGIN);
  assert.equal(headers.get("access-control-allow-credentials"), "true");
  assert.equal(
    headers.get("access-control-allow-methods")?.includes("GET"),
    true
  );
  assert.equal(
    headers.get("access-control-allow-methods")?.includes("POST"),
    true
  );
  assert.equal(
    headers.get("access-control-allow-methods")?.includes("OPTIONS"),
    true
  );
  assert.match(
    headers.get("access-control-allow-headers") || "",
    /Authorization/
  );
  assert.equal(headers.get("vary"), "Origin");
  assert.notEqual(headers.get("access-control-allow-origin"), "*");
});

await test("disallowed origin does not receive ACAO / credentials", () => {
  const headers = new Map<string, string>();
  const res = {
    setHeader(key: string, value: string) {
      headers.set(key.toLowerCase(), value);
    },
  } as any;
  applyCorsHeaders({ headers: { origin: "https://evil.example" } } as any, res);
  assert.equal(headers.has("access-control-allow-origin"), false);
  assert.equal(headers.has("access-control-allow-credentials"), false);
});

await test("HTTP middleware: OPTIONS/GET/POST for CRM origin", async () => {
  const app = express();
  app.use(createCorsMiddleware());
  app.get("/api/inbox/conversations", (_req, res) => {
    res.status(401).json({ error: "Unauthorized" });
  });
  app.post("/api/inbox/admin/whatsapp/diagnostics", (_req, res) => {
    res.status(401).json({ error: "Unauthorized" });
  });

  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    for (const [method, path] of [
      ["OPTIONS", "/api/inbox/conversations"],
      ["GET", "/api/inbox/conversations"],
      ["POST", "/api/inbox/admin/whatsapp/diagnostics"],
      ["OPTIONS", "/api/inbox/admin/whatsapp/diagnostics"],
    ] as const) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          Origin: PRODUCTION_CRM_ORIGIN,
          "Access-Control-Request-Method": method === "OPTIONS" ? "GET" : method,
          "Access-Control-Request-Headers": "Authorization, Content-Type",
        },
      });
      assert.equal(
        res.headers.get("access-control-allow-origin"),
        PRODUCTION_CRM_ORIGIN,
        `${method} ${path} missing ACAO`
      );
      assert.equal(
        res.headers.get("access-control-allow-credentials"),
        "true",
        `${method} ${path} missing credentials`
      );
      assert.match(
        res.headers.get("access-control-allow-methods") || "",
        /GET/
      );
      assert.match(
        res.headers.get("access-control-allow-headers") || "",
        /Authorization/
      );
      if (method === "OPTIONS") {
        assert.ok(res.status === 204 || res.status === 200);
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

await test("production order: malformed JSON still returns CORS for CRM origin", async () => {
  const app = createProductionOrderedApp();
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/api/inbox/conversations`, {
      method: "POST",
      headers: {
        Origin: PRODUCTION_CRM_ORIGIN,
        "Content-Type": "application/json",
      },
      body: "{not-json",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "Malformed JSON.");
    assert.equal(
      res.headers.get("access-control-allow-origin"),
      PRODUCTION_CRM_ORIGIN
    );
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
    assert.equal(res.headers.get("vary"), "Origin");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

await test("production order: malformed JSON denies disallowed origin CORS", async () => {
  const app = createProductionOrderedApp();
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/api/inbox/conversations`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: "{not-json",
    });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("access-control-allow-origin"), null);
    assert.equal(res.headers.get("access-control-allow-credentials"), null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

await test("production order: localhost malformed JSON keeps CORS", async () => {
  const app = createProductionOrderedApp();
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/api/inbox/conversations`, {
      method: "POST",
      headers: {
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      body: "{broken",
    });
    assert.equal(res.status, 400);
    assert.equal(
      res.headers.get("access-control-allow-origin"),
      "http://localhost:5173"
    );
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

await test("Capacitor iOS origin is allowed, but not arbitrary capacitor:// hosts", () => {
  // iOS serves the bundled app from capacitor://localhost and the scheme cannot be
  // changed (WKWebView reserves http/https), so this origin must stay allowlisted.
  assert.equal(isAllowedCorsOrigin("capacitor://localhost"), true);
  // Android's origin, unchanged.
  assert.equal(isAllowedCorsOrigin("https://localhost"), true);
  // The allowlist is exact-match, not a scheme wildcard.
  assert.equal(isAllowedCorsOrigin("capacitor://evil"), false);
  assert.equal(isAllowedCorsOrigin("capacitor://localhost.evil.com"), false);
  assert.equal(isAllowedCorsOrigin("https://evil.example.com"), false);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll CORS middleware tests passed.");
