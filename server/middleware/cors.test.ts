/**
 * CORS allowlist tests for CRM ↔ Render API.
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/middleware/cors.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "net";
import {
  applyCorsHeaders,
  createCorsMiddleware,
  isAllowedCorsOrigin,
  PRODUCTION_CRM_ORIGIN,
  resolveCorsAllowedOrigins,
} from "./cors.ts";

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

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nAll CORS middleware tests passed.");
