// Journey 9b: the real SPA logout button (the same web code the Android WebView loads) revokes the session on the
// server BEFORE clearing local storage, and still signs out locally when the network is down.
// Requires the stack from README.md with the web build served by the app (VITE_API_BASE_URL= npx vite build).
import { STATE, BASE, SHOTS, launch, mobile, staffLogin, check, save } from "./lib.mjs";

const browser = await launch();
const loginVisible = (page) =>
  page.getByRole("button", { name: /^(Client\/Staff Sign In|Account)$/ }).filter({ visible: true }).first().isVisible().catch(() => false);

async function logoutButton(page) {
  const direct = page.locator('button[title="Logout Session"]').filter({ visible: true }).first();
  if (await direct.count()) return direct;
  return page.getByRole("button", { name: /log ?out|sign out/i }).filter({ visible: true }).first();
}

// 1. Online logout: the request is sent while the token is still in storage; afterwards the old token is dead.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await staffLogin(page, "t_sales");
  const token = await page.evaluate(() => localStorage.getItem("sunchaser_auth_token"));
  let tokenPresentWhenSent = null;
  let authHeaderMatches = false;
  await page.route("**/api/auth/logout", async (route) => {
    tokenPresentWhenSent = await page.evaluate(() => localStorage.getItem("sunchaser_auth_token") !== null);
    authHeaderMatches = route.request().headers()["authorization"] === `Bearer ${token}`;
    await route.continue();
  });
  const sent = page.waitForRequest("**/api/auth/logout", { timeout: 15000 }).catch(() => null);
  await (await logoutButton(page)).click();
  const req = await sent;
  await page.waitForFunction(() => !localStorage.getItem("sunchaser_auth_token"), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/j9-01-after-logout.png` });
  check("J9b the logout button calls POST /api/auth/logout", Boolean(req) && req.method() === "POST");
  check("J9b the request was sent BEFORE local storage was cleared, carrying the session token", tokenPresentWhenSent === true && authHeaderMatches, JSON.stringify({ tokenPresentWhenSent, authHeaderMatches }));
  check("J9b local session is cleared and the sign-in screen is shown", (await loginVisible(page)) || (await page.locator("input[type=password]").count()) > 0);
  const reuse = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  check("J9b the copied token no longer works on the server (401)", reuse.status === 401, String(reuse.status));
  await ctx.close();
}

// 2. Offline logout: the network call fails, local state is still cleared, no error is shown.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await staffLogin(page, "t_sales");
  const token = await page.evaluate(() => localStorage.getItem("sunchaser_auth_token"));
  await page.route("**/api/auth/logout", (route) => route.abort("internetdisconnected"));
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await (await logoutButton(page)).click();
  await page.waitForFunction(() => !localStorage.getItem("sunchaser_auth_token"), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/j9-02-offline-logout.png` });
  const text = await page.locator("body").innerText();
  check("J9b offline: local session still cleared", (await page.evaluate(() => localStorage.getItem("sunchaser_user"))) === null);
  check("J9b offline: nothing scary shown (no dialog, no error text)", dialogs.length === 0 && !/error|failed|could not/i.test(text), JSON.stringify({ dialogs, sample: text.slice(0, 120) }));
  const stillLive = await fetch(`${BASE}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  check("J9b offline: the server was not reached, so that token is still valid until it expires (documented limit)", stillLive.status === 200, String(stillLive.status));
  await ctx.close();
}

await browser.close();
save(`${STATE}/j9-browser-results.json`);
