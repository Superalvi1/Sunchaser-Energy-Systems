import assert from "node:assert/strict";
import {
  isDatabaseCatalogueSource,
  isMarketplaceEnabled,
  isMarketplaceGatewayEnabled,
  readMarketplaceConfig,
} from "./marketplaceConfig.ts";

function check(name: string, condition: boolean): void {
  assert.equal(condition, true, name);
  console.log(`ok - ${name}`);
}

const defaults = readMarketplaceConfig({});
check("MARKETPLACE_ENABLED defaults false", defaults.enabled === false);
check("MARKETPLACE_GATEWAY_ENABLED defaults false", defaults.gatewayEnabled === false);
check("catalogue source defaults static", defaults.catalogueSource === "static");
check("receipt bucket default set", defaults.receiptBucket === "mp-receipts-private");
check("isMarketplaceEnabled false by default", isMarketplaceEnabled(defaults) === false);
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

console.log("marketplaceConfig.test.ts: all checks passed");
