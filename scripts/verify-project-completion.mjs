#!/usr/bin/env node
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(root, "..", ".env.local") });

const API = (process.env.API_BASE || "https://sunchaser-energy-systems.onrender.com").replace(/\/$/, "");
let pass = 0;
let fail = 0;
const ok = (l, d) => { pass++; console.log(`PASS: ${l}${d ? ` — ${d}` : ""}`); };
const bad = (l, d) => { fail++; console.log(`FAIL: ${l}${d ? ` — ${d}` : ""}`); };

const login = async (u) => {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: "123" }),
  });
  return { ok: res.ok, body: await res.json() };
};

async function main() {
  console.log(`\nProject completion verify — ${API}\n`);
  const admin = await login("allauddin");
  if (!admin.ok) return process.exit(1);
  const hdr = {
    "Content-Type": "application/json",
    "X-Sunchaser-User-Id": admin.body.user.id,
    "X-Sunchaser-Username": admin.body.user.username,
    "X-Sunchaser-Role": admin.body.user.role,
  };

  const gaps = await fetch(`${API}/api/admin/project-completion/gaps`, { headers: hdr });
  if (gaps.ok) ok("admin completion gaps");
  else bad("gaps", gaps.status);

  const deliveries = await fetch(`${API}/api/technical/project-deliveries/me?userId=${admin.body.user.id}&username=${admin.body.user.username}`, { headers: hdr });
  const dBody = await deliveries.json().catch(() => ({}));
  const deliveryId = dBody.deliveries?.[0]?.id;
  if (!deliveryId) {
    console.log("SKIP: no delivery for technician test");
  } else {
    const status = await fetch(`${API}/api/technical/project-deliveries/${deliveryId}/completion-status?userId=${admin.body.user.id}&username=${admin.body.user.username}`, { headers: hdr });
    if (status.ok) ok("completion-status");
    else bad("completion-status", status.status);
  }

  const portal = await login("shafiq");
  if (portal.ok) {
    const w = await fetch(`${API}/api/customer-portal/warranty-handover/me`, {
      headers: {
        "Content-Type": "application/json",
        "X-Sunchaser-User-Id": portal.body.user.id,
        "X-Sunchaser-Username": portal.body.user.username,
      },
    });
    if (w.ok) ok("customer warranty-handover/me");
    else bad("portal handover", w.status);
  }

  console.log(`\n--- ${pass} passed, ${fail} failed ---\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
