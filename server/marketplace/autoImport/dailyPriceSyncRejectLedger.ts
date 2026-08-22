import type { CatalogueManagerRepository } from "../catalogueManager/memoryCatalogueManagerRepository.ts";
import type { AutoImportRejectLedgerSink } from "./autoImportService.ts";

export type DailyPriceSyncRejectLedgerStats = {
  attempted: number;
  recorded: number;
  failed: number;
};

export type DailyPriceSyncRejectLedger = {
  sink: AutoImportRejectLedgerSink;
  stats: DailyPriceSyncRejectLedgerStats;
  isComplete(expectedRejected: number): boolean;
};

/**
 * Count every durable reject-ledger attempt without exposing row contents or
 * database errors in the daily command's final public-safe status payload.
 */
export function createDailyPriceSyncRejectLedger(
  repository: Pick<CatalogueManagerRepository, "recordReject">,
): DailyPriceSyncRejectLedger {
  const stats: DailyPriceSyncRejectLedgerStats = {
    attempted: 0,
    recorded: 0,
    failed: 0,
  };

  const sink: AutoImportRejectLedgerSink = {
    async record(entry) {
      stats.attempted += 1;
      try {
        await repository.recordReject(entry);
        stats.recorded += 1;
      } catch (error) {
        stats.failed += 1;
        throw error;
      }
    },
  };

  return {
    sink,
    stats,
    isComplete(expectedRejected) {
      return (
        Number.isInteger(expectedRejected) &&
        expectedRejected >= 0 &&
        stats.attempted === expectedRejected &&
        stats.recorded === expectedRejected &&
        stats.failed === 0
      );
    },
  };
}
