#!/usr/bin/env node
import pg from "pg";
import {spawnSync} from "node:child_process";
if(process.env.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||process.env.PGHOST!=="rehearsal-postgres.railway.internal"||process.env.RAILWAY_S3_BUCKET!=="saas-rehearsal-files-wk43kc")throw new Error("Refusing other rehearsal target");
const run=spawnSync(process.execPath,["--import","tsx","scripts/saas/staging/storage-check.mjs","--objects","1100","--sequential","25"],{env:process.env,encoding:"utf8",maxBuffer:10*1024*1024});
const db=new pg.Client();await db.connect();
try{
await db.query("create table if not exists rehearsal_audit.evidence(run_id text,file_name text,content text,created_at timestamptz default now(),primary key(run_id,file_name))");
const id=new Date().toISOString();
for(const [name,body] of [["storage.stdout",run.stdout||""],["storage.stderr",run.stderr||""]])await db.query("insert into rehearsal_audit.evidence(run_id,file_name,content) values($1,$2,$3)",[id,name,body]);
for(const line of (run.stdout||"").split("\n"))if(/^(PASS:|FAIL:|OBSERVED:)/.test(line))console.log(line);
console.log(JSON.stringify({event:"REAL_STORAGE_ACCEPTANCE",exitCode:run.status,runId:id}));
}finally{await db.end();}
process.exitCode=run.status??1;
