#!/usr/bin/env node
// One-shot repair migration rehearsal. Only the isolated restored-copy project is allowed.
import { spawnSync } from "node:child_process";
const host = "rehearsal-postgres.railway.internal";
if (process.env.RAILWAY_PROJECT_ID !== "ea5d5d07-e276-4fa3-85af-320d92dbdcaa" || process.env.PGHOST !== host || process.env.PGDATABASE !== "sunchaser_rehearsal" || process.env.MIGRATE_CONFIRM_HOST !== host) throw new Error("Refusing unconfirmed rehearsal target");
if (!process.env.TEST_PW) throw new Error("Missing synthetic-user password");
const base = "http://rehearsal-crm.railway.internal:8080";
async function smoke(stage) {
 const health = await fetch(base + "/health");
 if (!health.ok) throw new Error("Health failed: " + health.status);
 const login = await fetch(base + "/api/auth/login", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"rehearsal_owner",password:process.env.TEST_PW})});
 const data=await login.json();
 const token=data.token || data.accessToken;
 if (!login.ok || !token) throw new Error("Synthetic login failed: " + login.status);
 for (const path of ["/api/auth/me","/api/admin/invoices","/api/state"]) {
  const res=await fetch(base+path,{headers:{Authorization:"Bearer "+token}});
  if (!res.ok) throw new Error("Read check failed: "+path+" "+res.status);
  await res.arrayBuffer();
 }
 console.log(JSON.stringify({event:"REPAIR_STAGE_READ_SMOKE_PASS",stage}));
}
await smoke("before");
for (const id of ["r1-smart-quote-versions","r2-session-revocation","r3-invoice-payments-integrity","r4-invoice-save-atomic"]) {
 const r=spawnSync(process.execPath,["scripts/migrations/run.mjs","apply","--to",id,"--yes","--allow-remote"],{stdio:"inherit",env:process.env});
 if(r.status!==0) throw new Error("Migration stopped: "+id);
 await new Promise(resolve=>setTimeout(resolve,1500));
 await smoke(id);
}
const verify=spawnSync(process.execPath,["scripts/migrations/run.mjs","verify","--allow-remote"],{stdio:"inherit",env:process.env});
if(verify.status!==0) throw new Error("Ledger verification failed");
console.log("REPAIR_REHEARSAL_PASS: migration and authenticated read checks only; financial writes require separate acceptance");
