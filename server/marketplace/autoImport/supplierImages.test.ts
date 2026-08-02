/**
 * Unit tests: supplier image sanitization + catalogue media mapping.
 * Run: PLAYWRIGHT_BROWSERS_PATH=0 tsx server/marketplace/autoImport/supplierImages.test.ts
 */
import assert from "node:assert/strict";
import {
  collectSelectedOfferImages,
  sanitizeSupplierImageUrl,
} from "./supplierImages.ts";
import { mapPublishedImageUrls } from "../catalogue/catalogueMapper.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

const GOOD =
  "https://cdn.shopify.com/s/files/1/0000/0001/products/panel.jpg";
const GOOD2 =
  "https://www.kamalsolar.pk/cdn/shop/products/inverter.png";
const BAD_HOST = "https://evil.example/steal.jpg";
const BAD_JS = "javascript:alert(1)";
const BAD_DATA = "data:image/png;base64,aaaa";
const HTTP = "http://cdn.shopify.com/s/files/1/x.jpg";

check(
  "sanitize accepts cdn.shopify.com https",
  sanitizeSupplierImageUrl(GOOD) === GOOD,
);
check(
  "sanitize accepts kamalsolar host",
  sanitizeSupplierImageUrl(GOOD2) === GOOD2,
);
check("sanitize rejects foreign host", sanitizeSupplierImageUrl(BAD_HOST) === null);
check("sanitize rejects javascript:", sanitizeSupplierImageUrl(BAD_JS) === null);
check("sanitize rejects data:", sanitizeSupplierImageUrl(BAD_DATA) === null);
check("sanitize rejects http", sanitizeSupplierImageUrl(HTTP) === null);

const mixed = collectSelectedOfferImages({
  selectedSourceKey: "kamal:1:1",
  selectedSupplier: "kamal",
  offers: [
    {
      sourceKey: "kamal:1:1",
      supplier: "kamal",
      primaryImageUrl: GOOD,
      additionalImageUrls: [GOOD2, BAD_HOST, GOOD],
    },
    {
      sourceKey: "alladin:9:9",
      supplier: "alladin",
      primaryImageUrl: "https://cdn.shopify.com/s/files/1/other/other.jpg",
      additionalImageUrls: [],
    },
  ],
});
check("collect uses selected offer only", mixed.length === 2);
check("collect primary is first", mixed[0]?.url === GOOD && mixed[0]?.isPrimary === true);
check("collect drops unsafe and duplicates", mixed[1]?.url === GOOD2);

const cross = collectSelectedOfferImages({
  selectedSourceKey: "alladin:9:9",
  selectedSupplier: "alladin",
  offers: [
    {
      sourceKey: "kamal:1:1",
      supplier: "kamal",
      primaryImageUrl: GOOD,
      additionalImageUrls: [],
    },
    {
      sourceKey: "alladin:9:9",
      supplier: "alladin",
      primaryImageUrl: GOOD2,
      additionalImageUrls: [],
    },
  ],
});
check(
  "no cross-product image mix — winner only",
  cross.length === 1 && cross[0]?.url === GOOD2,
);

const mapped = mapPublishedImageUrls([
  {
    source_url: GOOD2,
    sort_order: 1,
    role: "gallery",
    published: true,
    rights_status: "supplier_approved",
    source_type: "supplier",
  },
  {
    source_url: GOOD,
    sort_order: 0,
    role: "thumbnail",
    published: true,
    rights_status: "supplier_approved",
    source_type: "supplier",
  },
  {
    source_url: BAD_HOST,
    sort_order: 2,
    role: "gallery",
    published: true,
    rights_status: "supplier_approved",
    source_type: "supplier",
  },
  {
    source_url: GOOD,
    sort_order: 3,
    role: "gallery",
    published: false,
    rights_status: "supplier_approved",
    source_type: "supplier",
  },
]);
check("mapper primary prefers thumbnail", mapped.image === GOOD);
check("mapper gallery excludes primary + unsafe", mapped.images.length === 1 && mapped.images[0] === GOOD2);
check(
  "mapper empty when no published media",
  mapPublishedImageUrls([]).image === null &&
    mapPublishedImageUrls([]).images.length === 0,
);

console.log("\nAll supplier image / catalogue media tests passed.");
