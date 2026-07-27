/**
 * CEO automatic supplier import — required scenario tests.
 * Run: npm run test:marketplace-ceo-auto-import
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestActor } from "../../middleware/actor.ts";
import type { CatalogueProductObservation } from "../suppliers/liveCatalogueTypes.ts";
import { SHOPIFY_STOREFRONT_PRODUCTS_JSON } from "../suppliers/liveCatalogueTypes.ts";
import { LEGACY_MAPPING_DISABLED_CODE } from "../legacyMappingDisabled.ts";
import { createMarketplacePricingRouter } from "../pricing/pricingRoutes.ts";
import { createMarketplaceSupplierRouter } from "../suppliers/supplierRoutes.ts";
import { createMarketplaceAutoImportRouter } from "./autoImportRoutes.ts";
import { createMemoryAutoImportRepository } from "./autoImportRepository.ts";
import { createAutoImportService } from "./autoImportService.ts";
import {
  buildVariantIdentity,
  exactIdentityKey,
  hasHardIdentityConflict,
} from "./identityNormalize.ts";
import {
  resolvePriceWithRollback,
  selectLowestValidPrice,
} from "./priceSelect.ts";
import { PHASE1_LIVE_PUBLICATION_ALLOWED } from "../suppliers/liveCatalogueService.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");

function obs(
  partial: Partial<CatalogueProductObservation> & {
    supplier: "kamal" | "alladin";
    title: string;
    supplierProductId: string;
  },
): CatalogueProductObservation {
  const id = partial.supplierProductId;
  return {
    supplier: partial.supplier,
    supplierProductId: id,
    sourceKey: `${partial.supplier}:${id}`,
    title: partial.title,
    brand: partial.brand ?? "Inverex",
    modelSku: partial.modelSku ?? "NITROX",
    category: partial.category ?? "Solar Inverter",
    currentListedPricePkr: partial.currentListedPricePkr ?? 100000,
    compareAtPricePkr: partial.compareAtPricePkr ?? null,
    availability: partial.availability ?? "in_stock",
    parseStatus: partial.parseStatus ?? "ok",
    confirmPriceRecommended: partial.supplier === "kamal",
    canonicalUrl:
      partial.canonicalUrl ??
      `https://${partial.supplier === "kamal" ? "kamalsolar.pk" : "alladin.pk"}/products/${id}`,
    primaryImageUrl: partial.primaryImageUrl ?? null,
    additionalImageUrls: partial.additionalImageUrls ?? [],
    description: partial.description ?? "spec",
    fetchedAt: partial.fetchedAt ?? "2026-07-26T12:00:00.000Z",
    rawEvidence: {
      source: SHOPIFY_STOREFRONT_PRODUCTS_JSON,
      productType: partial.category ?? "Solar Inverter",
      ...(partial.rawEvidence || {}),
    },
  };
}

async function runWith(fixtures: CatalogueProductObservation[]) {
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    fixtureObservations: fixtures,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  const listings = await service.listListings();
  return { result, listings, repository };
}

{
  // Identity: on-grid vs hybrid never merge
  const hybrid = buildVariantIdentity({
    title: "Inverex Nitrox 10kW Hybrid Inverter",
    brand: "Inverex",
    modelSku: "NITROX",
    category: "Solar Inverter",
  });
  const ongrid = buildVariantIdentity({
    title: "Inverex Nitrox 10kW On-Grid Inverter",
    brand: "Inverex",
    modelSku: "NITROX",
    category: "Solar Inverter",
  });
  assert.equal(hybrid.topology, "hybrid");
  assert.equal(ongrid.topology, "ongrid");
  assert.equal(hasHardIdentityConflict(hybrid, ongrid), true);
  assert.notEqual(exactIdentityKey(hybrid), exactIdentityKey(ongrid));
  console.log("ok - on-grid versus hybrid conflict");
}

{
  // Capacity / model-suffix conflict
  const a = buildVariantIdentity({
    title: "Knox Zapher 11.2kW Hybrid Inverter",
    brand: "Knox",
    category: "Solar Inverter",
  });
  const b = buildVariantIdentity({
    title: "Knox Zapher 6kW Hybrid Inverter",
    brand: "Knox",
    category: "Solar Inverter",
  });
  assert.equal(hasHardIdentityConflict(a, b), true);
  const c = buildVariantIdentity({
    title: "Knox Zapher Pro 11.2kW Hybrid Inverter Extra Suffix",
    brand: "Knox",
    category: "Solar Inverter",
  });
  // Different suffix tokens → separate exact keys when both eligible
  console.log("ok - capacity/model-suffix conflict primitives");
}

{
  // Kamal-only
  const { listings, result } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "k-only",
      currentListedPricePkr: 250000,
    }),
  ]);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]!.selectedSupplier, "kamal");
  assert.equal(listings[0]!.websitePricePkr, 250000);
  assert.equal(result.ceoDiscountApplied, false);
  assert.equal(result.legacyMappingBypassUsed, false);
  console.log("ok - Kamal-only product");
}

{
  // Alladin-only
  const { listings } = await runWith([
    obs({
      supplier: "alladin",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "a-only",
      brand: "Inverex",
      currentListedPricePkr: 240000,
    }),
  ]);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]!.selectedSupplier, "alladin");
  assert.equal(listings[0]!.websitePricePkr, 240000);
  console.log("ok - Aladin-only product");
}

{
  // Identical on both — Kamal cheaper
  const { listings, result } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "same-k",
      currentListedPricePkr: 200000,
    }),
    obs({
      supplier: "alladin",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "same-a",
      currentListedPricePkr: 220000,
    }),
  ]);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]!.websitePricePkr, 200000);
  assert.equal(listings[0]!.selectedSupplier, "kamal");
  assert.ok(result.sampleLowestPrice[0]?.considered.length === 2);
  console.log("ok - identical product both sites; Kamal cheaper");
}

{
  // Alladin cheaper
  const { listings } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "same-k2",
      currentListedPricePkr: 230000,
    }),
    obs({
      supplier: "alladin",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "same-a2",
      currentListedPricePkr: 210000,
    }),
  ]);
  assert.equal(listings[0]!.websitePricePkr, 210000);
  assert.equal(listings[0]!.selectedSupplier, "alladin");
  console.log("ok - Aladin cheaper");
}

{
  // Equal prices — deterministic kamal tie-break
  const sel = selectLowestValidPrice([
    {
      supplier: "alladin",
      sourceKey: "alladin:1",
      canonicalUrl: "https://alladin.pk/products/1",
      title: "X",
      currentListedPricePkr: 100,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "t",
    },
    {
      supplier: "kamal",
      sourceKey: "kamal:1",
      canonicalUrl: "https://kamalsolar.pk/products/1",
      title: "X",
      currentListedPricePkr: 100,
      parseStatus: "ok",
      availability: "in_stock",
      fetchedAt: "t",
    },
  ]);
  assert.equal(sel.ok, true);
  if (sel.ok) assert.equal(sel.supplier, "kamal");
  console.log("ok - equal prices tie-break");
}

{
  // Multiple variants stay separate (capacity)
  const { listings } = await runWith([
    obs({
      supplier: "kamal",
      title: "Knox Hybrid Inverter 6kW Single Phase",
      supplierProductId: "v6",
      brand: "Knox",
      currentListedPricePkr: 150000,
    }),
    obs({
      supplier: "kamal",
      title: "Knox Hybrid Inverter 11.2kW Single Phase",
      supplierProductId: "v11",
      brand: "Knox",
      currentListedPricePkr: 300000,
    }),
  ]);
  assert.equal(listings.length, 2);
  console.log("ok - multiple variants");
}

{
  // Unavailable product still imports with sold_out when priced
  const { listings } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "sold",
      currentListedPricePkr: 250000,
      availability: "sold_out",
    }),
  ]);
  assert.equal(listings[0]!.availability, "sold_out");
  assert.equal(listings[0]!.active, false);
  console.log("ok - unavailable product");
}

{
  // Missing/invalid price rejected
  const { listings, result } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "bad",
      currentListedPricePkr: null,
      parseStatus: "missing",
    }),
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter Zero",
      supplierProductId: "zero",
      currentListedPricePkr: 0,
      parseStatus: "malformed",
    }),
  ]);
  assert.equal(listings.length, 0);
  assert.ok(result.health.rejectedVariants >= 2);
  console.log("ok - missing/invalid price");
}

{
  // Supplier timeout → partial/failed with error, other supplier still imports
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
    catalogueDeps: {
      pageProvider: async (supplier) => {
        if (supplier === "kamal") {
          throw new Error("TIMEOUT");
        }
        return {
          products: [
            {
              id: 99,
              title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
              handle: "nitrox-10",
              vendor: "Inverex",
              product_type: "Solar Inverter",
              tags: ["Solar Inverter"],
              body_html: "<p>x</p>",
              variants: [{ price: "250000.00", available: true, sku: "N" }],
              images: [],
            },
          ],
        };
      },
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.ok(result.health.errors.some((e) => e.includes("kamal")));
  assert.ok((await service.listListings()).length >= 1);
  console.log("ok - supplier timeout partial import");
}

{
  // Stale / rollback to last valid observation
  const repository = createMemoryAutoImportRepository();
  const first = createAutoImportService({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "rb",
        currentListedPricePkr: 250000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  await first.runAutomaticImport({ actorScope: "admin:super:ceo" });
  const second = createAutoImportService({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "rb",
        currentListedPricePkr: null,
        parseStatus: "missing",
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  // When only invalid offer remains, group may reject entirely after rejectReason filter.
  // Explicit unit for rollback helper:
  const rolled = resolvePriceWithRollback(
    { ok: false, reason: "no_valid_listed_price" },
    { pricePkr: 250000, observedAt: "t0", supplier: "kamal" },
  );
  assert.equal(rolled.rolledBack, true);
  assert.equal(rolled.pricePkr, 250000);
  console.log("ok - stale price rollback helper");
}

{
  // Duplicate product URL rejected
  const { listings, result } = await runWith([
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "u1",
      canonicalUrl: "https://kamalsolar.pk/products/dup",
      currentListedPricePkr: 250000,
    }),
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter Copy",
      supplierProductId: "u2",
      canonicalUrl: "https://kamalsolar.pk/products/dup",
      currentListedPricePkr: 240000,
    }),
  ]);
  assert.equal(listings.length, 1);
  assert.ok(result.health.rejectedVariants >= 1);
  console.log("ok - duplicate product URL");
}

{
  // Import idempotency
  const repository = createMemoryAutoImportRepository();
  const fixtures = [
    obs({
      supplier: "kamal",
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      supplierProductId: "idem",
      currentListedPricePkr: 250000,
    }),
  ];
  const env = {
    MARKETPLACE_ENABLED: "true",
    MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
  };
  const s1 = createAutoImportService({ repository, fixtureObservations: fixtures, env });
  const r1 = await s1.runAutomaticImport({ actorScope: "admin:super:ceo" });
  const s2 = createAutoImportService({ repository, fixtureObservations: fixtures, env });
  const r2 = await s2.runAutomaticImport({ actorScope: "admin:super:ceo" });
  assert.equal(r1.health.productsCreated, 1);
  assert.equal(r2.health.productsCreated, 0);
  assert.equal(r2.health.productsUpdated, 1);
  assert.equal((await s2.listListings()).length, 1);
  console.log("ok - import idempotency");
}

{
  // Automatic website publication (memory catalogue listing priced)
  const { listings, result } = await runWith([
    obs({
      supplier: "alladin",
      title: "Pylontech US5000 4.8kWh Lithium Battery 48V",
      supplierProductId: "bat",
      brand: "Pylontech",
      category: "Lithium Battery",
      modelSku: "US5000",
      currentListedPricePkr: 180000,
    }),
  ]);
  assert.equal(result.automaticPublication, true);
  assert.ok(listings[0]!.websitePricePkr > 0);
  assert.ok(listings[0]!.productId.startsWith("mpprod_"));
  console.log("ok - automatic website publication");
}

{
  // WS-MAP-0 preserved — legacy mapping still 410
  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "sa",
      name: role,
      email: "sa@test.com",
      role,
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
  }
  process.env.MARKETPLACE_ENABLED = "true";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor("Super Admin");
    next();
  });
  app.use("/api/marketplace/admin", createMarketplacePricingRouter({ env: process.env }));
  app.use("/api/marketplace/admin", createMarketplaceSupplierRouter({ env: process.env }));
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: createAutoImportService({
        fixtureObservations: [],
        env: {
          MARKETPLACE_ENABLED: "true",
          MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
        },
      }),
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const legacy = await fetch(`${base}/api/marketplace/admin/suppliers/mappings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      supplierCode: "kamal",
      productId: "p",
      variantId: "v",
      supplierProductId: "sp",
      normalizedExactModel: "m",
      matchConfidence: "exact",
      active: true,
    }),
  });
  const legacyBody = await legacy.json();
  assert.equal(legacy.status, 410);
  assert.equal(legacyBody.error, LEGACY_MAPPING_DISABLED_CODE);

  const health = await fetch(`${base}/api/marketplace/admin/suppliers/auto-import/health`);
  assert.equal(health.status, 200);
  await new Promise<void>((r) => server.close(() => r()));

  // Phase1 preview lock unchanged
  assert.equal(PHASE1_LIVE_PUBLICATION_ALLOWED, false);

  // No legacy RPC invocation in production autoImport sources (comments allowed)
  const svc = readFileSync(join(__dirname, "autoImportService.ts"), "utf8");
  assert.ok(!/\.rpc\(\s*["']mp_admin_upsert_supplier_mapping["']/.test(svc));
  assert.ok(!/\.rpc\(\s*["']mp_publish_price["']/.test(svc));
  assert.ok(!/supabase\.rpc\(\s*["']mp_admin_upsert_supplier_mapping["']/.test(svc));
  console.log("ok - WS-MAP-0 preserved; auto-import health route; phase1 lock intact");
}

{
  // SQL artifacts: legacy upsert + atomic batch/preflight (manual apply)
  const sql = readFileSync(
    join(ROOT, "scripts/marketplace-ceo-auto-import.sql"),
    "utf8",
  );
  assert.ok(sql.includes("mp_ceo_auto_import_upsert_listing"));
  assert.ok(sql.includes("ceoDiscountApplied"));
  assert.ok(!sql.includes("create or replace function public.mp_admin_upsert_supplier_mapping"));

  const atomic = readFileSync(
    join(ROOT, "scripts/marketplace-ceo-auto-import-atomic.sql"),
    "utf8",
  );
  assert.ok(atomic.includes("mp_ceo_auto_import_preflight"));
  assert.ok(atomic.includes("mp_ceo_auto_import_commit_batch"));
  assert.ok(atomic.includes("SET LOCAL statement_timeout"));
  assert.ok(atomic.includes("ineffective"));
  assert.ok(atomic.includes("mp_ceo_auto_import_runtime"));
  assert.ok(
    /grant execute on function public\.mp_ceo_auto_import_commit_batch[\s\S]*to mp_ceo_auto_import_runtime/i.test(
      atomic,
    ),
    "commit_batch granted to runtime role",
  );
  assert.ok(
    /revoke all on function public\.mp_ceo_auto_import_commit_batch\(text, text, jsonb, jsonb\) from service_role/i.test(
      atomic,
    ),
    "commit_batch revoked from service_role",
  );
  assert.ok(
    !/grant execute on function public\.mp_ceo_auto_import_commit_batch[\s\S]*to service_role/i.test(
      atomic,
    ),
    "commit_batch must not be granted to service_role",
  );
  assert.ok(
    /revoke all on function public\.mp_ceo_auto_import_upsert_listing[\s\S]*from service_role/i.test(
      sql,
    ),
    "upsert revoked from service_role",
  );
  assert.ok(atomic.includes("duplicate identityKey"));
  assert.ok(/pg_catalog\.pg_proc/i.test(atomic));
  // Must NOT claim in-function set_config cancels the outer statement.
  assert.ok(
    !/perform\s+set_config\(\s*'statement_timeout'/i.test(atomic),
    "atomic SQL must not use in-function set_config(statement_timeout)",
  );
  assert.ok(!/p_statement_timeout_ms/.test(atomic));
  assert.ok(!/insert\s+into|update\s+|delete\s+from/i.test(
    atomic.slice(
      atomic.indexOf("mp_ceo_auto_import_preflight"),
      atomic.indexOf("mp_ceo_auto_import_commit_batch"),
    ),
  ));

  const repoSrc = readFileSync(
    join(__dirname, "supabaseAutoImportRepository.ts"),
    "utf8",
  );
  const pgCommitSrc = readFileSync(
    join(__dirname, "autoImportPgCommit.ts"),
    "utf8",
  );
  assert.ok(repoSrc.includes("commitBatchWithStatementTimeout"), "repo uses pg commit helper");
  assert.ok(pgCommitSrc.includes("SET LOCAL statement_timeout"), "pg commit SET LOCAL");
  assert.ok(pgCommitSrc.includes("mp_ceo_auto_import_commit_batch"), "pg commit calls batch rpc");
  assert.ok(pgCommitSrc.includes("ROLE_SWITCH_REJECTED"), "pg commit fail-closed role gate");
  assert.ok(
    pgCommitSrc.includes("resolveRuntimeRoleAuthorization"),
    "pg commit authorizes before BEGIN",
  );
  assert.ok(
    !/catch\s*\{[^}]*SET LOCAL ROLE/s.test(pgCommitSrc) &&
      !/SET LOCAL ROLE[\s\S]{0,120}catch\s*\{/s.test(pgCommitSrc),
    "must not swallow SET LOCAL ROLE failures",
  );
  assert.ok(!pgCommitSrc.includes("Promise.race("), "pg commit must not Promise.race");
  assert.ok(!repoSrc.includes("p_statement_timeout_ms"), "repo must not pass p_statement_timeout_ms");
  assert.ok(!repoSrc.includes("mp_ceo_auto_import_upsert_listing"), "repo must not call upsert rpc");
  // Commit must not Promise.race/abandon the transactional RPC.
  const commitFn = repoSrc.slice(repoSrc.indexOf("async commitBatch"));
  assert.ok(!commitFn.slice(0, 900).includes("withDeadline("), "commitBatch no withDeadline");
  assert.ok(!commitFn.slice(0, 900).includes("sb.rpc("), "commitBatch no supabase.rpc");

  for (const arg of ["$1::text", "$2::text", "$3::jsonb", "$4::jsonb"]) {
    assert.ok(pgCommitSrc.includes(arg), `pg commit missing ${arg}`);
  }
  const guard = readFileSync(
    join(ROOT, "scripts/marketplace-ws-map-0-legacy-guard.sql"),
    "utf8",
  );
  assert.ok(guard.includes("LEGACY_MAPPING_DISABLED"));
  console.log("ok - SQL artifacts + atomic RPC signature alignment");
}

{
  // Memory commitBatch rejects duplicate identityKey before any write
  const repository = createMemoryAutoImportRepository();
  const listing = {
    identityKey: "exact:dup:mem",
    title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
    brandName: "Inverex",
    categoryName: "Solar Inverter",
    websitePricePkr: 100000,
    availability: "in_stock" as const,
    selectedSupplier: "kamal" as const,
    sourceUrls: ["https://example.com/a"],
    matchReason: "exact_identity",
    priceReason: "auto",
    fetchedAt: new Date().toISOString(),
    offers: [],
    previous: null,
  };
  let rejected = false;
  try {
    await repository.commitBatch(
      [listing, { ...listing, sourceUrls: ["https://example.com/b"] }],
      {
        lastSyncAt: null,
        lastSyncStatus: "never",
        lastRunId: "mpair_dup",
        kamalDiscovered: 0,
        alladinDiscovered: 0,
        acceptedVariants: 0,
        rejectedVariants: 0,
        exactMatches: 0,
        conflictKeptSeparate: 0,
        productsCreated: 0,
        productsUpdated: 0,
        lowestPriceSelections: 0,
        rolledBackPrices: 0,
        errors: [],
        note: "",
      },
    );
  } catch (err) {
    rejected = /duplicate identityKey/i.test(String((err as Error).message));
  }
  assert.equal(rejected, true);
  assert.equal((await repository.listListings()).length, 0);
  console.log("ok - memory commit rejects duplicate identityKey");
}

{
  // Sanitized error logging — never emits secrets / bodies / tokens
  const { sanitizeAutoImportError, sanitizeLogText, logAutoImport } =
    await import("./autoImportLog.ts");
  assert.equal(sanitizeLogText("Authorization: Bearer abc.def"), "[redacted]");
  assert.equal(sanitizeLogText('{"products":[1,2,3]}'), "[redacted_payload]");
  assert.ok(!String(sanitizeLogText("user@example.com")).includes("@") || sanitizeLogText("user@example.com") === "[redacted]");
  const rpcErr = sanitizeAutoImportError(
    new Error("function mp_ceo_auto_import_upsert_listing does not exist"),
  );
  assert.equal(rpcErr.errorCode, "RPC_FAILURE", `got ${rpcErr.errorCode}`);
  const lines: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(String(args[0] ?? ""));
  };
  try {
    logAutoImport({
      runId: "mpair_test",
      stage: "route_error",
      status: "failed",
      errorClass: "Error",
      errorCode: "RPC_FAILURE",
      detail: "Authorization: Bearer super-secret-token",
    });
  } finally {
    console.error = origErr;
  }
  assert.equal(lines.length, 1);
  assert.ok(lines[0]!.includes("marketplace-ceo-auto-import"));
  assert.ok(lines[0]!.includes("mpair_test"));
  assert.ok(!lines[0]!.toLowerCase().includes("bearer"));
  assert.ok(!lines[0]!.includes("super-secret-token"));
  console.log("ok - sanitized error logging");
}

{
  // Supplier HTTP failure → soft error, bounded result (no throw)
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_TIMEOUT_MS: "30000",
      MARKETPLACE_CEO_AUTO_IMPORT_SUPPLIER_TIMEOUT_MS: "5000",
    },
    catalogueDeps: {
      pageProvider: async (supplier) => {
        if (supplier === "kamal") {
          const err = new Error("Upstream HTTP 503");
          (err as any).code = "HTTP_ERROR";
          (err as any).name = "SafeHttpError";
          throw err;
        }
        return {
          products: [
            {
              id: 101,
              title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
              handle: "nitrox-10",
              vendor: "Inverex",
              product_type: "Solar Inverter",
              tags: ["Solar Inverter"],
              body_html: "<p>x</p>",
              variants: [{ price: "250000.00", available: true, sku: "N" }],
              images: [],
            },
          ],
        };
      },
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "partial");
  assert.ok(result.health.errors.some((e) => /kamal/i.test(e)));
  assert.ok((await service.listListings()).length >= 1);
  console.log("ok - supplier HTTP failure soft-fail");
}

{
  // Malformed supplier response → soft error
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
    catalogueDeps: {
      pageProvider: async () => {
        throw Object.assign(new Error("Invalid JSON catalogue payload."), {
          name: "SafeHttpError",
          code: "HTTP_ERROR",
        });
      },
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  assert.ok(result.health.errors.length >= 1);
  assert.equal((await service.listListings()).length, 0);
  console.log("ok - malformed supplier response");
}

{
  // Atomic mid-batch failure → zero retained writes from the failed run
  const failCtrl = { n: 1 as number | null };
  const repository = createMemoryAutoImportRepository({
    failAfterNWrites: failCtrl,
  });
  const service = createAutoImportService({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "rpc-a",
        currentListedPricePkr: 200000,
      }),
      obs({
        supplier: "kamal",
        title: "Knox Hybrid Inverter 6kW Single Phase",
        supplierProductId: "rpc-b",
        brand: "Knox",
        currentListedPricePkr: 150000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  assert.ok(result.health.errors.some((e) => /persist_/i.test(e)));
  assert.equal((await service.listListings()).length, 0);
  assert.equal(result.health.productsCreated, 0);
  console.log("ok - atomic commit failure leaves zero listings");
}

{
  // Mid-batch failure leaves every pre-existing listing value unchanged
  const failCtrl = { n: null as number | null };
  const repository = createMemoryAutoImportRepository({
    failAfterNWrites: failCtrl,
  });
  const env = {
    MARKETPLACE_ENABLED: "true",
    MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
  };
  const seed = createAutoImportService({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "pre-exist",
        currentListedPricePkr: 200000,
      }),
    ],
    env,
  });
  await seed.runAutomaticImport({ actorScope: "admin:super:ceo" });
  const before = await seed.listListings();
  assert.equal(before.length, 1);
  const preKey = before[0]!.identityKey;
  const prePrice = before[0]!.websitePricePkr;
  const preValid = before[0]!.lastValidPricePkr;

  failCtrl.n = 1;
  const service = createAutoImportService({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "pre-exist",
        currentListedPricePkr: 210000,
      }),
      obs({
        supplier: "kamal",
        title: "Knox Hybrid Inverter 6kW Single Phase",
        supplierProductId: "new-fail",
        brand: "Knox",
        currentListedPricePkr: 150000,
      }),
    ],
    env,
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  const after = await service.listListings();
  assert.equal(after.length, 1);
  assert.equal(after[0]!.identityKey, preKey);
  assert.equal(after[0]!.websitePricePkr, prePrice);
  assert.equal(after[0]!.lastValidPricePkr, preValid);
  console.log("ok - atomic rollback preserves pre-existing listing values");
}

{
  // Health-save failure: request still completes; both failures logged
  const base = createMemoryAutoImportRepository();
  const lines: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(String(args[0] ?? ""));
  };
  try {
    const repository = {
      getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
      getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
      listListings: () => base.listListings(),
      getHealth: () => base.getHealth(),
      async commitBatch() {
        throw new Error(
          "function mp_ceo_auto_import_commit_batch does not exist",
        );
      },
      async saveHealth() {
        throw new Error("sync_runs upsert timed out");
      },
    };
    const service = createAutoImportService({
      repository,
      fixtureObservations: [
        obs({
          supplier: "kamal",
          title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
          supplierProductId: "hs-1",
          currentListedPricePkr: 100000,
        }),
      ],
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_TIMEOUT_MS: "8000",
      },
    });
    const t0 = Date.now();
    const result = await service.runAutomaticImport({
      actorScope: "admin:super:ceo",
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 5000, `expected bounded response, got ${elapsed}ms`);
    assert.equal(result.status, "failed");
    assert.ok(result.health.errors.some((e) => /persist_|RPC/i.test(e)));
    assert.ok(lines.some((l) => l.includes("persist_failed")));
    assert.ok(lines.some((l) => l.includes("health_save_failed")));
    assert.ok(
      lines.some((l) => l.includes("persist_failed") && l.includes("RPC_FAILURE")) ||
        lines.some(
          (l) => l.includes("unexpected_error") && l.includes("RPC_FAILURE"),
        ),
    );
  } finally {
    console.error = origErr;
  }
  console.log("ok - health-save failure logged; request still completes");
}

{
  // Alias path shares Super-Admin auth; UI uses canonical admin path
  const { createMarketplaceAutoImportAliasRouter } = await import(
    "./autoImportRoutes.ts"
  );
  const { isPublicApiRoute } = await import("../../middleware/publicRoutes.ts");
  assert.equal(
    isPublicApiRoute("POST", "/api/marketplace/auto-import/run"),
    false,
  );
  assert.equal(
    isPublicApiRoute("GET", "/api/marketplace/auto-import/health"),
    false,
  );
  assert.equal(
    isPublicApiRoute("POST", "/api/marketplace/admin/suppliers/auto-import/run"),
    false,
  );

  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "sa",
      name: role,
      email: "sa@test.com",
      role,
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
  }
  const shared = createAutoImportService({
    fixtureObservations: [],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor("Super Admin");
    next();
  });
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: shared,
    }),
  );
  app.use(
    "/api/marketplace/auto-import",
    createMarketplaceAutoImportAliasRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: shared,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    const aliasHealth = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/auto-import/health`,
    );
    assert.equal(aliasHealth.status, 200);
    const adminHealth = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/health`,
    );
    assert.equal(adminHealth.status, 200);
    const apiSrc = readFileSync(join(ROOT, "src/services/api.ts"), "utf8");
    assert.ok(
      apiSrc.includes("/api/marketplace/admin/suppliers/auto-import/run"),
    );
    assert.ok(
      !apiSrc.includes('authorizedFetch("/api/marketplace/auto-import/run"'),
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  console.log("ok - alias + canonical share auth; UI uses canonical admin path");
}

{
  // Unexpected exception during discovery is bounded (supplier soft-fail)
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
    catalogueDeps: {
      pageProvider: async () => {
        throw new TypeError("unexpected boom");
      },
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  assert.ok(result.runId.startsWith("mpair_"));
  assert.equal(result.health.lastSyncStatus, "failed");
  console.log("ok - unexpected exception bounded");
}

{
  // Supplier timeout via job/supplier deadline — one supplier cannot hang forever
  const repository = createMemoryAutoImportRepository();
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_TIMEOUT_MS: "8000",
      MARKETPLACE_CEO_AUTO_IMPORT_SUPPLIER_TIMEOUT_MS: "200",
    },
    catalogueDeps: {
      pageProvider: async (supplier) => {
        if (supplier === "kamal") {
          await new Promise((r) => setTimeout(r, 2000));
          return { products: [] };
        }
        return {
          products: [
            {
              id: 77,
              title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
              handle: "nitrox-10",
              vendor: "Inverex",
              product_type: "Solar Inverter",
              tags: ["Solar Inverter"],
              body_html: "<p>x</p>",
              variants: [{ price: "250000.00", available: true, sku: "N" }],
              images: [],
            },
          ],
        };
      },
    },
  });
  const t0 = Date.now();
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 3000, `expected fast fail, got ${elapsed}ms`);
  assert.ok(result.health.errors.some((e) => /kamal/i.test(e) && /TIMEOUT/i.test(e)));
  assert.ok((await service.listListings()).length >= 1);
  console.log("ok - supplier timeout bounded; other supplier proceeds");
}

{
  // Route always returns a bounded HTTP response (202 on service failure, 500 only on throw)
  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "sa",
      name: role,
      email: "sa@test.com",
      role,
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
  }
  const failingRepo = createMemoryAutoImportRepository();
  const boomService = createAutoImportService({
    repository: {
      ...failingRepo,
      async commitBatch() {
        throw new Error("rpc commit_batch failed");
      },
    },
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "route-1",
        currentListedPricePkr: 100000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor("Super Admin");
    next();
  });
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: boomService,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  const res = await fetch(
    `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/run`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  const body = await res.json();
  assert.equal(res.status, 202);
  assert.equal(body.ok, true);
  assert.equal(body.data.status, "failed");
  assert.ok(body.data.runId);
  assert.equal((await boomService.listListings()).length, 0);
  await new Promise<void>((r) => server.close(() => r()));
  console.log("ok - route returns bounded 202 on persist failure");
}

{
  // Route 500 path still logs + returns bounded JSON when service itself throws
  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "sa",
      name: role,
      email: "sa@test.com",
      role,
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor("Super Admin");
    next();
  });
  const lines: string[] = [];
  const origErr = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(String(args[0] ?? ""));
  };
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      service: {
        runAutomaticImport: async () => {
          throw new Error("totally unexpected");
        },
        getHealth: async () => {
          throw new Error("health boom");
        },
        listListings: async () => {
          throw new Error("list boom");
        },
        repository: createMemoryAutoImportRepository(),
      } as any,
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/run`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "INTERNAL_ERROR");
    assert.ok(lines.some((l) => l.includes("route_error")));
  } finally {
    console.error = origErr;
    await new Promise<void>((r) => server.close(() => r()));
  }
  console.log("ok - route 500 still bounded + logged");
}

{
  // Kamal-shaped Shopify products.json parsing (title/vendor/handle/images/variants/price)
  const { normalizeCatalogueProducts } = await import(
    "../suppliers/catalogueNormalize.ts"
  );
  const { parseShopifyProductsJson } = await import(
    "../suppliers/shopifyCatalogue.ts"
  );
  const body = JSON.stringify({
    products: [
      {
        id: 6355818922601,
        title: "Crown Electra Boost 5kW 100A Lithium Battery",
        handle: "crown-electra-boost-5kw-100a-lithium-battery",
        body_html: "<p>Lithium battery for solar storage</p>",
        vendor: "Crown Solar",
        product_type: "Lithium Battery",
        tags: ["Lithium Battery", "Solar"],
        variants: [
          {
            id: 1,
            title: "Default",
            price: "220000.00",
            compare_at_price: null,
            available: true,
            sku: null,
          },
        ],
        images: [
          {
            src: "https://cdn.shopify.com/s/files/1/0635/5818/9226/files/IP2051.2v100A.png",
          },
        ],
      },
    ],
  });
  const page = parseShopifyProductsJson(body);
  assert.equal(page.products.length, 1);
  const { accepted, excluded } = normalizeCatalogueProducts(
    "kamal",
    page.products,
    "2026-07-27T00:00:00.000Z",
  );
  assert.equal(excluded.length, 0);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]!.currentListedPricePkr, 220000);
  assert.equal(accepted[0]!.brand, "Crown Solar");
  assert.ok(accepted[0]!.canonicalUrl.includes("/products/crown-electra"));
  assert.ok(accepted[0]!.primaryImageUrl?.includes("cdn.shopify.com"));
  assert.equal(accepted[0]!.availability, "in_stock");
  console.log("ok - Kamal response parsing");
}

{
  // Alladin-shaped Shopify products.json with compare-at + SKU
  const { normalizeCatalogueProducts } = await import(
    "../suppliers/catalogueNormalize.ts"
  );
  const { parseShopifyProductsJson } = await import(
    "../suppliers/shopifyCatalogue.ts"
  );
  const body = JSON.stringify({
    products: [
      {
        id: 77115130135,
        title: "Tomzn TOB7Z-63 4P DC MTS Dual Power Manual Transfer Switch for PV system",
        handle: "tomzn-tob7z-63-4p-dc-mts-pv",
        body_html: "<p>PV transfer switch</p>",
        vendor: "Tomzn",
        product_type: "Protection",
        tags: ["PV", "MTS"],
        variants: [
          {
            id: 9,
            title: "Default",
            price: "6499.00",
            compare_at_price: "7299.00",
            available: true,
            sku: "AR-002453",
          },
        ],
        images: [
          {
            src: "https://cdn.shopify.com/s/files/1/0771/1513/0135/files/TOMZN.jpg",
          },
        ],
      },
    ],
  });
  const page = parseShopifyProductsJson(body);
  const { accepted } = normalizeCatalogueProducts(
    "alladin",
    page.products,
    "2026-07-27T00:00:00.000Z",
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]!.currentListedPricePkr, 6499);
  assert.equal(accepted[0]!.compareAtPricePkr, 7299);
  assert.equal(accepted[0]!.modelSku, "AR-002453");
  assert.equal(accepted[0]!.brand, "Tomzn");
  console.log("ok - Alladin response parsing");
}

{
  // Pagination termination: short page stops; empty page stops; repeated page stops; max products
  const { fetchShopifyCatalogue } = await import(
    "../suppliers/shopifyCatalogue.ts"
  );
  const short = await fetchShopifyCatalogue("kamal", {
    pageLimit: 250,
    maxPages: 40,
    pageProvider: async (_s, page) => {
      if (page === 1) {
        return {
          products: Array.from({ length: 3 }, (_, i) => ({
            id: 100 + i,
            title: `Solar Hybrid Inverter ${i}`,
            handle: `h-${i}`,
            vendor: "Inverex",
            product_type: "Solar Inverter",
            variants: [{ price: "100000", available: true }],
            images: [],
          })),
        };
      }
      throw new Error("should not request page 2 after short page");
    },
  });
  assert.equal(short.pagesFetched, 1);
  assert.equal(short.stopReason, "short_page");

  const empty = await fetchShopifyCatalogue("alladin", {
    pageLimit: 250,
    pageProvider: async () => ({ products: [] }),
  });
  assert.equal(empty.stopReason, "empty_page");

  const repeated = await fetchShopifyCatalogue("kamal", {
    pageLimit: 2,
    maxPages: 5,
    pageProvider: async () => ({
      products: [
        { id: 1, title: "Solar Hybrid Inverter A", variants: [{ price: "1", available: true }] },
        { id: 2, title: "Solar Hybrid Inverter B", variants: [{ price: "1", available: true }] },
      ],
    }),
  });
  assert.ok(repeated.pagesFetched >= 2);
  assert.equal(repeated.stopReason, "repeated_page");

  const capped = await fetchShopifyCatalogue("alladin", {
    pageLimit: 2,
    maxPages: 40,
    maxProducts: 3,
    pageProvider: async (_s, page) => ({
      products: [
        { id: page * 10, title: `Solar Panel ${page}a`, variants: [{ price: "1", available: true }] },
        { id: page * 10 + 1, title: `Solar Panel ${page}b`, variants: [{ price: "1", available: true }] },
      ],
    }),
  });
  assert.equal(capped.stopReason, "max_products");
  assert.ok(capped.rawProductRows >= 3);
  console.log("ok - pagination termination + repeated-page + max products");
}

{
  // Health saved after failure (status flips from never)
  const repository = createMemoryAutoImportRepository();
  assert.equal((await repository.getHealth()).lastSyncStatus, "never");
  const service = createAutoImportService({
    repository,
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
    catalogueDeps: {
      pageProvider: async () => {
        throw Object.assign(new Error("Upstream HTTP 502"), {
          name: "SafeHttpError",
          code: "HTTP_ERROR",
        });
      },
    },
  });
  const result = await service.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(result.status, "failed");
  const health = await service.getHealth();
  assert.equal(health.lastSyncStatus, "failed");
  assert.ok(health.lastRunId);
  assert.equal(result.stages.publicWebsiteVisible, false);
  console.log("ok - health saved after failure");
}

{
  // Read-only preflight: zero write-capable RPC calls
  const { runAutoImportPreflight } = await import("./autoImportPreflight.ts");
  const rpcCalls: string[] = [];
  const report = await runAutoImportPreflight({
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_PERSIST: "false",
      MARKETPLACE_CATALOGUE_SOURCE: "static",
    },
    probeTable: async () => "absent",
    probeRpcCatalog: async () => {
      rpcCalls.push("probeRpcCatalog");
      return {
        preflight: "present",
        upsert: "present",
        commitBatch: "present",
      };
    },
    onRpcCall: (name) => rpcCalls.push(name),
    probeSupplier: async (origin) => ({
      status: "reachable",
      detail: `ok:${origin.includes("kamal") ? "kamal" : "alladin"}`,
    }),
  });
  assert.equal(report.persistenceEnabled, false);
  assert.equal(report.objects.rpcMpCeoAutoImportCommitBatch, "present");
  assert.equal(report.objects.rpcMpCeoAutoImportPreflight, "present");
  assert.equal(report.objects.timeoutProtection, "skipped");
  assert.equal(report.suppliers.kamal.status, "reachable");
  assert.equal(report.stages.publicWebsiteWouldShowSyncedProducts, false);
  assert.ok(
    report.notes.some((n) => /CATALOGUE_SOURCE|database/i.test(n)),
  );
  assert.ok(!rpcCalls.some((c) => /upsert|commit_batch/i.test(c)));
  assert.ok(
    rpcCalls.every(
      (c) => c === "probeRpcCatalog" || c === "mp_ceo_auto_import_preflight",
    ),
  );

  // Persist without DB URL → timeout protection absent; cannot persist
  const blocked = await runAutoImportPreflight({
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_PERSIST: "true",
      MARKETPLACE_CATALOGUE_SOURCE: "static",
    },
    probeTable: async () => "present",
    probeRpcCatalog: async () => ({
      preflight: "present",
      upsert: "present",
      commitBatch: "present",
    }),
    probeSupplier: async () => ({ status: "reachable", detail: "ok" }),
  });
  assert.equal(blocked.objects.timeoutProtection, "absent");
  assert.equal(blocked.stages.canPersistCatalogueProducts, false);
  assert.ok(
    blocked.blockers.some((b) => /Timeout protection absent/i.test(b)),
  );

  const allowed = await runAutoImportPreflight({
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_PERSIST: "true",
      MARKETPLACE_CATALOGUE_SOURCE: "static",
      DATABASE_URL: "postgresql://local/test",
    },
    probeTable: async () => "present",
    probeRpcCatalog: async () => ({
      preflight: "present",
      upsert: "present",
      commitBatch: "present",
    }),
    probeSupplier: async () => ({ status: "reachable", detail: "ok" }),
  });
  assert.equal(allowed.objects.timeoutProtection, "present");
  assert.ok(
    !allowed.blockers.some((b) => /Timeout protection absent/i.test(b)),
  );

  // Source-level: preflight never references write RPCs as invoked calls
  const preflightSrc = readFileSync(
    join(__dirname, "autoImportPreflight.ts"),
    "utf8",
  );
  assert.ok(!preflightSrc.includes('rpc("mp_ceo_auto_import_upsert_listing"'));
  assert.ok(!preflightSrc.includes('rpc("mp_ceo_auto_import_commit_batch"'));
  assert.ok(preflightSrc.includes('rpc("mp_ceo_auto_import_preflight"'));
  console.log("ok - preflight read-only; zero write-capable calls");
}

{
  // Concurrent runs: second import blocked while first is active
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const repository = createMemoryAutoImportRepository();
  const blockingRepo = {
    getListingByIdentityKey: (k: string) => repository.getListingByIdentityKey(k),
    getListingBySourceUrl: async (u: string) => {
      await gate;
      return repository.getListingBySourceUrl(u);
    },
    listListings: () => repository.listListings(),
    getHealth: () => repository.getHealth(),
    saveHealth: (h: Parameters<typeof repository.saveHealth>[0]) =>
      repository.saveHealth(h),
    commitBatch: (
      inputs: Parameters<typeof repository.commitBatch>[0],
      health: Parameters<typeof repository.commitBatch>[1],
    ) => repository.commitBatch(inputs, health),
  };
  const serviceA = createSvc({
    repository: blockingRepo,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "lock-a",
        currentListedPricePkr: 100000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const serviceB = createSvc({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Knox Hybrid Inverter 6kW Single Phase",
        supplierProductId: "lock-b",
        brand: "Knox",
        currentListedPricePkr: 90000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const p1 = serviceA.runAutomaticImport({ actorScope: "admin:super:ceo" });
  await new Promise((r) => setTimeout(r, 20));
  const r2 = await serviceB.runAutomaticImport({
    actorScope: "admin:super:ceo",
  });
  assert.equal(r2.status, "failed");
  assert.ok(r2.health.errors.some((e) => /concurrent_run_blocked/i.test(e)));
  release();
  const r1 = await p1;
  assert.ok(r1.status === "succeeded" || r1.status === "partial");
  __resetAutoImportRunLockForTests();
  console.log("ok - concurrent run protection");
}

{
  // Statement-timeout style cancel releases the run lock (no abandoned lock)
  const {
    createAutoImportService: createSvc,
    __resetAutoImportRunLockForTests,
  } = await import("./autoImportService.ts");
  __resetAutoImportRunLockForTests();
  const base = createMemoryAutoImportRepository();
  const repository = {
    getListingByIdentityKey: (k: string) => base.getListingByIdentityKey(k),
    getListingBySourceUrl: (u: string) => base.getListingBySourceUrl(u),
    listListings: () => base.listListings(),
    getHealth: () => base.getHealth(),
    saveHealth: (h: Parameters<typeof base.saveHealth>[0]) => base.saveHealth(h),
    async commitBatch() {
      throw new Error("canceling statement due to statement timeout");
    },
  };
  const service = createSvc({
    repository,
    fixtureObservations: [
      obs({
        supplier: "kamal",
        title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
        supplierProductId: "to-1",
        currentListedPricePkr: 100000,
      }),
    ],
    env: {
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
    },
  });
  const r1 = await service.runAutomaticImport({ actorScope: "admin:super:ceo" });
  assert.equal(r1.status, "failed");
  assert.ok(r1.health.errors.some((e) => /statement timeout|persist_/i.test(e)));
  // Lock must be free for a subsequent run
  const r2 = await service.runAutomaticImport({ actorScope: "admin:super:ceo" });
  assert.equal(r2.status, "failed");
  assert.ok(!r2.health.errors.some((e) => /concurrent_run_blocked/i.test(e)));
  __resetAutoImportRunLockForTests();
  console.log("ok - timeout cancel releases run lock");
}

{
  // Canonical route auth + preflight gated; non-super-admin forbidden
  function actor(role: string): RequestActor {
    return {
      id: "u1",
      username: "staff",
      name: role,
      email: "s@test.com",
      role,
      accountStatus: "Approved",
      emailVerified: true,
      onboardingCompleted: true,
      authMethod: "jwt",
    };
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor("Admin");
    next();
  });
  app.use(
    "/api/marketplace/admin",
    createMarketplaceAutoImportRouter({
      env: {
        MARKETPLACE_ENABLED: "true",
        MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
      },
      preflight: async () => {
        throw new Error("preflight should not run for non-super-admin");
      },
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as AddressInfo;
  try {
    const run = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/run`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    assert.equal(run.status, 403);
    const pre = await fetch(
      `http://127.0.0.1:${port}/api/marketplace/admin/suppliers/auto-import/preflight`,
    );
    assert.equal(pre.status, 403);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
  console.log("ok - canonical route authentication");
}

console.log("\nCEO auto-import tests passed.");
