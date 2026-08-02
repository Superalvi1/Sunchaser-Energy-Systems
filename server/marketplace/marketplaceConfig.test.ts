import assert from "node:assert/strict";
import {
  isDatabaseCatalogueSource,
  isMarketplaceCartEnabled,
  isMarketplaceCodEnabled,
  isMarketplaceEnabled,
  isMarketplaceGatewayEnabled,
  isMarketplacePaymentsEnabled,
  publicWouldShowSyncedProducts,
  readCatalogueSource,
  readMarketplaceConfig,
} from "./marketplaceConfig.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

const defaults = readMarketplaceConfig({});
check("MARKETPLACE_ENABLED defaults false", defaults.enabled === false);
check("MARKETPLACE_GATEWAY_ENABLED defaults false", defaults.gatewayEnabled === false);
check("MARKETPLACE_CART_ENABLED defaults false", defaults.cartEnabled === false);
check("MARKETPLACE_PAYMENTS_ENABLED defaults false", defaults.paymentsEnabled === false);
check("MARKETPLACE_COD_ENABLED defaults false", defaults.codEnabled === false);
check("catalogue source defaults static", defaults.catalogueSource === "static");
check(
  "publicWouldShowSyncedProducts false by default",
  publicWouldShowSyncedProducts(defaults) === false,
);
check(
  "invalid MARKETPLACE_CATALOGUE_SOURCE fails closed to static",
  readCatalogueSource({ MARKETPLACE_CATALOGUE_SOURCE: "yes-please" }) ===
    "static",
);
check(
  "readCatalogueSource database exact match",
  readCatalogueSource({ MARKETPLACE_CATALOGUE_SOURCE: "database" }) ===
    "database",
);
check("receipt bucket default set", defaults.receiptBucket === "mp-receipts-private");
check("isMarketplaceEnabled false by default", isMarketplaceEnabled(defaults) === false);
check("cart helper false by default", isMarketplaceCartEnabled(defaults) === false);
check("payments helper false by default", isMarketplacePaymentsEnabled(defaults) === false);
check("COD helper false by default", isMarketplaceCodEnabled(defaults) === false);
check(
  "gateway helper requires both flags",
  isMarketplaceGatewayEnabled({ ...defaults, gatewayEnabled: true }) === false,
);

const enabled = readMarketplaceConfig({
  MARKETPLACE_ENABLED: "true",
  MARKETPLACE_GATEWAY_ENABLED: "false",
  MARKETPLACE_CATALOGUE_SOURCE: "database",
  MARKETPLACE_IDEMPOTENCY_STALE_SECONDS: "120",
});
check("enabled parses true", enabled.enabled === true);
check("gateway stays false", enabled.gatewayEnabled === false);
check("database catalogue source", isDatabaseCatalogueSource(enabled) === true);
check("stale seconds parsed", enabled.idempotencyStaleSeconds === 120);
check(
  "gateway on only when both true",
  isMarketplaceGatewayEnabled({
    ...enabled,
    gatewayEnabled: true,
  }) === true,
);

const unsafeGateway = readMarketplaceConfig({
  MARKETPLACE_ENABLED: "false",
  MARKETPLACE_GATEWAY_ENABLED: "true",
});
check(
  "gateway helper false when marketplace disabled",
  isMarketplaceGatewayEnabled(unsafeGateway) === false,
);

const ws56Alone = readMarketplaceConfig({
  MARKETPLACE_CART_ENABLED: "true",
  MARKETPLACE_PAYMENTS_ENABLED: "true",
  MARKETPLACE_COD_ENABLED: "true",
});
check(
  "cart requires MARKETPLACE_ENABLED",
  isMarketplaceCartEnabled(ws56Alone) === false,
);
check(
  "payments require MARKETPLACE_ENABLED",
  isMarketplacePaymentsEnabled(ws56Alone) === false,
);
check("COD requires MARKETPLACE_ENABLED", isMarketplaceCodEnabled(ws56Alone) === false);

const autoImportOnly = readMarketplaceConfig({
  MARKETPLACE_ENABLED: "true",
  MARKETPLACE_CEO_AUTO_IMPORT_ENABLED: "true",
  MARKETPLACE_CEO_AUTO_IMPORT_PERSIST: "true",
});
check(
  "auto-import flags do not enable cart",
  isMarketplaceCartEnabled(autoImportOnly) === false,
);
check(
  "auto-import flags do not enable payments",
  isMarketplacePaymentsEnabled(autoImportOnly) === false,
);
check(
  "auto-import flags do not enable COD",
  isMarketplaceCodEnabled(autoImportOnly) === false,
);

const ws56On = readMarketplaceConfig({
  MARKETPLACE_ENABLED: "true",
  MARKETPLACE_CART_ENABLED: "true",
  MARKETPLACE_PAYMENTS_ENABLED: "true",
  MARKETPLACE_COD_ENABLED: "true",
});
check("cart on when both flags true", isMarketplaceCartEnabled(ws56On) === true);
check(
  "payments on when both flags true",
  isMarketplacePaymentsEnabled(ws56On) === true,
);
check("COD on when both flags true", isMarketplaceCodEnabled(ws56On) === true);

console.log("marketplaceConfig.test.ts: all checks passed");
