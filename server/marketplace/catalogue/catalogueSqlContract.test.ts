/**
 * WS1 public catalogue RPC contract — static SQL + wiring tests (no Docker).
 * Verifies the migration file and repository wiring without executing SQL:
 * v2 RPC naming, v1 untouched, RPC-only repository, privileges, fail-closed
 * gate column, transactional migration, RLS audit, media/price/scope defences,
 * and absence of activation DML.
 *
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/catalogue/catalogueSqlContract.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");

const SQL = readFileSync(
  path.join(ROOT, "scripts/marketplace-ws1-public-rpc-contract.sql"),
  "utf8",
);
const REPO = readFileSync(
  path.join(__dirname, "catalogueRepository.ts"),
  "utf8",
);
const ROUTES = readFileSync(
  path.join(__dirname, "catalogueRoutes.ts"),
  "utf8",
);
const WS0 = readFileSync(
  path.join(ROOT, "scripts/marketplace-ws0-foundation-schema.sql"),
  "utf8",
);
const WS1_ADDITIVE = readFileSync(
  path.join(ROOT, "scripts/marketplace-ws1-additive-schema.sql"),
  "utf8",
);

const SCRIPTS_DIR = path.join(ROOT, "scripts");
const ALL_SQL = readdirSync(SCRIPTS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(path.join(SCRIPTS_DIR, f), "utf8"))
  .join("\n");

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Strip SQL line comments so only executable statements are inspected. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

function firstNonEmptyExecutable(sql: string): string {
  return (
    stripComments(sql)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ""
  );
}

function lastNonEmptyExecutable(sql: string): string {
  const lines = stripComments(sql)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines[lines.length - 1] ?? "";
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------
  // v2 RPC names are defined
  // ---------------------------------------------------------------------------
  check(
    "SQL defines mp_public_catalogue_list_v2",
    /create or replace function public\.mp_public_catalogue_list_v2\(/.test(SQL),
  );
  check(
    "SQL defines mp_public_catalogue_get_by_slug_v2",
    /create or replace function public\.mp_public_catalogue_get_by_slug_v2\(/.test(SQL),
  );
  check(
    "SQL defines mp_public_catalogue_categories_v2",
    /create or replace function public\.mp_public_catalogue_categories_v2\(\)/.test(SQL),
  );
  check(
    "SQL defines mp_public_catalogue_brands_v2",
    /create or replace function public\.mp_public_catalogue_brands_v2\(\)/.test(SQL),
  );

  // ---------------------------------------------------------------------------
  // Existing v1 RPC is not dropped or replaced by this migration
  // ---------------------------------------------------------------------------
  check(
    "v1 mp_public_catalogue_list is not created or replaced",
    !/create or replace function public\.mp_public_catalogue_list\s*\(/.test(SQL),
  );
  check(
    "v1 mp_public_catalogue_get_by_slug is not created or replaced",
    !/create or replace function public\.mp_public_catalogue_get_by_slug\s*\(/.test(SQL),
  );
  check(
    "migration contains no drop function statements",
    !/drop\s+function/i.test(SQL),
  );

  // ---------------------------------------------------------------------------
  // Repository wiring: all four public endpoints use only v2 RPCs
  // ---------------------------------------------------------------------------
  check(
    "repository calls mp_public_catalogue_list_v2",
    REPO.includes("mp_public_catalogue_list_v2"),
  );
  check(
    "repository calls mp_public_catalogue_get_by_slug_v2",
    REPO.includes("mp_public_catalogue_get_by_slug_v2"),
  );
  check(
    "repository calls mp_public_catalogue_categories_v2",
    REPO.includes("mp_public_catalogue_categories_v2"),
  );
  check(
    "repository calls mp_public_catalogue_brands_v2",
    REPO.includes("mp_public_catalogue_brands_v2"),
  );
  check(
    "repository has no direct mp_* table reads",
    !/\.from\(/.test(REPO),
  );
  check(
    "repository has at least four supabase.rpc call sites",
    (REPO.match(/supabase\s*\.\s*rpc\(/g) ?? []).length >= 4,
  );
  check(
    "routes expose all four repository-backed endpoints",
    ROUTES.includes("listCategories()") &&
      ROUTES.includes("listBrands()") &&
      ROUTES.includes("listProducts(") &&
      ROUTES.includes("getProductBySlug("),
  );

  // ---------------------------------------------------------------------------
  // Privileges: definer, empty search_path, revokes, explicit grants
  // ---------------------------------------------------------------------------
  check(
    "all four v2 functions are security definer",
    count(SQL.toLowerCase(), "security definer") >= 4,
  );
  check(
    "all four v2 functions set search_path = ''",
    count(SQL, "set search_path = ''") >= 4,
  );
  for (const fn of [
    "mp_public_catalogue_list_v2(",
    "mp_public_catalogue_get_by_slug_v2(",
    "mp_public_catalogue_categories_v2()",
    "mp_public_catalogue_brands_v2()",
  ]) {
    check(
      `revoke from public present for ${fn}`,
      SQL.includes(`revoke all on function public.${fn}`),
    );
    check(
      `grant execute present for ${fn}`,
      SQL.includes(`grant execute on function public.${fn}`),
    );
  }
  check("explicit execute grants to anon (4)", count(SQL, ") to anon;") >= 4);
  check(
    "explicit execute grants to authenticated (4)",
    count(SQL, ") to authenticated;") >= 4,
  );
  check(
    "explicit execute grants to service_role (4)",
    count(SQL, ") to service_role;") >= 4,
  );

  // ---------------------------------------------------------------------------
  // Transactional migration
  // ---------------------------------------------------------------------------
  check(
    "migration starts with BEGIN",
    firstNonEmptyExecutable(SQL).toLowerCase() === "begin;",
  );
  check(
    "migration ends with COMMIT",
    lastNonEmptyExecutable(SQL).toLowerCase() === "commit;",
  );
  check(
    "migration has exactly one executable BEGIN",
    count(stripComments(SQL).toLowerCase(), "begin;") === 1,
  );
  check(
    "migration has exactly one executable COMMIT",
    count(stripComments(SQL).toLowerCase(), "commit;") === 1,
  );

  // ---------------------------------------------------------------------------
  // Fail-closed gate column
  // ---------------------------------------------------------------------------
  check(
    "ws1_public is boolean NOT NULL DEFAULT false",
    /add column if not exists ws1_public boolean not null default false/.test(SQL),
  );

  // ---------------------------------------------------------------------------
  // RLS audit: this migration does not manage RLS; it is managed elsewhere
  // ---------------------------------------------------------------------------
  check(
    "migration does not enable row level security for mp_products",
    !SQL.includes("alter table public.mp_products enable row level security"),
  );
  check(
    "migration does not force row level security for mp_products",
    !SQL.includes("alter table public.mp_products force row level security"),
  );
  check(
    "WS0 foundation schema mentions mp_products in RLS loop",
    WS0.includes("'mp_products'") &&
      WS0.includes("enable row level security") &&
      WS0.includes("force row level security"),
  );
  check(
    "WS1 additive schema enables RLS for mp_products",
    WS1_ADDITIVE.includes("alter table public.mp_products enable row level security") &&
      WS1_ADDITIVE.includes("alter table public.mp_products force row level security"),
  );
  check(
    "no create policy on public.mp_products exists in any script",
    !/create\s+policy\s+[^\n]+on\s+public\.mp_products/is.test(ALL_SQL),
  );
  check(
    "no grant on public.mp_products to anon exists",
    !/grant\s+[^;]*on\s+(table\s+)?public\.mp_products[^;]*to\s+anon\b/is.test(ALL_SQL),
  );
  check(
    "no grant on public.mp_products to authenticated exists",
    !/grant\s+[^;]*on\s+(table\s+)?public\.mp_products[^;]*to\s+authenticated\b/is.test(ALL_SQL),
  );
  check(
    "service_role grant on public.mp_products exists",
    /grant\s+[^;]*on\s+(table\s+)?public\.mp_products[^;]*to\s+service_role\b/is.test(ALL_SQL),
  );

  // ---------------------------------------------------------------------------
  // No executable (or commented) activation DML
  // ---------------------------------------------------------------------------
  const executable = stripComments(SQL);
  check(
    "no UPDATE of mp_products anywhere in executable SQL",
    !/update\s+public\.mp_products/i.test(executable),
  );
  check(
    "no SET ws1_public anywhere in executable SQL",
    !/set\s+ws1_public/i.test(executable),
  );
  check(
    "no blanket activation statement even in comments",
    !SQL.includes("set ws1_public = true"),
  );

  // ---------------------------------------------------------------------------
  // Media defence (SQL layer — supplier-only until separate design approved)
  // ---------------------------------------------------------------------------
  check(
    "media gate: supplier-only source_type",
    count(SQL, "m.source_type = 'supplier'") >= 2,
  );
  check(
    "media gate: supplier_approved rights status",
    count(SQL, "m.rights_status = 'supplier_approved'") >= 2,
  );
  check(
    "media gate: no silent broadening to own/licensed/user_upload/manufacturer",
    !SQL.includes("'own'") &&
      !SQL.includes("'licensed'") &&
      !SQL.includes("'user_upload'") &&
      !SQL.includes("'manufacturer'"),
  );
  check(
    "media gate: unpublished media excluded (published = true)",
    count(SQL, "m.published = true") >= 2,
  );
  check(
    "media gate: receipt media excluded (role <> 'receipt')",
    count(SQL, "m.role <> 'receipt'") >= 2,
  );
  check(
    "media gate: approver metadata required (approved_by is not null)",
    count(SQL, "m.approved_by is not null") >= 2,
  );
  check(
    "media gate: approval timestamp metadata required (approved_at is not null)",
    count(SQL, "m.approved_at is not null") >= 2,
  );
  check(
    "media gate: null source_url excluded (source_url is not null)",
    count(SQL, "m.source_url is not null") >= 2,
  );
  check(
    "media gate: HTTPS-only URLs pass SQL layer",
    count(SQL, "m.source_url like 'https://%'") >= 2,
  );

  // ---------------------------------------------------------------------------
  // Category/brand scope: only values connected to eligible products
  // ---------------------------------------------------------------------------
  check(
    "eligibility includes ws1_public gate in all four RPCs",
    count(SQL, "p.ws1_public = true") >= 4,
  );
  check(
    "eligibility includes public_visible gate in all four RPCs",
    count(SQL, "p.public_visible = true") >= 4,
  );
  check(
    "eligibility includes active default variant in all four RPCs",
    count(SQL, "v.is_default = true") >= 4,
  );

  // ---------------------------------------------------------------------------
  // Price safety (SQL layer): only publishable prices are emitted
  // ---------------------------------------------------------------------------
  check(
    "list_v2 applies public price policy case",
    SQL.includes(
      "when p.variant_website_price_state in ('priced_auto', 'priced_override')",
    ) &&
      SQL.includes("and p.variant_stock_status = 'in_stock'") &&
      SQL.includes("then p.variant_website_price"),
  );
  check(
    "get_by_slug_v2 applies public price policy case",
    SQL.includes(
      "when e.variant_website_price_state in ('priced_auto', 'priced_override')",
    ) &&
      SQL.includes("and e.variant_stock_status = 'in_stock'") &&
      SQL.includes("then e.variant_website_price"),
  );

  // ---------------------------------------------------------------------------
  // Document references
  // ---------------------------------------------------------------------------
  check(
    "migration references RLS audit document",
    SQL.includes("docs/marketplace-ws1-public-rls-audit.md"),
  );
  check(
    "migration references media contract document",
    SQL.includes("docs/marketplace-ws1-public-media-contract.md"),
  );

  console.log("catalogueSqlContract.test.ts: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
