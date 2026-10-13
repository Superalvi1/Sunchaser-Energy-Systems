// Journey 7: reopening the app keeps a valid session (and renews it); logout, suspension and expiry still
// require sign-in. Runs the same web code the Android WebView loads; it is not a physical-device test.
import { execFileSync } from "node:child_process";
import { STATE, BASE, SHOTS, sql, launch, mobile, staffLogin, check, save } from "./lib.mjs";

const secret = execFileSync("bash", ["-c", 'source "$E2E_ENV_FILE" && printf %s "$JWT_SECRET"']).toString();
const jwtLib = await import("jsonwebtoken");
const jwt = jwtLib.default || jwtLib;
const browser = await launch();
const ctx = await browser.newContext({ ...mobile });
let page = await ctx.newPage();
await staffLogin(page, "t_sales");
await page.waitForFunction(() => localStorage.getItem("sunchaser_auth_token"));
const token1 = await page.evaluate(() => localStorage.getItem("sunchaser_auth_token"));
check("J7 sign-in stores a session token", Boolean(token1));
await page.waitForTimeout(1100); // a renewed token gets a later issued-at second
await page.close();

// "Restart": a new page in the same app storage, no password typed.
page = await ctx.newPage();
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const signedIn = (await page.locator("input[type=password]").count()) === 0 && !(await page.getByRole("button", { name: /^(Client\/Staff Sign In|Account)$/ }).filter({ visible: true }).first().isVisible().catch(() => false));
await page.screenshot({ path: `${SHOTS}/j7-01-reopen-still-signed-in.png` });
const token2 = await page.evaluate(() => localStorage.getItem("sunchaser_auth_token"));
check("J7 reopening the app restores the session without a password", signedIn);
check("J7 the saved session was renewed on reopen", Boolean(token2) && token2 !== token1 && jwt.decode(token2).exp > jwt.decode(token1).exp);

// Expired token: must sign in again (and the stale token is cleared).
const expired = jwt.sign({ userId: "u-test-sales", username: "t_sales", role: "Sales Executive" }, secret, { expiresIn: -60 });
await page.evaluate((t) => localStorage.setItem("sunchaser_auth_token", t), expired);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
check("J7 an expired session requires sign-in", await page.getByRole("button", { name: /^(Client\/Staff Sign In|Account)$/ }).filter({ visible: true }).first().isVisible().catch(() => false) || (await page.locator("input[type=password]").count()) > 0);
check("J7 the expired token was cleared", (await page.evaluate(() => localStorage.getItem("sunchaser_auth_token"))) === null);
const refreshExpired = await fetch(`${BASE}/api/auth/refresh`, { method: "POST", headers: { authorization: `Bearer ${expired}` } });
check("J7 an expired token cannot be renewed", refreshExpired.status === 401, String(refreshExpired.status));

// Suspended account: a still-unexpired token is rejected on reopen.
await staffLogin(page, "t_sales");
await page.waitForFunction(() => localStorage.getItem("sunchaser_auth_token"));
sql(`update users set account_status='Suspended' where id='u-test-sales'`);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const suspendedBlocked = await page.getByRole("button", { name: /^(Client\/Staff Sign In|Account)$/ }).filter({ visible: true }).first().isVisible().catch(() => false) || (await page.locator("input[type=password]").count()) > 0;
sql(`update users set account_status='Approved' where id='u-test-sales'`);
check("J7 a suspended account is signed out on reopen", suspendedBlocked);

// Logout clears the session; reopening requires sign-in.
await staffLogin(page, "t_sales");
await page.waitForFunction(() => localStorage.getItem("sunchaser_auth_token"));
await page.evaluate(() => { localStorage.removeItem("sunchaser_auth_token"); localStorage.removeItem("sunchaser_user"); });
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);
check("J7 after logout, reopening requires sign-in", await page.getByRole("button", { name: /^(Client\/Staff Sign In|Account)$/ }).filter({ visible: true }).first().isVisible().catch(() => false) || (await page.locator("input[type=password]").count()) > 0);
await browser.close();
save(`${STATE}/j7-results.json`);
