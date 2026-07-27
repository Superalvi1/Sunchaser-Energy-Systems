/**
 * CEO auto-import privilege matrix — disposable Docker Postgres only.
 * Proves PostgREST roles cannot write; dedicated runtime role can commit_batch.
 *
 * Run: npm run test:marketplace-ceo-auto-import-privileges
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
const CONTAINER = `mp-ceo-ai-priv-${randomUUID().slice(0, 8)}`;
const PORT = 56000 + Math.floor(Math.random() * 200);
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`;
const RUNTIME_USER = "mp_ceo_auto_import_app";
const RUNTIME_PASS = "runtime_test_pw";
const RUNTIME_URL = `postgresql://${RUNTIME_USER}:${RUNTIME_PASS}@127.0.0.1:${PORT}/postgres`;

const UPSERT_SIG =
  "public.mp_ceo_auto_import_upsert_listing(text, text, text, text, text, numeric, text, text, jsonb, text, text, jsonb, timestamptz)";
const BATCH_SIG =
  "public.mp_ceo_auto_import_commit_batch(text, text, jsonb, jsonb)";

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

async function provisionRuntimeLogin(admin: pg.Client): Promise<void> {
  await admin.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${RUNTIME_USER}') then
        create role ${RUNTIME_USER} login password '${RUNTIME_PASS}'
          nosuperuser nocreatedb nocreaterole nobypassrls;
      end if;
    end $$;
    grant usage on schema public to ${RUNTIME_USER};
    grant mp_ceo_auto_import_runtime to ${RUNTIME_USER};
  `);
}

function isPermissionDenied(err: unknown): boolean {
  const msg = String((err as Error)?.message || err);
  return /permission denied|must be owner/i.test(msg);
}

async function asRole<T>(
  admin: pg.Client,
  role: string,
  fn: () => Promise<T>,
): Promise<T> {
  await admin.query(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await admin.query("reset role");
  }
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
    note: "pg-privileges-test",
  };
}

async function main(): Promise<void> {
  if (!dockerAvailable()) {
    console.error("CEO auto-import privileges test BLOCKED: Docker unavailable");
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
    await provisionRuntimeLogin(admin);

    // --- Catalog checks ---
    const runtimeExists = await admin.query(
      `select 1 from pg_roles where rolname = 'mp_ceo_auto_import_runtime'`,
    );
    check("mp_ceo_auto_import_runtime role exists", (runtimeExists.rowCount ?? 0) === 1);

    const grantRows = await admin.query(
      `select
         has_function_privilege('service_role', $1, 'EXECUTE') as service_batch,
         has_function_privilege('service_role', $2, 'EXECUTE') as service_preflight,
         has_function_privilege('service_role', $3, 'EXECUTE') as service_upsert,
         has_function_privilege('mp_ceo_auto_import_runtime', $1, 'EXECUTE') as runtime_batch,
         has_function_privilege('anon', $1, 'EXECUTE') as anon_batch,
         has_function_privilege('authenticated', $1, 'EXECUTE') as auth_batch
      `,
      [
        "public.mp_ceo_auto_import_commit_batch(text,text,jsonb,jsonb)",
        "public.mp_ceo_auto_import_preflight()",
        "public.mp_ceo_auto_import_upsert_listing(text,text,text,text,text,numeric,text,text,jsonb,text,text,jsonb,timestamptz)",
      ],
    );
    const g = grantRows.rows[0];
    check("has_function_privilege: service_role cannot commit_batch", g.service_batch === false);
    check("has_function_privilege: service_role can preflight", g.service_preflight === true);
    check("has_function_privilege: service_role cannot upsert", g.service_upsert === false);
    check("has_function_privilege: runtime can commit_batch", g.runtime_batch === true);
    check("has_function_privilege: anon cannot commit_batch", g.anon_batch === false);
    check("has_function_privilege: authenticated cannot commit_batch", g.auth_batch === false);

    // --- service_role: preflight OK ---
    const preflightOk = await asRole(admin, "service_role", async () => {
      const r = await admin.query(`select public.mp_ceo_auto_import_preflight() as j`);
      return r.rows[0]?.j;
    });
    check(
      "service_role can execute preflight",
      preflightOk && preflightOk.readOnly === true,
    );

    // --- service_role: upsert denied ---
    let upsertDenied = false;
    try {
      await asRole(admin, "service_role", async () => {
        await admin.query(`
          select public.mp_ceo_auto_import_upsert_listing(
            'system:ceo-auto-import', 'k', 't', 'b', 'c', 1, 'in_stock', 'kamal',
            '[]'::jsonb, 'm', 'p', '[]'::jsonb, now()
          )
        `);
      });
    } catch (err) {
      upsertDenied = isPermissionDenied(err);
    }
    check("service_role cannot execute legacy upsert", upsertDenied);

    // --- service_role: commit_batch denied (PostgREST-equivalent) ---
    let batchDenied = false;
    try {
      await asRole(admin, "service_role", async () => {
        await admin.query(
          `select public.mp_ceo_auto_import_commit_batch($1,$2,$3::jsonb,$4::jsonb)`,
          [
            "system:ceo-auto-import",
            `mpair_deny_${randomUUID().slice(0, 8)}`,
            "[]",
            JSON.stringify(health("x")),
          ],
        );
      });
    } catch (err) {
      batchDenied = isPermissionDenied(err);
    }
    check("service_role cannot execute commit_batch", batchDenied);

    // --- anon / authenticated cannot execute write functions ---
    for (const role of ["anon", "authenticated"] as const) {
      let upsertFail = false;
      let batchFail = false;
      let preflightFail = false;
      try {
        await asRole(admin, role, async () => {
          await admin.query(`
            select public.mp_ceo_auto_import_upsert_listing(
              'system:x', 'k', 't', 'b', 'c', 1, 'in_stock', 'kamal',
              '[]'::jsonb, 'm', 'p', '[]'::jsonb, now()
            )
          `);
        });
      } catch (err) {
        upsertFail = isPermissionDenied(err);
      }
      try {
        await asRole(admin, role, async () => {
          await admin.query(
            `select public.mp_ceo_auto_import_commit_batch($1,$2,$3::jsonb,$4::jsonb)`,
            ["system:x", "mpair_x", "[]", "{}"],
          );
        });
      } catch (err) {
        batchFail = isPermissionDenied(err);
      }
      try {
        await asRole(admin, role, async () => {
          await admin.query(`select public.mp_ceo_auto_import_preflight()`);
        });
      } catch (err) {
        preflightFail = isPermissionDenied(err);
      }
      check(`${role} cannot execute upsert`, upsertFail);
      check(`${role} cannot execute commit_batch`, batchFail);
      check(`${role} cannot execute preflight`, preflightFail);
    }

    // --- approved direct runtime login can execute commit_batch ---
    const seed = await commitBatchWithStatementTimeout({
      env: { MARKETPLACE_CEO_AUTO_IMPORT_DATABASE_URL: RUNTIME_URL },
      listings: [
        {
          identityKey: "exact:priv:seed:1",
          title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
          brandName: "Inverex",
          categoryName: "Solar Inverter",
          websitePricePkr: 111000,
          availability: "in_stock",
          selectedSupplier: "kamal",
          sourceUrls: ["https://kamalsolar.pk/products/priv-seed"],
          matchReason: "exact_identity",
          priceReason: "auto",
          fetchedAt: new Date().toISOString(),
          offers: [],
          previous: null,
        },
      ],
      health: health(`mpair_priv_${randomUUID().slice(0, 8)}`),
      statementTimeoutMs: 30_000,
    });
    check("approved runtime role can execute commit_batch", seed.productsCreated === 1);

    // Confirm session user was not service_role
    const who = new pg.Client({ connectionString: RUNTIME_URL });
    await who.connect();
    try {
      const cur = await who.query("select current_user as u");
      check(
        "runtime login is dedicated app role",
        cur.rows[0].u === RUNTIME_USER,
      );
    } finally {
      await who.end();
    }

    // --- duplicate identityKey rejected (no misleading counts) ---
    let dupRejected = false;
    try {
      await commitBatchWithStatementTimeout({
        env: { MARKETPLACE_CEO_AUTO_IMPORT_DATABASE_URL: RUNTIME_URL },
        listings: [
          {
            identityKey: "exact:dup:key",
            title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
            brandName: "Inverex",
            categoryName: "Solar Inverter",
            websitePricePkr: 100000,
            availability: "in_stock",
            selectedSupplier: "kamal",
            sourceUrls: ["https://kamalsolar.pk/products/dup-a"],
            matchReason: "exact_identity",
            priceReason: "auto",
            fetchedAt: new Date().toISOString(),
            offers: [],
            previous: null,
          },
          {
            identityKey: "exact:dup:key",
            title: "Inverex Nitrox 10kW Hybrid Solar Inverter",
            brandName: "Inverex",
            categoryName: "Solar Inverter",
            websitePricePkr: 120000,
            availability: "in_stock",
            selectedSupplier: "alladin",
            sourceUrls: ["https://alladin.pk/products/dup-b"],
            matchReason: "exact_identity",
            priceReason: "auto",
            fetchedAt: new Date().toISOString(),
            offers: [],
            previous: null,
          },
        ],
        health: health(`mpair_dup_${randomUUID().slice(0, 8)}`),
        statementTimeoutMs: 30_000,
      });
    } catch (err) {
      dupRejected = /duplicate identityKey/i.test(String((err as Error).message));
    }
    check("duplicate identityKey in batch is rejected", dupRejected);

    const dupRows = await admin.query(
      `select count(*)::int as n from public.mp_auto_import_listings where identity_key = $1`,
      ["exact:dup:key"],
    );
    check("duplicate batch left no listing rows", Number(dupRows.rows[0].n) === 0);

    // Source honesty
    const atomic = readFileSync(ATOMIC, "utf8");
    const ceo = readFileSync(CEO, "utf8");
    check(
      "atomic SQL grants commit_batch only to runtime role",
      /grant execute on function public\.mp_ceo_auto_import_commit_batch[\s\S]*to mp_ceo_auto_import_runtime/i.test(
        atomic,
      ),
    );
    check(
      "atomic SQL revokes commit_batch from service_role",
      /revoke all on function public\.mp_ceo_auto_import_commit_batch\(text, text, jsonb, jsonb\) from service_role/i.test(
        atomic,
      ),
    );
    check(
      "ceo SQL revokes upsert from service_role (no grant)",
      /revoke all on function public\.mp_ceo_auto_import_upsert_listing[\s\S]*from service_role/i.test(
        ceo,
      ) &&
        !/grant execute on function public\.mp_ceo_auto_import_upsert_listing[\s\S]*to service_role/i.test(
          ceo,
        ),
    );
    void UPSERT_SIG;
    void BATCH_SIG;

    console.log("\nCEO auto-import privilege tests passed.");
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
