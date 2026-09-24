import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { assertRailwayPrivateSmokeEnvironment } from "./railwayPrivateSmoke.ts";

const isolated = { NODE_ENV: "production", RAILWAY_PROJECT_ID: "test-staging-project", RAILWAY_CRM_PRIVATE_SMOKE_MODE: "true" };
test("ordinary Render and Railway production behavior is unchanged by default", () => {
  assert.equal(assertRailwayPrivateSmokeEnvironment({ NODE_ENV: "production" }), false);
  assert.equal(assertRailwayPrivateSmokeEnvironment({}), false);
});
test("permits an explicit domainless health-only Railway pilot", () => {
  assert.equal(assertRailwayPrivateSmokeEnvironment(isolated), true);
});
test("refuses a public domain, any production DB/key, or live integration", () => {
  for (const key of ["RAILWAY_PUBLIC_DOMAIN", "RAILWAY_STATIC_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "WHATSAPP_APP_SECRET", "PUBLIC_LEAD_API_KEY"]) {
    assert.throws(() => assertRailwayPrivateSmokeEnvironment({ ...isolated, [key]: "present" }), new RegExp(key));
  }
  for (const key of ["WHATSAPP_CONVERSATIONS_ENABLED", "MARKETPLACE_ENABLED", "UNIFIED_MESSAGING_POSTGRES_ENABLED"]) {
    assert.throws(() => assertRailwayPrivateSmokeEnvironment({ ...isolated, [key]: "true" }), new RegExp(key));
  }
});
test("fails closed outside Railway or production environment", () => {
  assert.throws(() => assertRailwayPrivateSmokeEnvironment({ NODE_ENV: "development", RAILWAY_CRM_PRIVATE_SMOKE_MODE: "true" }));
  assert.throws(() => assertRailwayPrivateSmokeEnvironment({ NODE_ENV: "production", RAILWAY_CRM_PRIVATE_SMOKE_MODE: "true" }));
});
test("server mounts health-only guard before routes and skips WA persistence during pilot", () => {
  const server = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");
  const appGuard = server.indexOf('app.use((req, res, next) => {\n  if (!railwayPrivateSmokeMode || req.path === "/health")');
  assert.ok(appGuard > 0);
  assert.ok(appGuard < server.indexOf("app.use(createCorsMiddleware())"));
  assert.match(server, /if \(!railwayPrivateSmokeMode\) \{[\s\S]*?productionAutoLinkLead = buildProductionWebhookAutoLinkLead/);
  assert.match(server, /if \(!railwayPrivateSmokeMode\) \{[\s\S]*?createWhatsAppWebhookRouter/);
});
