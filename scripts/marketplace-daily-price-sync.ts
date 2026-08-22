/**
 * Render Cron entry point for the daily supplier price-only sync.
 *
 * This command never creates products, changes images/metadata/inventory,
 * activates catalogue rows, or switches the public catalogue source.
 */
import "dotenv/config";
import { createAutoImportService } from "../server/marketplace/autoImport/autoImportService.ts";
import { createDailyPriceSyncRejectLedger } from "../server/marketplace/autoImport/dailyPriceSyncRejectLedger.ts";
import { createCatalogueManagerRepositoryFromEnv } from "../server/marketplace/catalogueManager/catalogueManagerRepository.ts";

function enabled(name: string): boolean {
  return String(process.env[name] || "").toLowerCase() === "true";
}

const requiredFlags = [
  "MARKETPLACE_ENABLED",
  "MARKETPLACE_CEO_AUTO_IMPORT_ENABLED",
  "MARKETPLACE_CEO_AUTO_IMPORT_PERSIST",
  "MARKETPLACE_WS4_KAMAL_LIVE_ENABLED",
  "MARKETPLACE_WS4_ALLADIN_LIVE_ENABLED",
] as const;

const missing: string[] = requiredFlags.filter((name) => !enabled(name));
const authorizedMethod = "shopify_storefront_products_json";
for (const supplier of ["KAMAL", "ALLADIN"] as const) {
  const name = `MARKETPLACE_WS4_${supplier}_AUTHORIZED_METHOD`;
  if (process.env[name] !== authorizedMethod) missing.push(name);
}
if (missing.length) {
  console.error(
    JSON.stringify({
      ok: false,
      mode: "price_only",
      code: "PRICE_SYNC_DISABLED",
      missingFlags: missing,
      note: "No database writes were attempted.",
    }),
  );
  process.exitCode = 2;
} else {
  let rejectRepository: ReturnType<
    typeof createCatalogueManagerRepositoryFromEnv
  > | null = null;
  try {
    rejectRepository = createCatalogueManagerRepositoryFromEnv(process.env);
    // Read-only preflight: proves the catalogue-manager schema is reachable
    // before supplier discovery or any catalogue price write. Each reject RPC
    // is then counted and required before the atomic price commit.
    await rejectRepository.reconciliation();
  } catch {
    console.error(
      JSON.stringify({
        ok: false,
        mode: "price_only",
        code: "REJECT_LEDGER_UNAVAILABLE",
        note: "No supplier fetch or catalogue price write was attempted.",
      }),
    );
    process.exitCode = 1;
  }

  if (!rejectRepository) {
    // The structured error above is the only output required for this hold.
  } else {
    const rejectLedger = createDailyPriceSyncRejectLedger(rejectRepository);
    const service = createAutoImportService({
      env: process.env,
      rejectLedger: rejectLedger.sink,
      rejectLedgerRequired: true,
    });
    const result = await service.runAutomaticImport({
      actorScope: "system:marketplace-daily-price-sync",
      mode: "price_only",
    });
    const rejectLedgerComplete = rejectLedger.isComplete(
      result.health.rejectedVariants,
    );

    console.log(
      JSON.stringify({
        ok: result.status === "succeeded" && rejectLedgerComplete,
        mode: "price_only",
        status: result.status,
        runId: result.runId,
        suppliers: {
          kamalDiscovered: result.health.kamalDiscovered,
          alladinDiscovered: result.health.alladinDiscovered,
        },
        existingListingsUpdated: result.health.productsUpdated,
        productsCreated: result.health.productsCreated,
        rejectedOrUntrackedVariants: result.health.rejectedVariants,
        rejectLedger: {
          attempted: rejectLedger.stats.attempted,
          recorded: rejectLedger.stats.recorded,
          failed: rejectLedger.stats.failed,
          complete: rejectLedgerComplete,
        },
        rolledBackPrices: result.health.rolledBackPrices,
        errors: result.health.errors,
        publicWebsiteVisible: result.stages.publicWebsiteVisible,
      }),
    );

    if (
      result.status !== "succeeded" ||
      result.health.productsCreated !== 0 ||
      !rejectLedgerComplete
    ) {
      process.exitCode = 1;
    }
  }
}
