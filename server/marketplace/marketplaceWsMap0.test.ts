/**
 * WS-MAP-0 — legacy supplier mapping bypass closure (HTTP + source scan).
 * Run: npm run test:marketplace-ws-map-0
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestActor } from "../middleware/actor.ts";
import {
  LEGACY_MAPPING_DISABLED_BODY,
  LEGACY_MAPPING_DISABLED_CODE,
  LEGACY_MAPPING_DISABLED_MESSAGE,
  LEGACY_MAPPING_DISABLED_STATUS,
} from "./legacyMappingDisabled.ts";
import { createMarketplacePricingRouter } from "./pricing/pricingRoutes.ts";
import type { PricingRepository } from "./pricing/pricingRepository.ts";
import { createSupabasePricingRepository } from "./pricing/pricingRepository.ts";
import { createMarketplaceSupplierRouter } from "./suppliers/supplierRoutes.ts";
import type { SupplierRepository } from "./suppliers/supplierRepository.ts";
import { createSupabaseSupplierRepository } from "./suppliers/supplierRepository.ts";
import { PHASE1_LIVE_PUBLICATION_ALLOWED } from "./suppliers/liveCatalogueService.ts";
import { EVIDENCE_BLOCKER_VARIANT_IDS } from "./suppliers/adapterTypes.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

process.env.MARKETPLACE_ENABLED = "true";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "marketplace-ws-map-0-test-secret-min-32-chars!!";

function actor(role: string, id = "u-sa"): RequestActor {
  return {
    id,
    username: role.toLowerCase().replace(/\s+/g, "-"),
    name: role,
    email: `${id}@example.com`,
    role,
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
  };
}

async function withApp(
  mount: (app: express.Express) => void,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  mount(app);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function postMapping(
  base: string,
  path: string,
  init: {
    role?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers || {}),
  };
  if (init.role) headers["x-test-role"] = init.role;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body:
      init.body === undefined
        ? undefined
        : typeof init.body === "string"
          ? init.body
          : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json as any, text };
}

function injectActor(app: express.Express): void {
  app.use((req, _res, next) => {
    const role = String(req.headers["x-test-role"] || "");
    if (role) (req as any).actor = actor(role);
    next();
  });
}

function trackingPricingRepo(): PricingRepository & { calls: number } {
  const base = {
    async listCosts() {
      return [];
    },
    async createCost() {
      throw new Error("unused");
    },
    async updateCost() {
      throw new Error("unused");
    },
    async getMargin() {
      throw new Error("unused");
    },
    async publishPrice() {
      throw new Error("publish must not be called");
    },
    async createOverride() {
      throw new Error("unused");
    },
    async revokeOverride() {
      throw new Error("unused");
    },
    async getPricingConfig() {
      throw new Error("unused");
    },
    async updatePricingConfig() {
      throw new Error("unused");
    },
  };
  const state = { calls: 0 };
  return {
    ...base,
    get calls() {
      return state.calls;
    },
    async upsertSupplierMapping() {
      state.calls += 1;
      return { mappingId: "should-not-happen", action: "created" };
    },
  } as PricingRepository & { calls: number };
}

function trackingSupplierRepo(): SupplierRepository & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    async listActiveMappings() {
      return [];
    },
    async getPricingConfig() {
      return { maxIncreasePct: 15, maxDecreasePct: 25, stalenessHours: 36 };
    },
    async getVariantWebsitePrice() {
      return null;
    },
    async startJob() {
      throw new Error("unused");
    },
    async finishJob() {
      throw new Error("unused");
    },
    async insertObservation() {
      throw new Error("unused");
    },
    async createAlert() {
      throw new Error("unused");
    },
    async listAlerts() {
      return [];
    },
    async publishPrice() {
      throw new Error("publish must not be called");
    },
    async upsertMapping() {
      state.calls += 1;
      return { mappingId: "should-not-happen", matchLocked: false };
    },
  } as SupplierRepository & { calls: number };
}

function assertClosed(res: { status: number; body: any; text: string }): void {
  assert.equal(res.status, LEGACY_MAPPING_DISABLED_STATUS);
  assert.deepEqual(res.body, { ...LEGACY_MAPPING_DISABLED_BODY });
  assert.equal(res.body.error, LEGACY_MAPPING_DISABLED_CODE);
  assert.equal(res.body.message, LEGACY_MAPPING_DISABLED_MESSAGE);
  // No nested ok/error envelope, no request reflection.
  assert.equal(res.body.ok, undefined);
  assert.equal(typeof res.body.error, "string");
  assert.ok(!res.text.includes("admin:super"));
  assert.ok(!res.text.includes("normalizedExactModel"));
  assert.ok(!res.text.includes("mp_admin_upsert"));
  assert.ok(!res.text.includes("website_price"));
}

const PATH = "/api/marketplace/admin/suppliers/mappings";
const legacyBody = {
  supplierCode: "kamal",
  productId: "mpprod_x",
  variantId: "mpvar_x",
  supplierProductId: "sp-1",
  normalizedExactModel: "MODEL-X",
  matchConfidence: "exact",
  matchLocked: false,
  active: true,
};

{
  // A. pricingRoutes denial
  const pricingRepo = trackingPricingRepo();
  await withApp(
    (app) => {
      injectActor(app);
      app.use(
        "/api/marketplace/admin",
        createMarketplacePricingRouter({
          repository: pricingRepo,
          env: process.env,
        }),
      );
    },
    async (base) => {
      const res = await postMapping(base, PATH, {
        role: "Super Admin",
        body: legacyBody,
      });
      assertClosed(res);
      assert.equal(pricingRepo.calls, 0);
    },
  );
  console.log("ok - pricingRoutes Super Admin → 410; RPC/repo not called");
}

{
  // B. supplierRoutes denial (latent handler directly)
  const supplierRepo = trackingSupplierRepo();
  await withApp(
    (app) => {
      injectActor(app);
      app.use(
        "/api/marketplace/admin",
        createMarketplaceSupplierRouter({
          repository: supplierRepo,
          env: process.env,
        }),
      );
    },
    async (base) => {
      const res = await postMapping(base, PATH, {
        role: "Super Admin",
        body: legacyBody,
      });
      assertClosed(res);
      assert.equal(supplierRepo.calls, 0);
    },
  );
  console.log("ok - supplierRoutes Super Admin → 410; RPC/repo not called");
}

{
  // C. route-order safety: production order and reversed order
  for (const order of ["pricing-first", "supplier-first"] as const) {
    const pricingRepo = trackingPricingRepo();
    const supplierRepo = trackingSupplierRepo();
    await withApp(
      (app) => {
        injectActor(app);
        const pricing = createMarketplacePricingRouter({
          repository: pricingRepo,
          env: process.env,
        });
        const suppliers = createMarketplaceSupplierRouter({
          repository: supplierRepo,
          env: process.env,
        });
        if (order === "pricing-first") {
          app.use("/api/marketplace/admin", pricing);
          app.use("/api/marketplace/admin", suppliers);
        } else {
          app.use("/api/marketplace/admin", suppliers);
          app.use("/api/marketplace/admin", pricing);
        }
      },
      async (base) => {
        const res = await postMapping(base, PATH, {
          role: "Super Admin",
          body: { ...legacyBody, active: true, matchConfidence: "exact" },
        });
        assertClosed(res);
        assert.equal(pricingRepo.calls, 0);
        assert.equal(supplierRepo.calls, 0);
      },
    );
  }
  // server.ts mount order still pricing then supplier
  const serverSrc = readFileSync(join(ROOT, "server.ts"), "utf8");
  const pricingIdx = serverSrc.indexOf("createMarketplacePricingRouter()");
  const supplierIdx = serverSrc.indexOf("createMarketplaceSupplierRouter()");
  assert.ok(pricingIdx > 0 && supplierIdx > pricingIdx);
  console.log("ok - both mount orders deny; production order recorded");
}

{
  // D. payload safety — all fail closed without reflection
  const pricingRepo = trackingPricingRepo();
  await withApp(
    (app) => {
      injectActor(app);
      app.use(
        "/api/marketplace/admin",
        createMarketplacePricingRouter({
          repository: pricingRepo,
          env: process.env,
        }),
      );
    },
    async (base) => {
      const cases: Array<{ name: string; init: Parameters<typeof postMapping>[2] }> =
        [
          { name: "empty body", init: { role: "Super Admin", body: {} } },
          {
            name: "minimal legacy",
            init: {
              role: "Super Admin",
              body: {
                supplierCode: "kamal",
                productId: "p",
                variantId: "v",
                supplierProductId: "sp",
                normalizedExactModel: "m",
              },
            },
          },
          {
            name: "active true exact",
            init: {
              role: "Super Admin",
              body: { ...legacyBody, active: true, matchConfidence: "exact" },
            },
          },
          {
            name: "actor fields",
            init: {
              role: "Super Admin",
              body: {
                ...legacyBody,
                actor_scope: "admin:super:evil",
                actorId: "evil",
                role: "Super Admin",
              },
            },
          },
          {
            name: "spoofing headers",
            init: {
              role: "Super Admin",
              headers: {
                "x-actor-role": "Super Admin",
                "x-actor-scope": "admin:super:spoof",
              },
              body: legacyBody,
            },
          },
          {
            name: "unknown fields",
            init: {
              role: "Super Admin",
              body: { ...legacyBody, websitePrice: 1, secretToken: "abc" },
            },
          },
          {
            name: "oversized irrelevant",
            init: {
              role: "Super Admin",
              body: { ...legacyBody, junk: "x".repeat(20_000) },
            },
          },
        ];

      for (const c of cases) {
        const res = await postMapping(base, PATH, c.init);
        assertClosed(res);
        assert.ok(
          !res.text.includes("secretToken") && !res.text.includes("evil"),
          c.name,
        );
      }
      assert.equal(pricingRepo.calls, 0);
    },
  );
  console.log("ok - payload safety / spoofing / oversized → stable 410");
}

{
  // Production repository wrappers fail closed (no RPC string left in method body path)
  const pricing = createSupabasePricingRepository();
  await assert.rejects(
    () =>
      pricing.upsertSupplierMapping(
        {
          supplierCode: "kamal",
          productId: "p",
          variantId: "v",
          supplierProductId: "sp",
          normalizedExactModel: "m",
          matchConfidence: "exact",
        },
        { id: "u", username: "u", role: "Super Admin" },
      ),
    (e: any) => e?.code === "LEGACY_MAPPING_DISABLED" && e?.status === 410,
  );
  const suppliers = createSupabaseSupplierRepository();
  await assert.rejects(
    () =>
      suppliers.upsertMapping(
        {
          supplierCode: "kamal",
          productId: "p",
          variantId: "v",
          supplierProductId: "sp",
          normalizedExactModel: "m",
          matchConfidence: "exact",
        },
        "admin:super:u",
      ),
    (e: any) => e?.code === "LEGACY_MAPPING_DISABLED" && e?.status === 410,
  );
  console.log("ok - production repositories fail-closed without RPC");
}

{
  // F. source scan — no production runtime RPC invocation
  const rpc = "mp_admin_upsert_supplier_mapping";
  const skipDir = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "coverage",
    ".vercel",
  ]);
  const hits: string[] = [];

  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      if (skipDir.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(name)) continue;
      // Allow tests and the intentional SQL-adjacent docs/scripts are not scanned here.
      if (/\.test\.ts$|\.pg\.test\.ts$/.test(name)) continue;
      const text = readFileSync(full, "utf8");
      if (!text.includes(rpc)) continue;
      // Fail-closed throw sites may mention the RPC only in comments — allow comment-only.
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line.includes(rpc)) continue;
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
        hits.push(`${relative(ROOT, full)}:${i + 1}:${trimmed}`);
      }
    }
  }
  walk(join(ROOT, "server"));
  walk(join(ROOT, "src"));
  assert.deepEqual(
    hits,
    [],
    `production runtime must not invoke ${rpc}:\n${hits.join("\n")}`,
  );

  // SQL definition remains (WS3 historical + WS-MAP-0 guard)
  const guard = readFileSync(
    join(ROOT, "scripts/marketplace-ws-map-0-legacy-guard.sql"),
    "utf8",
  );
  assert.ok(guard.includes("MANUAL APPLICATION ONLY"));
  assert.ok(guard.includes("DO NOT AUTO-APPLY"));
  assert.ok(guard.includes("LEGACY_MAPPING_DISABLED"));
  assert.ok(guard.includes("revoke all on function public.mp_admin_upsert_supplier_mapping"));
  assert.ok(guard.includes("service_role"));
  assert.ok(!/grant execute on function[\s\S]*mp_admin_upsert_supplier_mapping[\s\S]*service_role/i.test(guard));
  console.log("ok - source scan: no production RPC callers; SQL guard present");
}

{
  // G / publication-separation assertions
  assert.equal(PHASE1_LIVE_PUBLICATION_ALLOWED, false);
  assert.equal(EVIDENCE_BLOCKER_VARIANT_IDS.length, 4);
  const live = readFileSync(
    join(ROOT, "server/marketplace/suppliers/liveCatalogueService.ts"),
    "utf8",
  );
  assert.ok(live.includes("productionReady: false"));
  assert.ok(live.includes("publishedCount: 0"));
  // Preview may mention mp_publish_price only to assert it is not invoked.
  assert.ok(live.includes("mp_publish_price not invoked"));
  assert.ok(!/rpc\s*\(\s*["']mp_publish_price["']/.test(live));
  assert.ok(!/\.rpc\(\s*["']mp_publish_price["']/.test(live));
  const pricingRepoSrc = readFileSync(
    join(ROOT, "server/marketplace/pricing/pricingRepository.ts"),
    "utf8",
  );
  assert.ok(pricingRepoSrc.includes("LEGACY_MAPPING_DISABLED"));
  assert.ok(!pricingRepoSrc.includes("mp_admin_upsert_supplier_mapping"));
  const supplierRepoSrc = readFileSync(
    join(ROOT, "server/marketplace/suppliers/supplierRepository.ts"),
    "utf8",
  );
  assert.ok(!supplierRepoSrc.includes("mp_admin_upsert_supplier_mapping"));
  // Official Meta WhatsApp transport files untouched by this workstream file set
  // (asserted via git scope in commit boundary; smoke: webhook router still present).
  assert.ok(
    statSync(join(ROOT, "server/whatsappTransport/index.ts")).isFile(),
  );
  console.log("ok - publication-separation / Phase1 locks / blockers unchanged");
}

console.log("\nWS-MAP-0 HTTP/source tests passed.");
