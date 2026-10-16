#!/usr/bin/env node
// Execute and retain the restored-copy rehearsal evidence in its private audit schema.
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
const host="rehearsal-postgres.railway.internal";
if(process.env.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||process.env.PGHOST!==host||process.env.PGDATABASE!=="sunchaser_rehearsal")throw new Error("Refusing other target");
const dir="/tmp/hosted-saas-evidence";
const run=spawnSync("bash",["scripts/rehearsal/run-hosted-saas-rehearsal.sh"],{encoding:"utf8",env:{...process.env,RESTORE_PGHOST:host,RESTORE_PGPORT:"5432",RESTORE_PGUSER:process.env.PGUSER,RESTORE_PGPASSWORD:process.env.PGPASSWORD,RESTORE_DB:process.env.PGDATABASE,REHEARSAL_DIR:dir,REHEARSAL_REMOTE_CONFIRM:host},maxBuffer:20*1024*1024});
const db=new pg.Client();await db.connect();
try {
 await db.query("create table if not exists rehearsal_audit.evidence(run_id text,file_name text,content text,created_at timestamptz default now(),primary key(run_id,file_name))");
 const id=new Date().toISOString();
 const files=[["stdout",run.stdout||""],["stderr",run.stderr||""]];
 if(fs.existsSync(dir+"/saas"))for(const name of fs.readdirSync(dir+"/saas"))if(fs.statSync(path.join(dir,"saas",name)).isFile())files.push([name,fs.readFileSync(path.join(dir,"saas",name),"utf8")]);
 for(const [name,body] of files)await db.query("insert into rehearsal_audit.evidence(run_id,file_name,content) values($1,$2,$3)",[id,name,body]);
 for(const line of (run.stdout||"").split("\n"))if(/^(PASS:|FAIL:|==|SaaS rehearsal:)/.test(line))console.log(line);
 console.log(JSON.stringify({event:"HOSTED_TENANT_REHEARSAL",exitCode:run.status,evidenceFiles:files.length,runId:id}));
}finally{await db.end();}
process.exitCode=run.status??1;
