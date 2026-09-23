import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogueRepository } from "./catalogueRepository.ts";
import {
  createCachedPublicCatalogueRepository,
  PUBLIC_CATALOGUE_BACKEND_TTL_MS,
} from "./cachedPublicCatalogueRepository.ts";

function stub(overrides: Partial<CatalogueRepository> = {}): CatalogueRepository {
  return {
    listCategories: async () => [],
    listBrands: async () => [],
    listProducts: async () => ({ items: [], total: 0, limit: 0, offset: 0 }),
    getProductBySlug: async () => null,
    ...overrides,
  };
}

test("repeated and concurrent public list requests make one Supabase call per TTL", async () => {
  let clock = 1_000;
  let reads = 0;
  const repo = createCachedPublicCatalogueRepository(
    stub({
      listProducts: async () => {
        reads++;
        return { items: [], total: 0, limit: 0, offset: 0 };
      },
    }),
    { now: () => clock },
  );

  await Promise.all(Array.from({ length: 20 }, () => repo.listProducts({})));
  assert.equal(reads, 1, "parallel renders are deduplicated");
  await repo.listProducts({});
  assert.equal(reads, 1, "repeated requests reuse public data");

  clock += PUBLIC_CATALOGUE_BACKEND_TTL_MS + 1;
  await repo.listProducts({});
  assert.equal(reads, 2, "catalogue refreshes after TTL");
});

test("different filters and slugs remain isolated", async () => {
  let reads = 0;
  const repo = createCachedPublicCatalogueRepository(stub({
    listProducts: async (filters) => {
      reads++;
      return { items: [], total: filters.featured ? 1 : 0, limit: 0, offset: 0 };
    },
  }));
  const all = await repo.listProducts({});
  const featured = await repo.listProducts({ featured: true });
  const again = await repo.listProducts({ featured: true });
  assert.equal(reads, 2);
  assert.equal(all.total, 0);
  assert.equal(featured.total, 1);
  assert.equal(again.total, 1);
});

test("failed public reads are not cached and missing public slugs are", async () => {
  let reads = 0;
  const repo = createCachedPublicCatalogueRepository(stub({
    getProductBySlug: async () => {
      reads++;
      if (reads === 1) throw new Error("temporary database outage");
      return null;
    },
  }));
  await assert.rejects(repo.getProductBySlug("missing-product"));
  assert.equal(await repo.getProductBySlug("missing-product"), null);
  assert.equal(await repo.getProductBySlug("missing-product"), null);
  assert.equal(reads, 2);
});

test("zero TTL disables caching", async () => {
  let reads = 0;
  const repo = createCachedPublicCatalogueRepository(stub({
    listCategories: async () => {
      reads++;
      return [];
    },
  }), { ttlMs: 0 });
  await repo.listCategories();
  await repo.listCategories();
  assert.equal(reads, 2);
});
