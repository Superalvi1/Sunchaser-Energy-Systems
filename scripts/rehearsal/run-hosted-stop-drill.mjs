#!/usr/bin/env node
// Bounded (30 minutes), supervised stop/outage drill. Controller toggles only the isolated app variables.
import pg from "pg";
const e=process.env,BASE="http://rehearsal-crm.railway.internal:8080",started=Date.now();
if(e.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||e.PGHOST!=="rehearsal-postgres.railway.internal"||e.PGDATABASE!=="sunchaser_rehearsal"||!e.TEST_PW)throw new Error("Wrong drill target");
const db=new pg.Client();await db.connect();const lines=[];let removed=[],restored=false,success=false;
function check(n,ok){const s=(ok?"PASS: ":"FAIL: ")+n;lines.push(s);console.log(s);if(!ok)throw new Error(n);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function health(){try{const r=await fetch(BASE+"/health",{signal:AbortSignal.timeout(3000)});return r.ok?await r.json():null;}catch{return null;}}
async function waitFor(test){while(Date.now()-started<30*60*1000){const h=await health();if(h&&test(h))return h;await sleep(2000);}throw new Error("Supervised drill timed out");}
async function restoreRows(){if(!removed.length)return;await db.query("set session_replication_role=origin");for(const row of removed)await db.query("insert into companies select (jsonb_populate_record(null::public.companies,$1::jsonb)).* on conflict(id) do nothing",[JSON.stringify(row)]);restored=true;}
try{
 const h=await health();check("drill begins on the working company-aware backend",h?.tenantIsolation?.paused===false);
 const login=await fetch(BASE+"/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"rehearsal_owner",password:e.TEST_PW}),signal:AbortSignal.timeout(15000)});
 const j=await login.json();check("a session is issued before the stop",login.ok&&Boolean(j.token));
 const headers={authorization:"Bearer "+j.token};
 console.log("DRILL_READY_FOR_FLAG_OFF");
 await waitFor(h=>h.tenantIsolation?.paused===true&&h.tenantIsolation.reason!=="unverified");
 let r=await fetch(BASE+"/api/state",{headers,signal:AbortSignal.timeout(10000)});check("flag-off refuses the earlier session with 503",r.status===503);
 const {rows:cos}=await db.query("select to_jsonb(c) j from companies c where id <> 'sunchaser' order by id");
 check("every removable company is synthetic",cos.length>0&&cos.every(x=>/^rehearsal_(alpha|beta)_[a-f0-9]{6}$/.test(x.j.id)));
 removed=cos.map(x=>x.j);const before=JSON.stringify(removed);
 try{
  await db.query("set session_replication_role=replica");
  await db.query("delete from companies where id=any($1::text[])",[removed.map(x=>x.id)]);
  await db.query("set session_replication_role=origin");
  check("only the synthetic company rows were removed",(await db.query("select count(*)::int n from companies where id <> 'sunchaser'")).rows[0].n===0);
  check("the persistent marker survives company-row removal",(await db.query("select app.tenancy_multi() enabled")).rows[0].enabled===true);
  let refused=false;try{await db.query("select app.tenancy_disable()");}catch(err){refused=String(err.message).includes("tables still hold rows");}
  check("marker removal is refused while their data remains",refused);
  r=await fetch(BASE+"/api/state",{headers,signal:AbortSignal.timeout(10000)});check("the backend continues refusing data",r.status===503);
 }finally{await restoreRows();}
 const after=(await db.query("select to_jsonb(c) j from companies c where id <> 'sunchaser' order by id")).rows.map(x=>x.j);
 check("all removed company rows are restored exactly",JSON.stringify(after)===before);
 console.log("DRILL_READY_FOR_DATA_OUTAGE");
 await waitFor(h=>h.tenantIsolation?.paused===true&&h.tenantIsolation.reason==="unverified");
 r=await fetch(BASE+"/api/state",{headers,signal:AbortSignal.timeout(10000)});check("unreachable data API also refuses reads with 503",r.status===503);
 console.log("DRILL_READY_FOR_RESUME");
 await waitFor(h=>h.tenantIsolation?.paused===false);
 r=await fetch(BASE+"/api/auth/me",{headers,signal:AbortSignal.timeout(10000)});check("the earlier session works again after resume",r.status===200);
 r=await fetch(BASE+"/api/state",{headers,signal:AbortSignal.timeout(15000)});check("workspace serving resumes",r.status===200);
 await fetch(BASE+"/api/auth/logout",{method:"POST",headers,signal:AbortSignal.timeout(10000)});
 success=true;
}catch(err){lines.push("DETAIL: "+err.message);console.error("STOP_DRILL_FAILED: "+err.name);process.exitCode=1;}
finally{
 if(removed.length&&!restored)await restoreRows();
 const id=new Date().toISOString();await db.query("insert into rehearsal_audit.evidence(run_id,file_name,content) values($1,'stop-outage-drill.acceptance',$2)",[id,lines.join("\n")]);
 console.log(JSON.stringify({event:"HOSTED_STOP_OUTAGE_DRILL",result:success?"passed":"failed",checks:lines.filter(x=>x.startsWith("PASS:")).length,runId:id}));
 await db.end();
}
