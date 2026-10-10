// Link the synthetic portal user to the journey customer through the CRM's admin linking endpoint.
import fs from "node:fs";
import { STATE, BASE, apiLogin, check, save } from "./lib.mjs";
const ids = JSON.parse(fs.readFileSync(`${STATE}/j6-ids.json`, "utf8"));
const admin = await apiLogin("t_admin");
const r = await fetch(`${BASE}/api/admin/customer-linking/link`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${admin}` }, body: JSON.stringify({ customerId: ids.customerId, userId: "u-test-portal-a", confirmOverride: true }) });
check("Portal user linked to the client through the admin linking tool", r.ok, `${r.status} ${(await r.text()).slice(0, 160)}`);
save(`${STATE}/link-results.json`);
