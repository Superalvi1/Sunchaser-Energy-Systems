/**
 * WS4 route / RBAC / adapter unit tests.
 * Run: npm run test:marketplace-ws4
 */
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestActor } from "../../middleware/actor.ts";
import { createMarketplaceSupplierRouter } from "./supplierRoutes.ts";
import { createKamalAdapter } from "./kamalAdapter.ts";
import { createAlladinAdapter } from "./alladinAdapter.ts";
import {
  isMappingPublishEligible,
  isEvidenceBlockerVariant,
} from "./evidenceBlockers.ts";
import { EVIDENCE_BLOCKER_VARIANT_IDS } from "./adapterTypes.ts";
import type { SupplierRepository } from "./supplierRepository.ts";
import { createSupplierIngestionService } from "./supplierIngestionService.ts";
import { SupplierError } from "./supplierTypes.ts";

const JWT_SECRET =
  process.env.JWT_SECRET || "marketplace-ws4-supplier-test-secret-min-32!!";

function actor(
  role: string,
  overrides: Partial<RequestActor> = {},
): RequestActor {
  return {
    id: overrides.id || `u-${role.replace(/\s+/g, "-").toLowerCase()}`,
    username: overrides.username || role.toLowerCase(),
    name: role,
    email: `${role}@example.com`,
    role,
    accountStatus: "Approved",
    emailVerified: true,
    onboardingCompleted: true,
    authMethod: "jwt",
    ...overrides,
  };
}

