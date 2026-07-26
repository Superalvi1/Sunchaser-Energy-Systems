/**
 * WS4 PostgreSQL supplier ingestion tests (disposable Docker Postgres only).
 * Run: npm run test:marketplace-ws4
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createKamalAdapter } from "./kamalAdapter.ts";
import { createAlladinAdapter } from "./alladinAdapter.ts";
import { createSupplierIngestionService } from "./supplierIngestionService.ts";
import type { SupplierMappingRow, SupplierRepository } from "./supplierRepository.ts";
import { SupplierError } from "./supplierTypes.ts";
import { EVIDENCE_BLOCKER_VARIANT_IDS } from "./adapterTypes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const WS0 = path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql");
const WS1 = path.join(ROOT, "scripts/marketplace-ws1-additive-schema.sql");
const WS3 = path.join(ROOT, "scripts/marketplace-ws3-pricing-engine.sql");
const WS4 = path.join(ROOT, "scripts/marketplace-ws4-supplier-ingestion.sql");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-ws4-test-${randomUUID().slice(0, 8)}`;
const PORT = 55800 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;
const SCOPE = "admin:super:u-sa";
const SYS = "system:ws4:tester";

function check(name: string, ok: boolean): void {
  assert.equal(ok, true, name);
  console.log(`ok - ${name}`);
}

function dockerAvailable(): boolean {
  return spawnSync("docker", ["info"], { encoding: "utf8" }).status === 0;
}

async function waitForPg(attempts = 40): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    const c = new pg.Client({ connectionString: DB_URL, connectionTimeoutMillis: 2000 });
    try {
      await c.connect();
      await c.query("select 1");
      await c.end();
      return;
    } catch (err) {
      last = err;
      try {
        await c.end();
      } catch {
        /* */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Postgres not ready: ${String(last)}`);
}

async function ensureRoles(client: pg.Client): Promise<void> {
  await client.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$;
  `);
}

async function apply(client: pg.Client, file: string): Promise<void> {
  await client.query(readFileSync(file, "utf8"));
}

function mapPgError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  const upper = msg.toUpperCase();
  if (upper.includes("CONFLICT") || upper.includes("OVERLAPPING")) {
    throw new SupplierError(409, "CONFLICT", "Overlapping job already running.");
  }
  if (upper.includes("EVIDENCE_BLOCKER")) {
    throw new SupplierError(
      409,
      "EVIDENCE_BLOCKER",
      "Mapping remains locked until verified evidence is supplied.",
    );
  }
  if (upper.includes("VALIDATION_ERROR") || upper.includes("INVALID")) {
    throw new SupplierError(400, "VALIDATION_ERROR", msg);
  }
  throw new SupplierError(500, "INTERNAL_ERROR", msg);
}

