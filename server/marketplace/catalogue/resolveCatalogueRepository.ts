/**
 * Resolve the public catalogue repository from MARKETPLACE_CATALOGUE_SOURCE.
 * Default / unknown / malformed → static (fail-closed). Never falls back to DB
 * when static is selected.
 */
import {
  isDatabaseCatalogueSource,
  readMarketplaceConfig,
  type MarketplaceConfig,
} from "../marketplaceConfig.ts";
import {
  createSupabaseCatalogueRepository,
  type CatalogueRepository,
} from "./catalogueRepository.ts";
import { createStaticCatalogueRepository } from "./staticCatalogueRepository.ts";

export type CatalogueRepositoryFactories = {
  /** Explicit override — tests only. Bypasses source selection. */
  repository?: CatalogueRepository;
  createStaticRepository?: () => CatalogueRepository;
  createDatabaseRepository?: () => CatalogueRepository;
};

export type PublicCataloguePublication = {
  /** Effective source used by the public catalogue router. */
  effectivePublicCatalogueSource: "static" | "database";
  /** True only when effective source is database. */
  publicWouldShowSyncedProducts: boolean;
};

export function resolvePublicCataloguePublication(
  env: NodeJS.ProcessEnv = process.env,
): PublicCataloguePublication {
  const config = readMarketplaceConfig(env);
  return publicationFromConfig(config);
}

export function publicationFromConfig(
  config: MarketplaceConfig,
): PublicCataloguePublication {
  const effectivePublicCatalogueSource = isDatabaseCatalogueSource(config)
    ? "database"
    : "static";
  return {
    effectivePublicCatalogueSource,
    publicWouldShowSyncedProducts: effectivePublicCatalogueSource === "database",
  };
}

/**
 * Pick static vs database repository for public catalogue endpoints.
 * When `repository` is provided (legacy tests), it wins — production mounts
 * omit that override so the env gate always applies.
 */
export function resolvePublicCatalogueRepository(
  env: NodeJS.ProcessEnv,
  factories: CatalogueRepositoryFactories = {},
): {
  repository: CatalogueRepository;
  publication: PublicCataloguePublication;
} {
  const publication = resolvePublicCataloguePublication(env);
  if (factories.repository) {
    return { repository: factories.repository, publication };
  }
  if (publication.effectivePublicCatalogueSource === "database") {
    const createDb =
      factories.createDatabaseRepository ?? createSupabaseCatalogueRepository;
    return { repository: createDb(), publication };
  }
  const createStatic =
    factories.createStaticRepository ?? createStaticCatalogueRepository;
  return { repository: createStatic(), publication };
}
