#!/usr/bin/env node
import pg from "pg";
import {spawnSync} from "node:child_process";
const host="rehearsal-postgres.railway.internal";
const allowedDatabase=process.env.PGDATABASE==="sunchaser_rehearsal"||(process.env.PGDATABASE==="sunchaser_demo"&&process.env.ALLOW_SYNTHETIC_DEMO==="true");
if(process.env.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||process.env.PGHOST!==host||!allowedDatabase)throw new Error("Refusing other target");
if(!process.env.CRM_TENANT_POSTGREST_KEY||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error("Both staging API roles required");
const h=await fetch("http://rehearsal-crm.railway.internal:8080/health");
const health=await h.json();
if(!h.ok||health.tenantIsolation?.paused!==false)throw new Error("Candidate isolation guard not ready");
const db=new pg.Client();await db.connect();
try{
const {rows:[counts]}=await db.query("select count(*)::int n from companies where id <> 'sunchaser'");
if(counts.n!==0)throw new Error("This first activation requires no pilot company");
await db.query("select app.tenancy_enable()");
const run=spawnSync(process.execPath,["scripts/saas/verify-barrier.mjs","--confirm"],{env:{...process.env,VERIFY_PSQL:"-h "+host+" -p 5432 -U rehearsal_owner -d "+process.env.PGDATABASE},encoding:"utf8",maxBuffer:1024*1024});
const id=new Date().toISOString();
for(const [name,body] of [["barrier.stdout",run.stdout||""],["barrier.stderr",run.stderr||""]])await db.query("insert into rehearsal_audit.evidence(run_id,file_name,content) values($1,$2,$3)",[id,name,body]);
for(const l of (run.stdout||"").split("\n"))if(/^(PASS:|FAIL:|Recorded in the database:)/.test(l))console.log(l);
console.log(JSON.stringify({event:"HOSTED_BARRIER_ACCEPTANCE",exitCode:run.status,runId:id}));
process.exitCode=run.status??1;
}finally{await db.end();}