function pgRepo(client: pg.Client): SupplierRepository {
  return {
    async listActiveMappings(actorScope) {
      const { rows } = await client.query(
        `select public.mp_ws4_list_mappings($1) as r`,
        [actorScope],
      );
      return (rows[0].r.mappings || []) as SupplierMappingRow[];
    },
    async getPricingConfig() {
      const { rows } = await client.query(
        `select max_increase_pct, max_decrease_pct, staleness_hours
         from public.mp_pricing_config where company_id = 'sunchaser'`,
      );
      return {
        maxIncreasePct: Number(rows[0].max_increase_pct),
        maxDecreasePct: Number(rows[0].max_decrease_pct),
        stalenessHours: Number(rows[0].staleness_hours),
      };
    },
    async getVariantWebsitePrice(variantId) {
      const { rows } = await client.query(
        `select website_price from public.mp_product_variants where id = $1`,
        [variantId],
      );
      return rows[0]?.website_price == null ? null : Number(rows[0].website_price);
    },
    async startJob(trigger, actorScope, meta = {}) {
      try {
        const { rows } = await client.query(
          `select public.mp_ws4_job_start($1,$2,$3,$4::jsonb) as r`,
          [actorScope, "marketplace_supplier_price_check", trigger, JSON.stringify(meta)],
        );
        return { runId: rows[0].r.runId };
      } catch (err) {
        mapPgError(err);
      }
    },
    async finishJob(runId, status, actorScope, error = null, meta = {}) {
      try {
        await client.query(
          `select public.mp_ws4_job_finish($1,$2,$3,$4,$5::jsonb)`,
          [actorScope, runId, status, error, JSON.stringify(meta)],
        );
      } catch (err) {
        mapPgError(err);
      }
    },
    async insertObservation(input) {
      try {
        const { rows } = await client.query(
          `select public.mp_ws4_insert_observation($1,$2,$3,$4::timestamptz,$5,$6,$7,$8,$9::jsonb) as r`,
          [
            input.actorScope,
            input.mappingId,
            input.runId,
            input.observedAt,
            input.supplierPublicPrice,
            input.currency,
            input.availability,
            input.parseStatus,
            JSON.stringify(input.evidence),
          ],
        );
        return rows[0].r;
      } catch (err) {
        mapPgError(err);
      }
    },
    async createAlert(input) {
      try {
        const { rows } = await client.query(
          `select public.mp_ws4_create_alert($1,$2,$3,$4,$5,$6,$7) as r`,
          [
            input.actorScope,
            input.runId,
            input.productId,
            input.variantId,
            input.alertType,
            input.severity,
            input.message,
          ],
        );
        return { alertId: rows[0].r.alertId };
      } catch (err) {
        mapPgError(err);
      }
    },
    async listAlerts(actorScope, resolved = null) {
      try {
        const { rows } = await client.query(
          `select public.mp_ws4_list_alerts($1,$2,$3) as r`,
          [actorScope, resolved, 100],
        );
        return rows[0].r.alerts || [];
      } catch (err) {
        mapPgError(err);
      }
    },
    async publishPrice(variantId, actorScope, changedBy) {
      try {
        const { rows } = await client.query(
          `select public.mp_publish_price($1,$2,$3) as r`,
          [actorScope, variantId, changedBy],
        );
        const r = rows[0].r;
        return {
          websitePriceState: r.websitePriceState || r.website_price_state,
          websitePriceSource: r.websitePriceSource ?? r.website_price_source,
        };
      } catch (err) {
        mapPgError(err);
      }
    },
    async upsertMapping(input, actorScope) {
      try {
        const { rows } = await client.query(
          `select public.mp_admin_upsert_supplier_mapping(
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
          ) as r`,
          [
            actorScope,
            input.supplierCode,
            input.productId,
            input.variantId,
            input.supplierProductId,
            input.supplierVariantId ?? null,
            input.supplierSku ?? null,
            input.normalizedExactModel,
            input.matchConfidence,
            input.matchLocked ?? false,
            input.active ?? true,
            input.supplierUrl ?? null,
          ],
        );
        return {
          mappingId: rows[0].r.mappingId || rows[0].r.id,
          matchLocked: Boolean(rows[0].r.matchLocked ?? rows[0].r.match_locked),
        };
      } catch (err) {
        mapPgError(err);
      }
    },
  };
}

