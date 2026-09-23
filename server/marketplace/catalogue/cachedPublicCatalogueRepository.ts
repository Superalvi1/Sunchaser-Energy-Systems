import type { CatalogueRepository } from "./catalogueRepository.ts";
import type { CataloguePage } from "./catalogueTypes.ts";

/**
 * Read-only, per-process cache for the PUBLIC catalogue exclusively. Never use
 * this wrapper for CRM users, quotations, checkout, or admin endpoints.
 *
 * The marketing site has a longer Next Data Cache, but this protects Supabase
 * from direct traffic, crawlers and concurrent render requests to the API.
 * Successes (including a missing public slug) are cached for 60 seconds.
 * Failed queries are never cached. Each bucket is size-bounded.
 */
export const PUBLIC_CATALOGUE_BACKEND_TTL_MS = 60_000;

type CacheOptions = {
  ttlMs?: number;
  now?: () => number;
};

function createTimedCache<T>(maxEntries: number, ttlMs: number, now: () => number) {
  const values = new Map<string, { value: T; expiresAt: number }>();
  const pending = new Map<string, Promise<T>>();

  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      if (ttlMs <= 0) return load();

      const stored = values.get(key);
      if (stored) {
        if (stored.expiresAt > now()) {
          // Refresh LRU order; frequently read catalogue list cannot be
          // evicted by a brief wave of unique product-detail crawls.
          values.delete(key);
          values.set(key, stored);
          return Promise.resolve(stored.value);
        }
        values.delete(key);
      }

      // Deduplicate concurrent cache misses (including an expired entry).
      const ongoing = pending.get(key);
      if (ongoing) return ongoing;

      const request = Promise.resolve()
        .then(load)
        .then((value) => {
          values.delete(key);
          values.set(key, { value, expiresAt: now() + ttlMs });
          if (values.size > maxEntries) {
            const oldest = values.keys().next().value;
            if (oldest !== undefined) values.delete(oldest);
          }
          return value;
        })
        .finally(() => {
          pending.delete(key);
        });

      pending.set(key, request);
      return request;
    },
  };
}

export function createCachedPublicCatalogueRepository(
  source: CatalogueRepository,
  options: CacheOptions = {},
): CatalogueRepository {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? PUBLIC_CATALOGUE_BACKEND_TTL_MS;
  const pageCache = createTimedCache<CataloguePage>(32, ttlMs, now);
  const detailCache = createTimedCache<Awaited<ReturnType<CatalogueRepository["getProductBySlug"]>>>(
    512, ttlMs, now,
  );
  const categoryCache = createTimedCache<Awaited<ReturnType<CatalogueRepository["listCategories"]>>>(
    1, ttlMs, now,
  );
  const brandCache = createTimedCache<Awaited<ReturnType<CatalogueRepository["listBrands"]>>>(
    1, ttlMs, now,
  );

  return {
    listCategories: () => categoryCache.get("all", () => source.listCategories()),
    listBrands: () => brandCache.get("all", () => source.listBrands()),
    listProducts: (filters) => {
      // Distinguish all query variants; filtered pages must never mix.
      const key = JSON.stringify([
        filters.category ?? null,
        filters.brand ?? null,
        filters.featured ?? null,
        filters.limit ?? null,
        filters.offset ?? 0,
      ]);
      return pageCache.get(key, () => source.listProducts(filters));
    },
    getProductBySlug: (slug) =>
      detailCache.get(slug, () => source.getProductBySlug(slug)),
  };
}