async function withApp(
  mount: (app: express.Express) => void,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
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

async function api(
  base: string,
  path: string,
  init: RequestInit & { actor?: RequestActor | null } = {},
) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json");
  if (init.actor) {
    // Test harness: inject actor via middleware below
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function memoryRepo(): SupplierRepository & {
  alerts: unknown[];
  jobs: unknown[];
  observations: unknown[];
} {
  const alerts: unknown[] = [];
  const jobs: any[] = [];
  const observations: unknown[] = [];
  let running = false;
  return {
    alerts,
    jobs,
    observations,
    async listActiveMappings() {
      return [];
    },
    async getPricingConfig() {
      return { maxIncreasePct: 15, maxDecreasePct: 25, stalenessHours: 36 };
    },
    async getVariantWebsitePrice() {
      return 100000;
    },
    async startJob(trigger, actorScope) {
      if (running) {
        throw new SupplierError(409, "CONFLICT", "Overlapping job already running.");
      }
      running = true;
      const runId = `mpjob_${jobs.length + 1}`;
      jobs.push({ runId, trigger, actorScope, status: "running" });
      return { runId };
    },
    async finishJob(runId, status) {
      running = false;
      const j = jobs.find((x) => x.runId === runId);
      if (j) j.status = status;
    },
    async insertObservation(input) {
      observations.push(input);
      return {
        observationId: `obs_${observations.length}`,
        productId: "p1",
        variantId: "v1",
      };
    },
    async createAlert(input) {
      alerts.push(input);
      return { alertId: `alt_${alerts.length}` };
    },
    async listAlerts() {
      return alerts.map((a: any, i) => ({
        id: `alt_${i + 1}`,
        runId: a.runId,
        productId: a.productId,
        variantId: a.variantId,
        alertType: a.alertType,
        severity: a.severity,
        message: a.message,
        resolved: false,
        createdAt: new Date().toISOString(),
      }));
    },
    async publishPrice() {
      return { websitePriceState: "confirm_price", websitePriceSource: null };
    },
    async upsertMapping() {
      return { mappingId: "mpsp_1", matchLocked: false };
    },
  };
}

{
  // Adapter normalization + no unauthorized live access
  const kamal = createKamalAdapter({
    fixtures: new Map([
      [
        "map1",
        {
          mappingId: "map1",
          supplierPublicPrice: 120000,
          availability: "in_stock",
          parseStatus: "ok",
        },
      ],
    ]),
  });
  assert.equal(kamal.isLiveEnabled({}), false);
  assert.equal(
    kamal.isLiveEnabled({
      MARKETPLACE_WS4_KAMAL_LIVE_ENABLED: "true",
    } as any),
    false,
  );
  const mapping = {
    id: "map1",
    supplierId: "mpsup_kamal",
    supplierCode: "kamal" as const,
    productId: "p1",
    variantId: "v1",
    supplierProductId: "SP1",
    supplierVariantId: null,
    supplierSku: "SKU1",
    normalizedExactModel: "model",
    matchConfidence: "exact" as const,
    matchLocked: false,
    active: true,
    supplierUrl: null,
    matchEvidence: {},
  };
  const got = await kamal.fetchObservation(mapping);
  assert.equal(got.ok, true);
  if (got.ok) {
    assert.equal(got.observation.supplierPublicPrice, 120000);
    assert.equal(got.observation.currency, "PKR");
  }
  const empty = createKamalAdapter();
  const miss = await empty.fetchObservation(mapping);
  assert.equal(miss.ok, false);
  if (!miss.ok) assert.equal(miss.failureClass, "disabled");

  const alladin = createAlladinAdapter();
  assert.equal(alladin.isLiveEnabled({}), false);
  console.log("ok - adapter normalization and no unauthorized live access");
}

{
  for (const id of EVIDENCE_BLOCKER_VARIANT_IDS) {
    assert.equal(isEvidenceBlockerVariant(id), true);
  }
  assert.equal(
    isMappingPublishEligible({
      id: "x",
      supplierId: "s",
      supplierCode: "kamal",
      productId: "p",
      variantId: EVIDENCE_BLOCKER_VARIANT_IDS[0],
      supplierProductId: "sp",
      supplierVariantId: null,
      supplierSku: null,
      normalizedExactModel: "m",
      matchConfidence: "exact",
      matchLocked: false,
      active: true,
      supplierUrl: null,
      matchEvidence: {},
    }),
    false,
  );
  assert.equal(
    isMappingPublishEligible({
      id: "x",
      supplierId: "s",
      supplierCode: "kamal",
      productId: "p",
      variantId: "mpvar_other",
      supplierProductId: "sp",
      supplierVariantId: null,
      supplierSku: null,
      normalizedExactModel: "m",
      matchConfidence: "likely",
      matchLocked: false,
      active: true,
      supplierUrl: null,
      matchEvidence: {},
    }),
    false,
  );
  console.log("ok - evidence blockers and mapping eligibility");
}

{
  process.env.MARKETPLACE_ENABLED = "true";
  process.env.JWT_SECRET = JWT_SECRET;
  const repo = memoryRepo();
  const ingestion = createSupplierIngestionService({
    repository: repo,
    env: process.env,
  });

  await withApp(
    (app) => {
      app.use((req, _res, next) => {
        const role = String(req.headers["x-test-role"] || "");
        if (role) {
          (req as any).actor = actor(role, {
            id: String(req.headers["x-test-id"] || "u1"),
          });
        }
        next();
      });
      app.use(
        "/api/marketplace/admin",
        createMarketplaceSupplierRouter({
          repository: repo,
          ingestion,
          env: process.env,
        }),
      );
    },
    async (base) => {
      const unauth = await api(base, "/api/marketplace/admin/price-alerts");
      assert.equal(unauth.status, 401);

      const customer = await api(base, "/api/marketplace/admin/price-alerts", {
        headers: { "x-test-role": "Customer" },
      });
      assert.equal(customer.status, 403);

      const sales = await api(base, "/api/marketplace/admin/price-alerts", {
        headers: { "x-test-role": "Sales Manager" },
      });
      assert.equal(sales.status, 403);

      const admin = await api(base, "/api/marketplace/admin/price-alerts", {
        headers: { "x-test-role": "Admin" },
      });
      assert.equal(admin.status, 200);

      const spoof = await api(base, "/api/marketplace/admin/price-check/run", {
        method: "POST",
        headers: {
          "x-test-role": "Admin",
          "x-actor-role": "Super Admin",
        },
        body: JSON.stringify({ actor_scope: "admin:super:x" }),
      });
      assert.ok(spoof.status === 400 || spoof.status === 403);

      const mappingDenied = await api(
        base,
        "/api/marketplace/admin/suppliers/mappings",
        {
          method: "POST",
          headers: { "x-test-role": "Admin" },
          body: JSON.stringify({
            supplierCode: "kamal",
            productId: "p",
            variantId: "v",
            supplierProductId: "sp",
            normalizedExactModel: "m",
            matchConfidence: "exact",
          }),
        },
      );
      assert.equal(mappingDenied.status, 403);

      const mappingOk = await api(
        base,
        "/api/marketplace/admin/suppliers/mappings",
        {
          method: "POST",
          headers: { "x-test-role": "Super Admin" },
          body: JSON.stringify({
            supplierCode: "kamal",
            productId: "p",
            variantId: "v",
            supplierProductId: "sp",
            normalizedExactModel: "m",
            matchConfidence: "exact",
          }),
        },
      );
      assert.equal(mappingOk.status, 201);

      const scheduled = await api(base, "/api/marketplace/admin/price-check/run", {
        method: "POST",
        headers: { "x-test-role": "Admin" },
        body: JSON.stringify({ trigger: "scheduled" }),
      });
      assert.equal(scheduled.status, 503);
      assert.equal(scheduled.body?.error?.code, "ADAPTER_NOT_AUTHORIZED");
    },
  );
  console.log("ok - RBAC, spoofing rejection, scheduled fail-closed");
}

{
  // Public route policy still denies admin (uses production helpers)
  const { isPublicApiRoute } = await import("../../middleware/publicRoutes.ts");
  const { isCustomerAllowedApiRoute } = await import(
    "../../middleware/customerRoutePolicy.ts"
  );
  assert.equal(
    isPublicApiRoute("GET", "/api/marketplace/admin/price-alerts"),
    false,
  );
  assert.equal(
    isPublicApiRoute("POST", "/api/marketplace/admin/price-check/run"),
    false,
  );
  assert.equal(
    isCustomerAllowedApiRoute("/api/marketplace/admin/price-alerts"),
    false,
  );
  console.log("ok - public/customer denial for WS4 admin routes");
}

console.log("\nWS4 supplier route/unit tests passed.");