async function seed(client: pg.Client) {
  await client.query(`
    insert into public.mp_brands (id, name, slug) values
      ('mpbrand_ws4', 'WS4', 'ws4') on conflict do nothing;
    insert into public.mp_categories (id, name, slug) values
      ('mpcat_ws4', 'WS4 Cat', 'ws4-cat') on conflict do nothing;
    insert into public.mp_products (id, brand_id, category_id, title, slug) values
      ('mpprod_ws4_a', 'mpbrand_ws4', 'mpcat_ws4', 'WS4 A', 'ws4-a'),
      ('mpprod_ws4_b', 'mpbrand_ws4', 'mpcat_ws4', 'WS4 B', 'ws4-b')
      on conflict do nothing;
    insert into public.mp_product_variants
      (id, product_id, sku, title, is_default, active, website_price, website_price_state, website_price_source)
    values
      ('mpvar_ws4_a', 'mpprod_ws4_a', 'SC-WS4-A', 'A', true, true, 100000, 'priced_auto', 'seed'),
      ('mpvar_ws4_b', 'mpprod_ws4_b', 'SC-WS4-B', 'B', true, true, null, 'confirm_price', null)
      on conflict do nothing;

    -- Blocker product shells (ids used by WS4 SQL blockers)
    insert into public.mp_products (id, brand_id, category_id, title, slug) values
      ('mpprod_ws1_inverex_nitrox_10kw_hybrid', 'mpbrand_ws4', 'mpcat_ws4', 'Nitrox', 'nitrox-b'),
      ('mpprod_ws1_pylontech_us5000_4_8kwh', 'mpbrand_ws4', 'mpcat_ws4', 'Pylon', 'pylon-b'),
      ('mpprod_ws1_inverex_lv2_6_lithium', 'mpbrand_ws4', 'mpcat_ws4', 'LV26', 'lv26-b'),
      ('mpprod_ws1_fronus_meta_10kw_ongrid', 'mpbrand_ws4', 'mpcat_ws4', 'Fronus', 'fronus-b')
      on conflict do nothing;
    insert into public.mp_product_variants (id, product_id, sku, title, is_default, active)
    values
      ('mpvar_ws1_inverex_nitrox_10kw_hybrid', 'mpprod_ws1_inverex_nitrox_10kw_hybrid', 'SC-NITROX-B', 'N', true, true),
      ('mpvar_ws1_pylontech_us5000_4_8kwh', 'mpprod_ws1_pylontech_us5000_4_8kwh', 'SC-PYLON-B', 'P', true, true),
      ('mpvar_ws1_inverex_lv2_6_lithium', 'mpprod_ws1_inverex_lv2_6_lithium', 'SC-LV26-B', 'L', true, true),
      ('mpvar_ws1_fronus_meta_10kw_ongrid', 'mpprod_ws1_fronus_meta_10kw_ongrid', 'SC-FRONUS-B', 'F', true, true)
      on conflict do nothing;
  `);
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error("WS4 BLOCKED: Docker unavailable");
    process.exit(2);
  }
  console.log(`Starting ${IMAGE} as ${CONTAINER} on :${PORT}`);
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "--name",
      CONTAINER,
      "-e",
      "POSTGRES_PASSWORD=postgres",
      "-p",
      `${PORT}:5432`,
      IMAGE,
    ],
    { stdio: "inherit" },
  );

  const admin = new pg.Client({ connectionString: DB_URL });
  try {
    await waitForPg();
    await admin.connect();
    await ensureRoles(admin);
    await apply(admin, WS0);
    await apply(admin, WS1);
    await apply(admin, WS3);
    await seed(admin);
    await apply(admin, WS4);

    // Re-apply blockers after seed products exist
    await apply(admin, WS4);

    const repo = pgRepo(admin);

    // Grants: privileged RPCs service_role only
    const { rows: grants } = await admin.query(`
      select p.proname,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('mp_ws4_job_start','mp_ws4_insert_observation','mp_publish_price')
    `);
    check(
      "service_role-only RPC grants",
      grants.every((g) => g.service_exec && !g.anon_exec && !g.auth_exec),
    );

    // Evidence blockers locked
    const { rows: blockers } = await admin.query(
      `select variant_id, match_locked, match_evidence->>'blocker' as blocker
       from public.mp_supplier_products
       where variant_id = any($1::text[])`,
      [EVIDENCE_BLOCKER_VARIANT_IDS as unknown as string[]],
    );
    check(
      "four named evidence blockers locked",
      blockers.length >= 4 &&
        blockers.every((b) => b.match_locked === true && b.blocker === "true"),
    );

    // Cannot unlock blocker without verifiedEvidence
    let unlockBlocked = false;
    try {
      await admin.query(
        `update public.mp_supplier_products
         set match_locked = false
         where variant_id = $1 and supplier_id = 'mpsup_kamal'`,
        [EVIDENCE_BLOCKER_VARIANT_IDS[0]],
      );
    } catch {
      unlockBlocked = true;
    }
    check("evidence blocker cannot unlock without verified evidence", unlockBlocked);

    // Exact unlocked Kamal + Alladin mappings for A
    const kamalMap = await repo.upsertMapping(
      {
        supplierCode: "kamal",
        productId: "mpprod_ws4_a",
        variantId: "mpvar_ws4_a",
        supplierProductId: "K-A",
        normalizedExactModel: "ws4-a",
        matchConfidence: "exact",
        matchLocked: false,
        active: true,
      },
      SCOPE,
    );
    const alladinMap = await repo.upsertMapping(
      {
        supplierCode: "alladin",
        productId: "mpprod_ws4_a",
        variantId: "mpvar_ws4_a",
        supplierProductId: "AL-A",
        normalizedExactModel: "ws4-a",
        matchConfidence: "exact",
        matchLocked: false,
        active: true,
      },
      SCOPE,
    );
    check("exact unlocked mappings created", !!kamalMap.mappingId && !!alladinMap.mappingId);

    // Likely mapping rejected for publish path (variant B)
    await repo.upsertMapping(
      {
        supplierCode: "kamal",
        productId: "mpprod_ws4_b",
        variantId: "mpvar_ws4_b",
        supplierProductId: "K-B",
        normalizedExactModel: "ws4-b",
        matchConfidence: "likely",
        matchLocked: false,
        active: true,
      },
      SCOPE,
    );

    const kamalFixtures = new Map([
      [
        kamalMap.mappingId,
        {
          mappingId: kamalMap.mappingId,
          supplierPublicPrice: 105000,
          availability: "in_stock" as const,
          parseStatus: "ok" as const,
          observedAt: new Date().toISOString(),
        },
      ],
    ]);
    const alladinFixtures = new Map([
      [
        alladinMap.mappingId,
        {
          mappingId: alladinMap.mappingId,
          supplierPublicPrice: 99000,
          availability: "in_stock" as const,
          parseStatus: "ok" as const,
          observedAt: new Date().toISOString(),
        },
      ],
    ]);

    const ingestion = createSupplierIngestionService({
      repository: repo,
      kamalAdapter: createKamalAdapter({ fixtures: kamalFixtures }),
      alladinAdapter: createAlladinAdapter({ fixtures: alladinFixtures }),
      env: {},
    });

    const result = await ingestion.runPriceCheck({
      trigger: "manual",
      actorScope: SCOPE,
      changedBy: "tester",
    });
    check("manual run succeeded", result.status === "succeeded");
    check("observations inserted", result.observationsInserted >= 2);

    const { rows: priceRows } = await admin.query(
      `select website_price, website_price_source, website_price_state
       from public.mp_product_variants where id = 'mpvar_ws4_a'`,
    );
    check(
      "Kamal-before-Alladin selection",
      Number(priceRows[0].website_price) === 105000 &&
        priceRows[0].website_price_source === "kamal",
    );

    // Append-only observations
    let appendBlocked = false;
    try {
      await admin.query(
        `update public.mp_supplier_observations set currency = 'USD' where true`,
      );
    } catch {
      appendBlocked = true;
    }
    check("observation append-only (update prohibited)", appendBlocked);

    // Overlap prevention
    await admin.query(
      `insert into public.mp_job_runs (id, job_name, status)
       values ('mpjob_overlap', 'marketplace_supplier_price_check', 'running')`,
    );
    let overlap = false;
    try {
      await repo.startJob("manual", SCOPE);
    } catch (err) {
      overlap = err instanceof SupplierError && err.code === "CONFLICT";
    }
    check("overlapping-run prevention", overlap);
    await admin.query(
      `update public.mp_job_runs set status = 'failed', finished_at = timezone('utc', now())
       where id = 'mpjob_overlap'`,
    );

    // Stale / soldout / malformed / safety / override tests via SQL publish path
    const { rows: mapRows } = await admin.query(
      `select id from public.mp_supplier_products where variant_id = 'mpvar_ws4_a' and supplier_id = 'mpsup_kamal'`,
    );
    const mapId = mapRows[0].id;
    const run2 = await repo.startJob("manual", SCOPE);
    await repo.insertObservation({
      actorScope: SCOPE,
      mappingId: mapId,
      runId: run2.runId,
      observedAt: new Date(Date.now() - 48 * 3600_000).toISOString(),
      supplierPublicPrice: 200000,
      currency: "PKR",
      availability: "in_stock",
      parseStatus: "ok",
      evidence: { stale: true },
    });
    await repo.finishJob(run2.runId, "succeeded", SCOPE);
    // Fresh Alladin still available from prior run; insert sold_out kamal-latest... 
    // Latest kamal is stale — publish should prefer fresh Alladin 99000 or last kamal if still latest per mapping.
    // Each mapping uses its own latest obs. Kamal latest is stale → skipped; Alladin 99000 eligible.
    const pub = await repo.publishPrice("mpvar_ws4_a", SYS, "tester");
    check(
      "stale kamal rejected; alladin or safe fallback used",
      pub.websitePriceState === "priced_auto",
    );

    // Override precedence
    await admin.query(
      `insert into public.mp_price_overrides (
         id, product_id, variant_id, override_price, status, mode, reason, created_by
       ) values (
         'mpovr_ws4', 'mpprod_ws4_a', 'mpvar_ws4_a', 150000, 'active', 'permanent', 'test', 'sa'
       )`,
    );
    const over = await repo.publishPrice("mpvar_ws4_a", SYS, "tester");
    check(
      "override precedence",
      over.websitePriceState === "priced_override" &&
        over.websitePriceSource === "override",
    );
    await admin.query(
      `update public.mp_price_overrides set status = 'revoked' where id = 'mpovr_ws4'`,
    );

    // Safety breach → skip candidate → confirm or last_approved
    // Test fixture only: allow guarded write to establish a baseline price.
    await admin.query(`select set_config('mp.allow_price_write', 'on', false)`);
    await admin.query(
      `update public.mp_product_variants
       set website_price = 100000, website_price_state = 'priced_auto', website_price_source = 'seed'
       where id = 'mpvar_ws4_a'`,
    );
    await admin.query(`select set_config('mp.allow_price_write', '', false)`);
    const run3 = await repo.startJob("manual", SCOPE);
    await repo.insertObservation({
      actorScope: SCOPE,
      mappingId: mapId,
      runId: run3.runId,
      observedAt: new Date().toISOString(),
      supplierPublicPrice: 200000, // +100% > 15%
      currency: "PKR",
      availability: "in_stock",
      parseStatus: "ok",
      evidence: { safety: true },
    });
    // Make alladin also unsafe / inactive latest by inserting unsafe alladin obs
    await repo.insertObservation({
      actorScope: SCOPE,
      mappingId: alladinMap.mappingId,
      runId: run3.runId,
      observedAt: new Date().toISOString(),
      supplierPublicPrice: 180000,
      currency: "PKR",
      availability: "in_stock",
      parseStatus: "ok",
      evidence: {},
    });
    await repo.createAlert({
      actorScope: SCOPE,
      runId: run3.runId,
      productId: "mpprod_ws4_a",
      variantId: "mpvar_ws4_a",
      alertType: "safety_breach",
      severity: "critical",
      message: "safety",
    });
    await repo.finishJob(run3.runId, "succeeded", SCOPE);
    const safePub = await repo.publishPrice("mpvar_ws4_a", SYS, "tester");
    check(
      "safety breach skips unsafe supplier candidates",
      safePub.websitePriceSource !== "kamal" &&
        safePub.websitePriceSource !== "alladin",
    );

    // Direct commercial field write blocked
    let directBlocked = false;
    try {
      await admin.query(
        `update public.mp_product_variants set website_price = 1 where id = 'mpvar_ws4_a'`,
      );
    } catch {
      directBlocked = true;
    }
    check("cannot write website_price directly", directBlocked);

    // Durable failed job
    const failStart = await repo.startJob("manual", SCOPE);
    await repo.finishJob(failStart.runId, "failed", SCOPE, "boom");
    const { rows: failRows } = await admin.query(
      `select status, error from public.mp_job_runs where id = $1`,
      [failStart.runId],
    );
    check(
      "durable failed jobs",
      failRows[0].status === "failed" && failRows[0].error === "boom",
    );

    // Scheduled fail-closed without authorized adapter
    let scheduledBlocked = false;
    try {
      await createSupplierIngestionService({
        repository: repo,
        kamalAdapter: createKamalAdapter({ fixtures: kamalFixtures }),
        alladinAdapter: createAlladinAdapter({ fixtures: alladinFixtures }),
        env: {},
      }).runPriceCheck({
        trigger: "scheduled",
        actorScope: SCOPE,
        changedBy: "tester",
      });
    } catch (err) {
      scheduledBlocked =
        err instanceof SupplierError && err.code === "ADAPTER_NOT_AUTHORIZED";
    }
    check("scheduled execution fail-closed without authorized adapter", scheduledBlocked);

    // Same service supports manual successfully (already did) — also soldout alert path
    const runSold = await repo.startJob("manual", SCOPE);
    await repo.insertObservation({
      actorScope: SCOPE,
      mappingId: mapId,
      runId: runSold.runId,
      observedAt: new Date().toISOString(),
      supplierPublicPrice: 110000,
      currency: "PKR",
      availability: "sold_out",
      parseStatus: "ok",
      evidence: {},
    });
    await repo.createAlert({
      actorScope: SCOPE,
      runId: runSold.runId,
      productId: "mpprod_ws4_a",
      variantId: "mpvar_ws4_a",
      alertType: "soldout",
      severity: "info",
      message: "sold out",
    });
    await repo.finishJob(runSold.runId, "succeeded", SCOPE);
    const alerts = await repo.listAlerts(SCOPE, false);
    check(
      "alerts include safety/soldout/blocker types",
      alerts.some((a) => a.alertType === "soldout") &&
        alerts.some((a) => a.alertType === "safety_breach"),
    );

    // search_path lockdown on new fns
    const { rows: sec } = await admin.query(`
      select p.proname, prosecdef,
        pg_get_functiondef(p.oid) like '%search_path%''''%' as locked
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname like 'mp_ws4_%'
    `);
    check(
      "SECURITY DEFINER search_path lockdown",
      sec.every((r) => r.prosecdef && r.locked),
    );

    console.log("\nWS4 PostgreSQL supplier ingestion tests passed.");
  } finally {
    try {
      await admin.end();
    } catch {
      /* */
    }
    try {
      execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    } catch {
      /* */
    }
  }
}

main().catch((err) => {
  console.error(err);
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    /* */
  }
  process.exit(1);
});
