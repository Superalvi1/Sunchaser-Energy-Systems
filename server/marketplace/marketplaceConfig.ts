/**
 * Server-only marketplace configuration.
 * Marketplace remains disabled / gateway-off until later workstreams enable them.
 * Never use VITE_ prefixes for these secrets or flags.
 */

export type MarketplaceConfig = {
  enabled: boolean;
  gatewayEnabled: boolean;
  /** WS5 cart/checkout/delivery. Default false; independent of auto-import. */
  cartEnabled: boolean;
  /** WS6a bank-transfer payments. Default false; independent of auto-import. */
  paymentsEnabled: boolean;
  /** WS6b COD lifecycle. Default false; independent of auto-import. */
  codEnabled: boolean;
  catalogueSource: "static" | "database";
  idempotencyStaleSeconds: number;
  uploadIntentStaleSeconds: number;
  storageCleanupMaxAttempts: number;
  storageCleanupIntervalMin: number;
  receiptBucket: string;
  revalidateUrl: string;
  revalidateSecret: string;
  possessionTokenTtlHours: number;
  apiBaseUrl: string;
  apiTimeoutMs: number;
};

function readFlag(env: NodeJS.ProcessEnv, key: string, defaultValue = false): boolean {
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return defaultValue;
  }
  const normalized = String(raw).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function readSecret(env: NodeJS.ProcessEnv, key: string): string {
  return String(env[key] ?? "").trim();
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
): number {
  const raw = String(env[key] ?? "").trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

/**
 * Fail-closed catalogue publication source.
 * Only the exact value "database" (case-insensitive) selects the live DB
 * catalogue. unset / empty / "static" / any malformed value → static.
 */
export function readCatalogueSource(
  env: NodeJS.ProcessEnv,
): "static" | "database" {
  const raw = String(env.MARKETPLACE_CATALOGUE_SOURCE ?? "static")
    .trim()
    .toLowerCase();
  return raw === "database" ? "database" : "static";
}

/** Resolve marketplace env. Defaults keep public marketplace and gateway OFF. */
export function readMarketplaceConfig(
  env: NodeJS.ProcessEnv = process.env,
): MarketplaceConfig {
  return {
    enabled: readFlag(env, "MARKETPLACE_ENABLED", false),
    gatewayEnabled: readFlag(env, "MARKETPLACE_GATEWAY_ENABLED", false),
    cartEnabled: readFlag(env, "MARKETPLACE_CART_ENABLED", false),
    paymentsEnabled: readFlag(env, "MARKETPLACE_PAYMENTS_ENABLED", false),
    codEnabled: readFlag(env, "MARKETPLACE_COD_ENABLED", false),
    catalogueSource: readCatalogueSource(env),
    idempotencyStaleSeconds: readInt(env, "MARKETPLACE_IDEMPOTENCY_STALE_SECONDS", 300, 30),
    uploadIntentStaleSeconds: readInt(env, "MARKETPLACE_UPLOAD_INTENT_STALE_SECONDS", 300, 30),
    storageCleanupMaxAttempts: readInt(env, "MARKETPLACE_STORAGE_CLEANUP_MAX_ATTEMPTS", 8, 1),
    storageCleanupIntervalMin: readInt(env, "MARKETPLACE_STORAGE_CLEANUP_INTERVAL_MIN", 15, 1),
    receiptBucket: readSecret(env, "MARKETPLACE_RECEIPT_BUCKET") || "mp-receipts-private",
    revalidateUrl: readSecret(env, "MARKETPLACE_REVALIDATE_URL"),
    revalidateSecret: readSecret(env, "MARKETPLACE_REVALIDATE_SECRET"),
    possessionTokenTtlHours: readInt(env, "MARKETPLACE_POSSESSION_TOKEN_TTL_HOURS", 72, 1),
    apiBaseUrl: readSecret(env, "MARKETPLACE_API_BASE_URL"),
    apiTimeoutMs: readInt(env, "MARKETPLACE_API_TIMEOUT_MS", 8000, 1000),
  };
}

export function isMarketplaceEnabled(config: MarketplaceConfig): boolean {
  return config.enabled === true;
}

export function isMarketplaceGatewayEnabled(config: MarketplaceConfig): boolean {
  return config.enabled === true && config.gatewayEnabled === true;
}

/** WS5 cart/checkout — requires MARKETPLACE_ENABLED and MARKETPLACE_CART_ENABLED. */
export function isMarketplaceCartEnabled(config: MarketplaceConfig): boolean {
  return config.enabled === true && config.cartEnabled === true;
}

/** WS6a payments — requires MARKETPLACE_ENABLED and MARKETPLACE_PAYMENTS_ENABLED. */
export function isMarketplacePaymentsEnabled(config: MarketplaceConfig): boolean {
  return config.enabled === true && config.paymentsEnabled === true;
}

/** WS6b COD — requires MARKETPLACE_ENABLED and MARKETPLACE_COD_ENABLED. */
export function isMarketplaceCodEnabled(config: MarketplaceConfig): boolean {
  return config.enabled === true && config.codEnabled === true;
}

export function isDatabaseCatalogueSource(config: MarketplaceConfig): boolean {
  return config.catalogueSource === "database";
}

/** True only when the public catalogue router uses the database source. */
export function publicWouldShowSyncedProducts(
  config: MarketplaceConfig,
): boolean {
  return isDatabaseCatalogueSource(config);
}
