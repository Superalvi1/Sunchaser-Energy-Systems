#!/usr/bin/env node
// Create a NEW synthetic-only demo database from schema, never customer data.
import pg from "pg";
import {spawnSync} from "node:child_process";
import {randomBytes,scryptSync,createHash} from "node:crypto";
const e=process.env,SOURCE="sunchaser_rehearsal",DEMO="sunchaser_demo";
if(e.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||e.PGHOST!=="rehearsal-postgres.railway.internal"||e.PGDATABASE!==SOURCE||e.ALLOW_DEMO_BOOTSTRAP!=="schema-only-no-customer-data")throw new Error("Refusing unconfirmed demo factory target");
if(!e.DEMO_OPERATOR_PW||e.DEMO_OPERATOR_PW.length<24||!e.NEXT_AUTH_PASSWORD||!/^[a-f0-9]{64}$/.test(e.NEXT_AUTH_PASSWORD))throw new Error("Fresh demo credentials are required");
const source=new pg.Client();await source.connect();
const ident=s=>'"'+s.replaceAll('"','""')+'"';
let demo;
try{
 if((await source.query("select 1 from pg_database where datname=$1",[DEMO])).rowCount)throw new Error("Demo database already exists; refusing to replace it");
 const dump=spawnSync("pg_dump",["--schema-only","--no-owner","--no-privileges","--schema=public","--schema=app","--dbname="+SOURCE],{env:e,encoding:"utf8",maxBuffer:30*1024*1024});
 if(dump.status!==0||!dump.stdout.includes("CREATE TABLE public.users"))throw new Error("Schema-only dump failed");
 if(/^COPY public\./m.test(dump.stdout))throw new Error("Refusing unexpected table data in schema export");
 await source.query("create database "+ident(DEMO)+" template template0");
 demo=new pg.Client({database:DEMO});await demo.connect();
 if(/CREATE SCHEMA public;/.test(dump.stdout))await demo.query("drop schema public");
 const restored=spawnSync("psql",["-X","-v","ON_ERROR_STOP=1","--single-transaction","--dbname="+DEMO],{env:e,input:dump.stdout,encoding:"utf8",maxBuffer:10*1024*1024});
 if(restored.status!==0)throw new Error("New demo schema restore failed (the new database is retained privately)");
 for(const t of ["users","customers","leads","quotations","invoices","invoice_payments","customer_documents"])
  if(Number((await demo.query("select count(*) n from public."+ident(t))).rows[0].n)!==0)throw new Error("Unexpected data after schema-only restore: "+t);
 // Only built-in, shared role definitions are configuration. No users, contacts, prices or settings are copied.
 const roles=(await source.query("select * from public.roles where company_id is null and is_system=true order by id")).rows;
 const roleIds=roles.map(r=>r.id);
 const permissions=roleIds.length?(await source.query("select * from public.role_permissions where company_id is null and role_id::text=any($1::text[])",[roleIds])).rows:[];
 for(const [table,rows] of [["roles",roles],["role_permissions",permissions]])for(const row of rows){
  const cols=Object.keys(row);await demo.query("insert into public."+ident(table)+"("+cols.map(ident).join(",")+") values("+cols.map((_,i)=>"$"+(i+1)).join(",")+")",cols.map(k=>row[k]));
 }
 const salt=randomBytes(16),hash="s1:"+salt.toString("hex")+":"+scryptSync(e.DEMO_OPERATOR_PW,salt,64).toString("hex");
 await demo.query("insert into users(id,username,password,name,email,role,onboarding_completed,account_status,email_verified,is_platform_admin) values($1,'sync_operator',$2,'Sunchaser Sync Demo Operator','operator@example.test','Super Admin',true,'Approved',true,true)",["demo-operator-20261016",hash]);
 await demo.query("create schema if not exists app; create table if not exists app.config(key text primary key,value text not null)");
 const floorKey="document_floor.sunchaser.invoice."+new Date().getUTCFullYear();
 await demo.query("insert into app.config(key,value) values($1,'0') on conflict(key) do update set value=excluded.value",[floorKey]);
 await demo.query("grant usage on schema public to service_role; grant all on all tables in schema public to service_role; grant usage,select on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role");
 const childEnv={...e,PGDATABASE:DEMO,MIGRATE_CONFIRM_HOST:e.PGHOST};
 for(const args of [["apply","--yes"],["verify"]]){
  const r=spawnSync(process.execPath,["scripts/migrations/run.mjs",...args,"--allow-remote"],{env:childEnv,stdio:"inherit"});
  if(r.status!==0)throw new Error("Demo migration "+args[0]+" failed");
 }
 await demo.query("create schema if not exists rehearsal_audit; revoke all on schema rehearsal_audit from public; create table if not exists rehearsal_audit.evidence(run_id text,file_name text,content text,created_at timestamptz default now(),primary key(run_id,file_name))");
 const clean={};
 for(const t of ["customers","leads","quotations","invoices","invoice_payments","customer_documents"])clean[t]=Number((await demo.query("select count(*) n from public."+ident(t))).rows[0].n);
 if(Object.values(clean).some(n=>n!==0))throw new Error("Unexpected customer data after demo migrations");
 // Rotation happens last. The operator must next point the isolated API to the new demo database with this fresh password.
 await source.query("alter role authenticator password '"+e.NEXT_AUTH_PASSWORD+"'");
 const report={event:"SYNTHETIC_ONLY_DEMO_DATABASE_CREATED",database:DEMO,schemaSha256:createHash("sha256").update(dump.stdout).digest("hex"),builtInRoles:roles.length,permissions:permissions.length,users:1,customerTables:clean};
 await source.query("insert into rehearsal_audit.evidence(run_id,file_name,content) values($1,'demo-bootstrap.json',$2)",[new Date().toISOString(),JSON.stringify(report)]);
 console.log(JSON.stringify(report));
}finally{if(demo)await demo.end();await source.end();}
