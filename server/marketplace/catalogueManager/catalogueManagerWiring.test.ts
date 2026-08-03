/**
 * Wiring tests for CatalogueManager repository resolution.
 *
 * Proves:
 *   - resolveCatalogueManagerRepository(deps) with injected repository → uses it
 *   - resolveCatalogueManagerRepository(deps) without repository and inactive Supabase → throws 503
 *   - createCatalogueManagerRouter() without deps.repository + inactive Supabase → throws on first request
 *   - createCatalogueManagerRouter() with deps.repository injected → uses injected repo (no factory)
 *   - NEVER constructs memory repo by default
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogueManager/catalogueManagerWiring.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { resolveCatalogueManagerRepository } from "./catalogueManagerRepository.ts";
import {
  createMemoryCatalogueManagerRepository,
  type CatalogueManagerRepository,
} from "./memoryCatalogueManagerRepository.ts";
import { CatalogueManagerError } from "./catalogueManagerTypes.ts";
import { createCatalogueManagerRouter } from "./catalogueManagerRoutes.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

async function withServer(
  deps: Parameters<typeof createCatalogueManagerRouter>[0],
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor?: unknown }).actor = {
      id: "u1",
      username: "ceo",
      role: "Super Admin",
      accountStatus: "Approved",
    };
    next();
  });
  app.use(
    "/api/marketplace/admin/catalogue-manager",
    createCatalogueManagerRouter({
      env: { MARKETPLACE_ENABLED: "true" },
      ...deps,
    }),
  );
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const addr = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function main(): Promise<void> {
  // 1. resolveCatalogueManagerRepository: injected repo → returns it
  const memRepo = createMemoryCatalogueManagerRepository();
  const resolved = resolveCatalogueManagerRepository({ repository: memRepo });
  check("injected repository is returned as-is", resolved === memRepo);

  // 2. resolveCatalogueManagerRepository: no repo + Supabase inactive → throws 503
  let threw503 = false;
  try {
    // Supabase is not configured in test environment
    resolveCatalogueManagerRepository({});
  } catch (err) {
    if (err instanceof CatalogueManagerError && err.status === 503 && err.code === "CATALOGUE_UNAVAILABLE") {
      threw503 = true;
    }
  }
  check("factory throws 503 when Supabase inactive", threw503);

  // 3. Router without injected repo → 503 on first request (fail closed)
  await withServer({}, async (base) => {
    const res = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/reconciliation`,
    );
    const body = await res.json();
    check(
      "router without injected repo returns 503 when Supabase inactive",
      res.status === 503 && body.ok === false && body.error.code === "CATALOGUE_UNAVAILABLE",
    );
  });

  // 4. Router with injected repo → uses it, succeeds
  await withServer({ repository: memRepo }, async (base) => {
    const res = await fetch(
      `${base}/api/marketplace/admin/catalogue-manager/reconciliation`,
    );
    const body = await res.json();
    check(
      "router with injected repo responds 200",
      res.status === 200 && body.ok === true,
    );
  });

  // 5. Never constructs memory repo by default: the factory should throw when
  //    Supabase is inactive (no silent memory fallback).
  //    Verify that resolveCatalogueManagerRepository({}) throws (not returns memory).
  let gotError = false;
  let isMemoryRepo = false;
  try {
    const r: CatalogueManagerRepository = resolveCatalogueManagerRepository({});
    // If we get here, check it's not a memory repo (it shouldn't have seedProduct
    // from the Supabase impl either, but memory repo does)
    isMemoryRepo = typeof r.seedProduct === "function";
  } catch {
    gotError = true;
  }
  check(
    "no default memory repo: factory always throws without Supabase",
    gotError && !isMemoryRepo,
  );

  console.log("\nCatalogue Manager wiring tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
