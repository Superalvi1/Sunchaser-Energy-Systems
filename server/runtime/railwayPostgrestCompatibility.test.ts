import assert from "node:assert/strict";
import { test } from "node:test";

test("Supabase-style reads and RPCs are redirected to private Railway PostgREST", async () => {
  const originalFetch = globalThis.fetch;
  const originalRailway = process.env.RAILWAY_POSTGREST_URL;
  const originalSupabase = process.env.SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];

  process.env.RAILWAY_POSTGREST_URL = "http://sunchaser-postgrest.railway.internal:3000";
  delete process.env.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.test";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    calls.push({ url, method: String(init?.method || "GET"), headers });
    return new Response("[]", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-range": "0-0/0",
      },
    });
  }) as typeof fetch;

  try {
    const { describeSupabaseBackendConfig, getSupabase } = await import("../../dbManager.ts");
    const config = describeSupabaseBackendConfig();
    assert.equal(config.source, "RAILWAY_POSTGREST_URL");
    assert.equal(config.host, "sunchaser-postgrest.railway.internal");
    assert.equal(config.configured, true);

    const client = getSupabase();
    assert.ok(client);

    const list = await client!.from("customers").select("id").limit(1);
    assert.equal(list.error, null);

    const rpc = await client!.rpc("mp_public_catalogue_list_v2", { p_limit: 1 });
    assert.equal(rpc.error, null);

    assert.equal(calls.length, 2);
    assert.match(calls[0]!.url, /^http:\/\/sunchaser-postgrest\.railway\.internal:3000\/customers\?/);
    assert.match(calls[1]!.url, /^http:\/\/sunchaser-postgrest\.railway\.internal:3000\/rpc\/mp_public_catalogue_list_v2/);
    for (const call of calls) {
      assert.equal(new URL(call.url).hostname, "sunchaser-postgrest.railway.internal");
      assert.ok(call.headers.get("authorization")?.startsWith("Bearer "));
      assert.ok(call.headers.get("apikey"));
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRailway === undefined) delete process.env.RAILWAY_POSTGREST_URL;
    else process.env.RAILWAY_POSTGREST_URL = originalRailway;
    if (originalSupabase === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalSupabase;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  }
});
