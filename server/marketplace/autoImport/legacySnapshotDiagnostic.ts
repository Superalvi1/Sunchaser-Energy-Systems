/**
 * Read-only diagnostic for legacy commercial snapshot gaps.
 * Identifies listings where last_valid_supplier is present but
 * last_valid_source_key and/or last_valid_availability is missing.
 *
 * Does NOT mutate data. Planning already falls back via
 * lastValidCommercialFromListing() (legacy:{supplier}:{identityKey}).
 */
import type { AutoImportListingRecord } from "./autoImportTypes.ts";

export type LegacySnapshotIssue = {
  identityKey: string;
  title: string;
  slug: string;
  selectedSupplier: string;
  lastValidPricePkr: number;
  lastValidSupplier: string;
  lastValidObservationAt: string;
  lastValidSourceKey: string | null;
  lastValidAvailability: string | null;
  missingSourceKey: boolean;
  missingAvailability: boolean;
  /** Surrogate key planning would use today if snapshot fields stay null. */
  plannedLegacySourceKey: string;
};

export type LegacySnapshotDiagnostic = {
  checkedAt: string;
  count: number;
  issues: LegacySnapshotIssue[];
  correctionPlan: {
    status: "prepared_not_applied";
    summary: string;
    steps: string[];
  };
};

export function findLegacySnapshotGaps(
  listings: AutoImportListingRecord[],
  now: () => Date = () => new Date(),
): LegacySnapshotDiagnostic {
  const issues: LegacySnapshotIssue[] = [];
  for (const l of listings) {
    if (!l.lastValidSupplier) continue;
    const missingSourceKey =
      l.lastValidSourceKey == null ||
      String(l.lastValidSourceKey).trim() === "";
    const missingAvailability = l.lastValidAvailability == null;
    if (!missingSourceKey && !missingAvailability) continue;
    issues.push({
      identityKey: l.identityKey,
      title: l.title,
      slug: l.slug,
      selectedSupplier: l.selectedSupplier,
      lastValidPricePkr: l.lastValidPricePkr,
      lastValidSupplier: l.lastValidSupplier,
      lastValidObservationAt: l.lastValidObservationAt,
      lastValidSourceKey: l.lastValidSourceKey,
      lastValidAvailability: l.lastValidAvailability,
      missingSourceKey,
      missingAvailability,
      plannedLegacySourceKey: `legacy:${l.lastValidSupplier}:${l.identityKey}`,
    });
  }

  return {
    checkedAt: now().toISOString(),
    count: issues.length,
    issues,
    correctionPlan: {
      status: "prepared_not_applied",
      summary:
        "Backfill last_valid_source_key and last_valid_availability for legacy rows without mutating live commercial selection in this PR. Prefer offer-embedded sourceKey when present; otherwise keep legacy:{supplier}:{identityKey} until the next successful sync rewrites the snapshot.",
      steps: [
        "1. Review diagnostic issues (expected: Knox Zapher 11.2 / 9.2 / 6.6 kW legacy rows).",
        "2. In a separate PR/change window, backfill last_valid_source_key from offers[].sourceKey when present, else leave planning on legacy surrogate.",
        "3. Backfill last_valid_availability from listing.availability (or offer availability for last_valid_supplier).",
        "4. Re-run this read-only diagnostic; count must be 0.",
        "5. Do not delete products, do not change website prices, do not run supplier sync solely for this backfill unless explicitly approved.",
      ],
    },
  };
}
