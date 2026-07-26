/**
 * One-shot CEO auto-import against live public Shopify catalogues (memory repo).
 * Does not apply hosted SQL. Does not publish to production DB unless wired.
 */
import { createAutoImportService } from "../server/marketplace/autoImport/autoImportService.ts";
import { createMemoryAutoImportRepository } from "../server/marketplace/autoImport/autoImportRepository.ts";

const repository = createMemoryAutoImportRepository();
const service = createAutoImportService({
  repository,
  env: {
    MARKETPLACE_ENABLED: "true",
    MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
  },
});

const result = await service.runAutomaticImport({
  actorScope: "admin:super:live-report",
});
const listings = await service.listListings();
const multi = listings.filter(
  (l) => new Set(l.offers.map((o) => o.supplier)).size > 1,
);

console.log(
  JSON.stringify(
    {
      status: result.status,
      health: result.health,
      listingsCount: listings.length,
      multiSupplierListings: multi.length,
      multiSupplierExamples: multi.slice(0, 5).map((l) => ({
        title: l.title,
        websitePricePkr: l.websitePricePkr,
        selectedSupplier: l.selectedSupplier,
        priceReason: l.priceReason,
        offers: l.offers,
      })),
      sampleLowestPrice: result.sampleLowestPrice.slice(0, 8),
      ceoDiscountApplied: result.ceoDiscountApplied,
      legacyMappingBypassUsed: result.legacyMappingBypassUsed,
    },
    null,
    2,
  ),
);
