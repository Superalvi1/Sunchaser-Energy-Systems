#!/usr/bin/env node
/**
 * Verify Sprint C inventory foundation workflow.
 * Usage: node scripts/verify-inventory-foundation-local.mjs [API_BASE]
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(root, "..", ".env.local") });

const API = (process.argv[2] || "http://127.0.0.1:3000").replace(/\/$/, "");
let pass = 0;
let fail = 0;
const ok = (l, d) => { pass++; console.log(`PASS: ${l}${d ? ` — ${d}` : ""}`); };
const bad = (l, d) => { fail++; console.log(`FAIL: ${l}${d ? ` — ${d}` : ""}`); };

async function login(username) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123" }),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

function hdr(staff) {
  return {
    "Content-Type": "application/json",
    "X-Sunchaser-User-Id": staff.user.id,
    "X-Sunchaser-Username": staff.user.username,
    "X-Sunchaser-Role": staff.user.role,
  };
}

async function main() {
  console.log(`\nInventory foundation verify — ${API}\n`);
  const staff = await login("allauddin");
  if (!staff.ok) {
    bad("staff login");
    process.exit(1);
  }
  ok("staff login", staff.body.user?.username);
  const H = hdr(staff);

  const sku = `VERIFY-INV-${Date.now()}`;
  const create = await fetch(`${API}/api/admin/inventory/items`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      brand: "VerifyBrand",
      model: "Test Panel",
      sku,
      category: "Solar Panels",
      lowStockThreshold: 5,
      initialStock: 0,
    }),
  });
  const created = await create.json().catch(() => ({}));
  if (!create.ok || !created.id) {
    bad("add inventory item", create.status + " " + (created.error || ""));
    process.exit(1);
  }
  ok("add inventory item", created.id);
  const itemId = created.id;

  const stockIn = await fetch(`${API}/api/admin/inventory/items/${itemId}/stock-in`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ qty: 10, notes: "verify stock in" }),
  });
  const afterIn = await stockIn.json().catch(() => ({}));
  if (!stockIn.ok || afterIn.item?.availableQty !== 10) {
    bad("stock in 10", `available=${afterIn.item?.availableQty}`);
  } else ok("stock in 10", `available=${afterIn.item.availableQty}`);

  const projectId = `proj-verify-${Date.now()}`;
  const reserve = await fetch(`${API}/api/admin/inventory/reservations`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ inventoryItemId: itemId, projectId, qty: 3 }),
  });
  const afterReserve = await reserve.json().catch(() => ({}));
  if (!reserve.ok || afterReserve.item?.availableQty !== 7) {
    bad("reserve 3 → available 7", `available=${afterReserve.item?.availableQty}`);
  } else ok("reserve 3 → available 7");

  const reservationId = afterReserve.reservation?.id;
  if (!reservationId) bad("reservation id missing");
  else {
    const release = await fetch(`${API}/api/admin/inventory/reservations/${reservationId}/release`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ notes: "verify release" }),
    });
    const afterRelease = await release.json().catch(() => ({}));
    if (!release.ok || afterRelease.item?.availableQty !== 10) {
      bad("release 3 → available 10", `available=${afterRelease.item?.availableQty}`);
    } else ok("release 3 → available 10");
  }

  const movements = await fetch(`${API}/api/admin/inventory/movements?inventoryItemId=${itemId}`, { headers: H });
  const movBody = await movements.json().catch(() => ({}));
  const types = (movBody.movements || []).map((m) => m.movementType);
  if (movements.ok && types.includes("stock_in") && types.includes("reserve") && types.includes("release")) {
    ok("movement history", types.join(", "));
  } else {
    bad("movement history", types.join(", ") || movements.status);
  }

  const low = await fetch(`${API}/api/admin/inventory/low-stock`, { headers: H });
  if (low.ok) ok("low stock endpoint");
  else bad("low stock endpoint", low.status);

  const products = await fetch(`${API}/api/state`);
  const state = await products.json().catch(() => ({}));
  if (products.ok && Array.isArray(state.products)) ok("product library /api/state unchanged");
  else bad("product library state");

  console.log(`\n--- ${pass} passed, ${fail} failed ---\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
