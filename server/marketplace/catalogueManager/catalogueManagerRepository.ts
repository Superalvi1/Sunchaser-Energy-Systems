/**
 * CatalogueManager repository contract + environment factory.
 *
 * createCatalogueManagerRepositoryFromEnv():
 *   - Uses Supabase when isSupabaseActive() and getSupabase() returns client.
 *   - Throws CatalogueManagerError(503, "CATALOGUE_UNAVAILABLE") when unavailable.
 *   - NEVER returns memory repository.
 *
 * createMemoryCatalogueManagerRepository() is for tests only.
 *
 * resolveCatalogueManagerRepository(deps, env) is a helper for route wiring
 * tests — it returns deps.repository when injected, or calls the factory.
 */
import { getSupabase, isSupabaseActive } from "../../../dbManager.ts";
import { CatalogueManagerError } from "./catalogueManagerTypes.ts";
import { createSupabaseCatalogueManagerRepository } from "./supabaseCatalogueManagerRepository.ts";

// Re-export type so consumers don't need to import from the memory file.
export type { CatalogueManagerRepository } from "./memoryCatalogueManagerRepository.ts";

import type { CatalogueManagerRepository } from "./memoryCatalogueManagerRepository.ts";

/**
 * Create a production-ready CatalogueManager repository from the environment.
 *
 * Resolves to Supabase when configured. Throws 503 when Supabase is
 * unavailable. Never returns an in-memory repository.
 */
export function createCatalogueManagerRepositoryFromEnv(
  _env?: NodeJS.ProcessEnv,
): CatalogueManagerRepository {
  if (isSupabaseActive()) {
    const client = getSupabase();
    if (client) {
      return createSupabaseCatalogueManagerRepository(client);
    }
  }
  throw new CatalogueManagerError(
    503,
    "CATALOGUE_UNAVAILABLE",
    "Catalogue Manager database is unavailable. Configure Supabase to enable this feature.",
  );
}

/**
 * Route-wiring helper: returns injected repository when present, else calls
 * the env factory. Export this so wiring tests can verify behaviour without
 * constructing an actual HTTP server.
 */
export function resolveCatalogueManagerRepository(
  deps: { repository?: CatalogueManagerRepository },
  env?: NodeJS.ProcessEnv,
): CatalogueManagerRepository {
  if (deps.repository) return deps.repository;
  return createCatalogueManagerRepositoryFromEnv(env);
}
