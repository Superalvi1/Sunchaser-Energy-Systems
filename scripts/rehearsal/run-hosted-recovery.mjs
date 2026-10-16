#!/usr/bin/env node
import pg from "pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {connectionFromEnv,exportCompany,restoreCompany,verifyArchive} from "../../server/saas/companyBackup.ts";
import {getRailwayObject} from "../../server/storage/railwayObjectStorage.ts";
const e=process.env;
if(e.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||e.PGHOST!=="rehearsal-postgres.railway.internal"||e.PGDATABASE!=="sunchaser_rehearsal")throw new Error("Wrong recovery target");
const db=new pg.Client();await db.connect();await db.query("set time zone 'UTC'");
const lines=[],runId=new Date().toISOString(),ident=s=>'"'+s.replaceAll('"','""')+'"';
const check=(n,ok)=>{const s=(ok?"PASS: ":"FAIL: ")+n;lines.push(s);console.log(s);if(!ok)throw new Error(n);};
async function hash(table,predicate="",params=[]){
 return (await db.query("select count(*)::text n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) digest from public."+ident(table)+" t "+predicate,params)).rows[0];
}
let success=false;
try{
 const {rows:[pick]}=await db.query("select company_id from invoices where company_id like 'rehearsal_alpha_%' group by company_id order by max(created_at) desc limit 1");
 const co=pick?.company_id;check("recovery targets only a synthetic completed-flow company",Boolean(co&&/^rehearsal_alpha_[a-f0-9]{6}$/.test(co)));
 const {rows:tables}=await db.query("select distinct c.table_name from information_schema.columns c join information_schema.tables t using(table_schema,table_name) where c.table_schema='public' and c.column_name='company_id' and t.table_type='BASE TABLE' order by c.table_name");
 const others={};for(const t of tables)others[t.table_name]=await hash(t.table_name,"where company_id is distinct from $1",[co]);
 others.companies=await hash("companies","where id <> $1",[co]);const usersBefore=await hash("users");
 const target={};for(const t of ["customers","leads","quotations","invoices","invoice_items","invoice_payments","projects","customer_documents","activity_logs","document_counters"])target[t]=await hash(t,"where company_id=$1",[co]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"sync-company-recovery-"));fs.chmodSync(dir,0o700);
 const classificationFile=path.resolve("scripts/saas/table-classification.json");
 const opts={client:connectionFromEnv(e,true),companyId:co,outDir:dir,classificationFile,log:()=>{}};
 const manifest=await exportCompany(opts);verifyArchive(dir);
 check("company archive includes database rows and real stored documents",manifest.tables.length>0&&manifest.objects.length>0);
 await db.query("create table if not exists rehearsal_audit.synthetic_export_files(run_id text,path text,body bytea,sha256 text,primary key(run_id,path))");
 for(const rel of ["manifest.json",...Object.keys(manifest.files)]){
  if(rel.split("/").includes(".."))throw new Error("Unexpected export path");
  const body=fs.readFileSync(path.join(dir,rel));
  await db.query("insert into rehearsal_audit.synthetic_export_files values($1,$2,$3,$4)",[runId,rel,body,createHash("sha256").update(body).digest("hex")]);
 }
 check("synthetic export retained privately before damage",true);
 const lead=(await db.query("select id from leads where company_id=$1 order by id limit 1",[co])).rows[0];
 const item=(await db.query("select id from invoice_items where company_id=$1 order by id limit 1",[co])).rows[0];
 check("synthetic damage targets exist",Boolean(lead&&item));
 await db.query("update leads set name='DELIBERATELY DAMAGED SYNTHETIC RECORD' where id=$1 and company_id=$2",[lead.id,co]);
 await db.query("delete from invoice_items where id=$1 and company_id=$2",[item.id,co]);
 check("the damage changes the captured row hashes",JSON.stringify(await hash("leads","where company_id=$1",[co]))!==JSON.stringify(target.leads)&&JSON.stringify(await hash("invoice_items","where company_id=$1",[co]))!==JSON.stringify(target.invoice_items));
 const restored=await restoreCompany({client:connectionFromEnv(e,true),dir,companyId:co,apply:true,classificationFile,log:()=>{}});
 check("restore commits without missing users",restored.applied&&restored.memberships.missingUsers.length===0);
 for(const [t,before] of Object.entries(target))check(t+": restored rows and content match",JSON.stringify(await hash(t,"where company_id=$1",[co]))===JSON.stringify(before));
 let unchanged=true;for(const t of tables)if(JSON.stringify(await hash(t.table_name,"where company_id is distinct from $1",[co]))!==JSON.stringify(others[t.table_name]))unchanged=false;
 check("every other company's rows and content remain identical",unchanged&&JSON.stringify(await hash("companies","where id <> $1",[co]))===JSON.stringify(others.companies));
 check("all global users remain identical",JSON.stringify(await hash("users"))===JSON.stringify(usersBefore));
 for(const o of manifest.objects){const got=await getRailwayObject(o.namespace,o.key);check("restored object bytes match the export",Boolean(got&&createHash("sha256").update(got.body).digest("hex")===o.sha256));}
 success=true;
} catch(err){lines.push("DETAIL: "+String(err.message));console.error("RECOVERY_STOP: "+err.name);process.exitCode=1;}
finally{
 await db.query("insert into rehearsal_audit.evidence(run_id,file_name,content) values($1,'company-recovery.acceptance',$2)",[runId,lines.join("\n")]);
 console.log(JSON.stringify({event:"HOSTED_COMPANY_RECOVERY",result:success?"passed":"failed",checks:lines.filter(x=>x.startsWith("PASS:")).length,runId}));
 await db.end();
}
