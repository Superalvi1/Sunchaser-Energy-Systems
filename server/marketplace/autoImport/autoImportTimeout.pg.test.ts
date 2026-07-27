/**
 * CEO auto-import atomic timeout — disposable Docker Postgres only.
 * Proves SET LOCAL statement_timeout cancels commit_batch and rolls back writes.
 *
 * Run: npm run test:marketplace-ceo-auto-import-pg
 * Does NOT apply SQL to any hosted database.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { commitBatchWithStatementTimeout } from "./autoImportPgCommit.ts";
import type { AutoImportSyncHealth } from "./autoImportTypes.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const WS0 = path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql");
const WS1 = path.join(ROOT, "scripts/marketplace-ws1-additive-schema.sql");
const CEO = path.join(ROOT, "scripts/marketplace-ceo-auto-import.sql");
const ATOMIC = path.join(ROOT, "scripts/marketplace-ceo-auto-import-atomic.sql");
const IMAGE = "postgres:16-alpine";
const CONTAINER = `mp-ceo-ai-timeout-${randomUUID().slice(0, 8)}`;
const PORT = 55900 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;

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
    const c = new pg.Client({
      connectionString: DB_URL,
      connectionTimeoutMillis: 2000,
    });
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

function health(runId: string): AutoImportSyncHealth {
  return {
    lastSyncAt: new Date().toISOString(),
    lastSyncStatus: "succeeded",
    lastRunId: runId,
    kamalDiscovered: 1,
    alladinDiscovered: 0,
    acceptedVariants: 1,
    rejectedVariants: 0,
    exactMatches: 0,
    conflictKeptSeparate: 0,
    productsCreated: 0,
    productsUpdated: 0,
    lowestPriceSelections: 1,
    rolledBackPrices: 0,
    errors: [],
    note: "pg-timeout-test",
  };
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error("CEO auto-import PG timeout test BLOCKED: Docker unavailable");
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
    await apply(admin, CEO);
    await apply(admin, ATOMIC);

    // Evidence: in-function set_config does NOT cancel (control).
    await admin.query(`
      create or replace function public._timeout_control_setconfig()
      returns text language plpgsql as $$
      begin
        perform set_config('statement_timeout', '300', true);
        perform pg_sleep(2);
        return 'completed';
      end;
      $$;
    `);
    const tCtrl = Date.now();
    const ctrl = await admin.query(`select public._timeout_control_setconfig() as r`);
    check(
      "control: in-function set_config does not cancel (~2s completes)",
      Date.now() - tCtrl >= 1500 && ctrl.rows[0].r === "completed",
    );

    // Evidence: SET LOCAL before statement DOES cancel.
    await admin.query("begin");
    await admin.query("set local statement_timeout = '300'");
    let cancelled = false;
    const tSet = Date.now();
    try {
      await admin.query("select pg_sleep(5)");
      await admin.query("commit");
    } catch (err) {
      cancelled = /statement timeout/i.test(String((err as Error).message));
      await admin.query("rollback");
    }
    check(
      "SET LOCAL before statement cancels within ~1s",
      cancelled && Date.now() - tSet < 2000,
    );

    // Seed pre-existing listing via a fast commit_batch.
    const seedKey = "exact:inverex:nitrox:10kw:hybrid";
    const seedListing = {
      identityKey: seedKey,
      title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
      brandName: "Inverex",
      categoryName: "Solar Inverter",
      websitePricePkr: 200000,
      availability: "in_stock" as const,
      selectedSupplier: "kamal" as const,
      sourceUrls: ["https://kamalsolar.pk/products/nitrox-seed"],
      matchReason: "exact_identity",
      priceReason: "auto",
      fetchedAt: new Date().toISOString(),
      offers: [],
      previous: null,
    };
    const seed = await commitBatchWithStatementTimeout({
      env: { DATABASE_URL: DB_URL },
      listings: [seedListing],
      health: health(`mpair_seed_${randomUUID().slice(0, 8)}`),
      statementTimeoutMs: 30_000,
    });
    check("seed commit succeeded", seed.productsCreated === 1);

    const before = await admin.query(
      `select website_price, last_valid_price, title
       from public.mp_auto_import_listings where identity_key = $1`,
      [seedKey],
    );
    check("pre-existing row present", before.rowCount === 1);
    const prePrice = Number(before.rows[0].website_price);
    const preValid = Number(before.rows[0].last_valid_price);
    check("pre-existing price is 200000", prePrice === 200000);

    const productCountBefore = Number(
      (await admin.query(`select count(*)::int as n from public.mp_products`)).rows[0]
        .n,
    );
    const variantCountBefore = Number(
      (await admin.query(`select count(*)::int as n from public.mp_product_variants`))
        .rows[0].n,
    );
    const listingCountBefore = Number(
      (await admin.query(`select count(*)::int as n from public.mp_auto_import_listings`))
        .rows[0].n,
    );

    // Slow down the real commit_batch writes with a trigger sleep.
    await admin.query(`
      create or replace function public._mp_ai_sleep_on_listing_write()
      returns trigger language plpgsql as $$
      begin
        perform pg_sleep(5);
        return new;
      end;
      $$;
      drop trigger if exists trg_mp_ai_sleep_listing on public.mp_auto_import_listings;
      create trigger trg_mp_ai_sleep_listing
        before insert or update on public.mp_auto_import_listings
        for each row execute function public._mp_ai_sleep_on_listing_write();
    `);

    const newKey = "exact:knox:hybrid:6kw:single";
    let timedOut = false;
    const tBatch = Date.now();
    try {
      await commitBatchWithStatementTimeout({
        env: { DATABASE_URL: DB_URL },
        listings: [
          {
            ...seedListing,
            websitePricePkr: 210000,
            sourceUrls: ["https://kamalsolar.pk/products/nitrox-seed"],
          },
          {
            identityKey: newKey,
            title: "Knox Hybrid Inverter 6kW Single Phase",
            brandName: "Knox",
            categoryName: "Solar Inverter",
            websitePricePkr: 150000,
            availability: "in_stock",
            selectedSupplier: "kamal",
            sourceUrls: ["https://kamalsolar.pk/products/knox-new"],
            matchReason: "exact_identity",
            priceReason: "auto",
            fetchedAt: new Date().toISOString(),
            offers: [],
            previous: null,
          },
        ],
        health: health(`mpair_slow_${randomUUID().slice(0, 8)}`),
        statementTimeoutMs: 400,
      });
    } catch (err) {
      timedOut = /statement timeout/i.test(String((err as Error).message));
    }
    const elapsed = Date.now() - tBatch;
    check("slow commit_batch cancelled by SET LOCAL statement_timeout", timedOut);
    check("cancellation returned in under 3s", elapsed < 3000);

    const after = await admin.query(
      `select website_price, last_valid_price
       from public.mp_auto_import_listings where identity_key = $1`,
      [seedKey],
    );
    check(
      "pre-existing website_price unchanged after timeout",
      Number(after.rows[0].website_price) === prePrice,
    );
    check(
      "pre-existing last_valid_price unchanged after timeout",
      Number(after.rows[0].last_valid_price) === preValid,
    );

    const newRow = await admin.query(
      `select 1 from public.mp_auto_import_listings where identity_key = $1`,
      [newKey],
    );
    check("new listing not retained after timeout rollback", newRow.rowCount === 0);

    const productCountAfter = Number(
      (await admin.query(`select count(*)::int as n from public.mp_products`)).rows[0]
        .n,
    );
    const variantCountAfter = Number(
      (await admin.query(`select count(*)::int as n from public.mp_product_variants`))
        .rows[0].n,
    );
    const listingCountAfter = Number(
      (await admin.query(`select count(*)::int as n from public.mp_auto_import_listings`))
        .rows[0].n,
    );
    check("mp_products count unchanged after timeout", productCountAfter === productCountBefore);
    check(
      "mp_product_variants count unchanged after timeout",
      variantCountAfter === variantCountBefore,
    );
    check(
      "mp_auto_import_listings count unchanged after timeout",
      listingCountAfter === listingCountBefore,
    );

    // Drop slow trigger; prove a normal timed commit still works afterward.
    await admin.query(`
      drop trigger if exists trg_mp_ai_sleep_listing on public.mp_auto_import_listings;
    `);
    const ok = await commitBatchWithStatementTimeout({
      env: { DATABASE_URL: DB_URL },
      listings: [
        {
          ...seedListing,
          websitePricePkr: 205000,
        },
      ],
      health: health(`mpair_ok_${randomUUID().slice(0, 8)}`),
      statementTimeoutMs: 30_000,
    });
    check("post-timeout commit succeeds", ok.productsUpdated === 1);

    // Source/SQL honesty checks
    const atomic = readFileSync(ATOMIC, "utf8");
    check(
      "atomic SQL documents SET LOCAL caller pattern",
      atomic.includes("SET LOCAL statement_timeout"),
    );
    check(
      "atomic SQL does not perform set_config(statement_timeout)",
      !/perform\s+set_config\(\s*'statement_timeout'/i.test(atomic),
    );

    console.log("\nCEO auto-import PG timeout tests passed.");
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
