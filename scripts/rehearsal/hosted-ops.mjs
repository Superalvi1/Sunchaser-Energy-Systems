#!/usr/bin/env node
import {spawnSync} from "node:child_process";
if(process.env.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||!["rehearsal-postgres.railway.internal","sync-postgres.railway.internal"].includes(process.env.PGHOST))throw new Error("Refusing other target");
const phases={
 stop_drill:"scripts/rehearsal/run-hosted-stop-drill.mjs",
 recovery:"scripts/rehearsal/run-hosted-recovery.mjs",
 demo_factory:"scripts/rehearsal/create-synthetic-demo.mjs",
 demo_seed:"scripts/rehearsal/seed-synthetic-demo.mjs",
 upgrade_core:"scripts/rehearsal/upgrade-hosted-core.mjs",
 core:"scripts/rehearsal/run-hosted-core.mjs",
 storage:"scripts/rehearsal/run-hosted-storage.mjs",
 barrier:"scripts/rehearsal/run-hosted-barrier.mjs",
 tenant:"scripts/rehearsal/run-hosted-tenant.mjs",
};
const phase=process.env.REHEARSAL_PHASE;
if(phase==="idle"){console.log("Hosted rehearsal idle; no work scheduled.");process.exit(0);}
if(!phases[phase])throw new Error("Set an explicitly supported REHEARSAL_PHASE");
const r=spawnSync(process.execPath,["--import","tsx",phases[phase]],{env:process.env,stdio:"inherit"});
process.exitCode=r.status??1;
