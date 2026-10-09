import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreAuthSessionUsing } from "./authSession";
import type { User } from "../types";
const user = {
  id: "staff",
  username: "staff",
  role: "Admin",
  name: "Staff",
} as User;
function fixture({
  token = "saved-token",
  error,
  cache = user,
}: { token?: string | null; error?: any; cache?: User | null } = {}) {
  let cleared = 0,
    persisted = 0;
  const deps = {
    getStoredAuthToken: () => token,
    getStoredUser: () => cache,
    clearAuthSession: () => {
      cleared++;
    },
    fetchAuthMe: async () => {
      if (error) throw error;
      return { success: true, user };
    },
    persistAuthSession: (u: User, t: string) => {
      assert.equal(u, user);
      assert.equal(t, token);
      persisted++;
    },
  };
  return { deps, counts: () => ({ cleared, persisted }) };
}
test("valid saved token restores verified staff and persists session", async () => {
  const f = fixture();
  assert.deepEqual(await restoreAuthSessionUsing(f.deps), {
    user,
    unauthorized: false,
  });
  assert.deepEqual(f.counts(), { cleared: 0, persisted: 1 });
});
for (const status of [401, 403])
  test(`rejected credentials ${status} clear session`, async () => {
    const f = fixture({ error: { status } });
    assert.deepEqual(await restoreAuthSessionUsing(f.deps), {
      user: null,
      unauthorized: true,
    });
    assert.equal(f.counts().cleared, 1);
  });
for (const error of [
  new Error("Offline"),
  { name: "TimeoutError" },
  { status: 503 },
])
  test(`temporary failure ${error.name || error.status} preserves token without trusting cached role`, async () => {
    const f = fixture({ error });
    assert.deepEqual(await restoreAuthSessionUsing(f.deps), {
      user: null,
      unauthorized: false,
      temporaryFailure: true,
    });
    assert.deepEqual(f.counts(), { cleared: 0, persisted: 0 });
  });
test("cached user without token is cleared", async () => {
  const f = fixture({ token: null });
  assert.equal((await restoreAuthSessionUsing(f.deps)).unauthorized, true);
  assert.equal(f.counts().cleared, 1);
});
test("fresh install remains signed out", async () => {
  const f = fixture({ token: null, cache: null });
  assert.deepEqual(await restoreAuthSessionUsing(f.deps), {
    user: null,
    unauthorized: false,
  });
  assert.equal(f.counts().cleared, 0);
});
test("verified session is renewed so an active app stays signed in", async () => {
  const f = fixture();
  let persistedToken = "";
  const deps = { ...f.deps, refreshAuthToken: async () => "renewed-token", persistAuthSession: (_u: User, t: string) => { persistedToken = t; } };
  assert.equal((await restoreAuthSessionUsing(deps)).user, user);
  assert.equal(persistedToken, "renewed-token");
});
test("renewal failure keeps the still-valid saved token", async () => {
  const f = fixture();
  let persistedToken = "";
  const deps = { ...f.deps, refreshAuthToken: async () => { throw Object.assign(new Error("offline"), { status: 503 }); }, persistAuthSession: (_u: User, t: string) => { persistedToken = t; } };
  assert.equal((await restoreAuthSessionUsing(deps)).user, user);
  assert.equal(persistedToken, "saved-token");
});
test("renewal is not attempted when the saved token is rejected", async () => {
  const f = fixture({ error: { status: 401 } });
  let renewals = 0;
  const result = await restoreAuthSessionUsing({ ...f.deps, refreshAuthToken: async () => { renewals++; return "x"; } });
  assert.equal(result.unauthorized, true);
  assert.equal(renewals, 0);
});
