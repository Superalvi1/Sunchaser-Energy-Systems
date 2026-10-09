import assert from "node:assert/strict";
import { test } from "node:test";
import { logoutSessionUsing } from "./authSession";

function fixture(opts: { token?: string | null; server?: () => Promise<boolean>; maxWaitMs?: number } = {}) {
  const events: string[] = [];
  const deps = {
    getStoredAuthToken: () => (opts.token === undefined ? "tok-1" : opts.token),
    clearAuthSession: () => { events.push("clear"); },
    logoutOnServer: async (token: string) => {
      events.push(`server:${token}`);
      return opts.server ? opts.server() : true;
    },
    maxWaitMs: opts.maxWaitMs ?? 200,
  };
  return { deps, events };
}

test("logout calls the server with the stored token BEFORE clearing local storage", async () => {
  const f = fixture();
  const out = await logoutSessionUsing(f.deps);
  assert.deepEqual(f.events, ["server:tok-1", "clear"]);
  assert.deepEqual(out, { serverConfirmed: true });
});

test("a failed network call still clears local state and does not throw", async () => {
  const f = fixture({ server: async () => { throw new TypeError("Failed to fetch"); } });
  const out = await logoutSessionUsing(f.deps);
  assert.deepEqual(f.events, ["server:tok-1", "clear"]);
  assert.deepEqual(out, { serverConfirmed: false });
});

test("a server error status (e.g. 401 already revoked, 503) still clears local state", async () => {
  const f = fixture({ server: async () => false });
  assert.deepEqual(await logoutSessionUsing(f.deps), { serverConfirmed: false });
  assert.deepEqual(f.events, ["server:tok-1", "clear"]);
});

test("a hanging server cannot block sign-out beyond the bounded wait", async () => {
  const f = fixture({ server: () => new Promise<boolean>(() => undefined), maxWaitMs: 30 });
  const started = Date.now();
  const out = await logoutSessionUsing(f.deps);
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(f.events, ["server:tok-1", "clear"]);
  assert.deepEqual(out, { serverConfirmed: false });
});

test("with no stored token nothing is sent but local state is still cleared", async () => {
  const f = fixture({ token: null });
  await logoutSessionUsing(f.deps);
  assert.deepEqual(f.events, ["clear"]);
});

test("local state is cleared even if reading the token throws", async () => {
  const events: string[] = [];
  await logoutSessionUsing({
    getStoredAuthToken: () => { throw new Error("storage blocked"); },
    clearAuthSession: () => { events.push("clear"); },
    logoutOnServer: async () => true,
  });
  assert.deepEqual(events, ["clear"]);
});
