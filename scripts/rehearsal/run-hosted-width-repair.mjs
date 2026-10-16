#!/usr/bin/env node
import pg from "pg";
import {spawnSync} from "node:child_process";
const host="rehearsal-postgres.railway.internal";
if(process.env.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||process.env.PGHOST!==host||process.env.PGDATABASE!=="sunchaser_rehearsal")throw new Error("Refusing other target");
const db=new pg.Client();await db.connect();const lines=[];
const check=(name,ok)=>{const s=(ok?"PASS: ":"FAIL: ")+name;lines.push(s);console.log(s);if(!ok)throw new Error(name);};
async function number(floor,width){
 await db.query("begin");
 try{
  await db.query("select public.document_counter_set_floor('sunchaser','invoice','2999',$1::bigint)",[floor]);
  await db.query("set local role crm_tenant");
  await db.query("select set_config('request.headers',$1,true)",[JSON.stringify({"x-company-id":"sunchaser"})]);
  return (await db.query("select public.next_document_number('invoice','INV','2999',$1::int) n",[width])).rows[0].n;
 }finally{await db.query("rollback");}
}
const run=args=>{const r=spawnSync(process.execPath,args,{env:process.env,stdio:"inherit"});if(r.status!==0)throw new Error("Stopped child: "+args[0]);};
let success=false;
try{
 check("the transaction-only probe period is unused",(await db.query("select count(*)::int n from document_counters where period='2999'")).rows[0].n===0);
 const before=await number("9999",4);
 check("negative control reproduces old truncated 10000",before==="INV-2999-1000");
 run(["scripts/migrations/run.mjs","apply","--to","t9-document-number-width","--yes","--allow-remote"]);
 for(const [floor,width,expected] of [
  ["0",4,"0001"],["8",4,"0009"],["998",4,"0999"],["9998",4,"9999"],["9999",4,"10000"],["10000",4,"10001"],["100000",4,"100001"],
  ["8",1,"9"],["9",1,"10"],["999999999",9,"1000000000"],["9007199254740991",4,"9007199254740992"]
 ])check("tenant-role formatter preserves "+expected+" at padding "+width,await number(floor,width)==="INV-2999-"+expected);
 let invalid=false;try{await number("0",10);}catch(err){invalid=err.code==="PT400";}
 check("invalid padding remains refused",invalid);
 await db.query("begin");let missing=false;
 try{
  await db.query("set local role crm_tenant");await db.query("select set_config('request.headers','{}',true)");
  await db.query("select public.next_document_number('invoice','INV','2999',4)");
 }catch(err){missing=err.code==="PT403";}finally{await db.query("rollback");}
 check("missing tenant context remains refused",missing);
 await db.query("begin");let anon=false;
 try{await db.query("set local role anon");await db.query("select public.next_document_number('invoice','INV','2999',4)");}
 catch(err){anon=err.code==="42501";}finally{await db.query("rollback");}
 check("anonymous role still cannot execute numbering",anon);
 check("transaction-only tests left no counter",(await db.query("select count(*)::int n from document_counters where period='2999'")).rows[0].n===0);
 run(["scripts/migrations/run.mjs","verify","--allow-remote"]);
 success=true;
}finally{
 await db.query("insert into rehearsal_audit.evidence(run_id,file_name,content) values($1,'number-width.acceptance',$2)",[new Date().toISOString(),lines.join("\n")]);
 await db.end();
}
if(success){
 run(["scripts/migrations/run.mjs","rollback","--to","t1-company-foundation","--yes","--allow-remote"]);
 run(["scripts/rehearsal/run-hosted-tenant.mjs"]);
}
