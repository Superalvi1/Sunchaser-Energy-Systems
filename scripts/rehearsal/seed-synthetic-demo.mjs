#!/usr/bin/env node
import pg from "pg";
import {randomBytes,scryptSync} from "node:crypto";
const e=process.env,BASE="http://rehearsal-crm.railway.internal:8080";
if(e.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||e.PGHOST!=="sync-postgres.railway.internal"||e.PGDATABASE!=="sunchaser_demo"||e.ALLOW_SYNTHETIC_DEMO!=="true")throw new Error("Refusing other demo target");
for(const k of ["DEMO_OPERATOR_PW","DEMO_OWNER_PW","DEMO_OTHER_PW"])if(!e[k]||e[k].length<24)throw new Error("Fresh demo password missing");
const db=new pg.Client();await db.connect();
const call=t=>(p,m="GET",b)=>fetch(BASE+p,{method:m,signal:AbortSignal.timeout(45000),headers:{"content-type":"application/json",...(t?{authorization:"Bearer "+t}:{})},...(b===undefined?{}:{body:JSON.stringify(b)})});
async function json(r){const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error("Demo API request refused: "+r.status);return j;}
async function login(u,p){const j=await json(await call()("/api/auth/login","POST",{username:u,password:p}));if(!j.token)throw new Error("Demo login token missing");return call(j.token);}
function hash(p){const salt=randomBytes(16);return "s1:"+salt.toString("hex")+":"+scryptSync(p,salt,64).toString("hex");}
function miniPdf(text){const body="BT /F1 12 Tf 72 720 Td ("+text+") Tj ET";const objs=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>","<< /Length "+body.length+" >>\nstream\n"+body+"\nendstream","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];let pdf="%PDF-1.4\n",offsets=[0];for(let i=0;i<objs.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+" 0 obj\n"+objs[i]+"\nendobj\n";}const xref=Buffer.byteLength(pdf);pdf+="xref\n0 6\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";return Buffer.from(pdf);}

try{
 const h=await json(await fetch(BASE+"/health"));if(h.tenantIsolation?.paused!==false)throw new Error("Demo guard not ready");
 if((await db.query("select count(*)::int n from companies where id <> 'sunchaser'")).rows[0].n!==0)throw new Error("Refusing to seed over existing companies");
 const op=await login("sync_operator",e.DEMO_OPERATOR_PW);
 await json(await op("/api/platform/plans/demo_only","PUT",{name:"Demonstration — sample data only",maxStaff:3,maxLeads:100,maxDocuments:50,maxStorageMb:50,monthlyPricePkr:0}));
 const owners={};
 for(const c of [{id:"demo_solar",name:"Demo Solar — Sunchaser Sync",username:"demo_owner",pw:e.DEMO_OWNER_PW},{id:"demo_other",name:"Separate Demo Company",username:"demo_other_owner",pw:e.DEMO_OTHER_PW}]){
  const created=await json(await op("/api/platform/companies","POST",{id:c.id,name:c.name,ownerName:"Demonstration Administrator",ownerUsername:c.username,ownerEmail:c.username+"@example.test",planId:"demo_only",storageLimitMb:50,trialDays:365}));
  if(!created.owner?.temporaryPassword)throw new Error("Normal onboarding did not finish");
  const {rows:[u]}=await db.query("select id from users where username=$1",[c.username]);
  await db.query("update users set password=$1,onboarding_completed=true where id=$2",[hash(c.pw),u.id]);
  await db.query("insert into saas_audit(actor_user_id,actor_username,action,company_id,detail) values('demo-operator-20261016','sync_operator','demo.credentials_set',$1,$2::jsonb)",[c.id,JSON.stringify({userId:u.id,synthetic:true})]);
  const api=await login(c.username,c.pw);owners[c.id]=api;
  await json(await api("/api/company/settings/branding","PUT",{companyName:c.name,officeAddress:"Demonstration only — no real customer address"}));
  await json(await api("/api/company/settings/bank-accounts","PUT",{accounts:[]}));
  await json(await api("/api/company/settings/terms","PUT",{terms:["Demonstration only. Prices are illustrative.","This is not a payment request or commercial offer."]}));
  await json(await api("/api/company/settings/prices","PUT",{currencySettings:"PKR (Rs.)",quoteValidityDays:7}));
 }
 const api=owners.demo_solar;
 const lead=await json(await api("/api/leads","POST",{name:"Demo Customer A — 5 kW example",email:"customer-a@example.test",phone:"03000000001",leadSource:"Direct/Referral",address:"Demo site — sample data"}));
 await json(await api("/api/leads/"+lead.id+"/create-quote","POST",{systemSizekW:5,panelCount:10,panelType:"Example solar panel",inverterType:"Example 5 kW inverter",batteryCapacity:"None",totalCost:350000,termsAndConditions:"Demonstration only — not a payment request.",boqItems:[{type:"item",name:"Example solar panels",qty:10,unit:"pcs",rate:20000,total:200000},{type:"item",name:"Example 5 kW inverter",qty:1,unit:"pcs",rate:150000,total:150000}]}));
 const contracted=await json(await api("/api/leads/"+lead.id,"PUT",{status:"Contracted"}));
 const inv=contracted.contractProvision?.invoiceId,cust=contracted.contractProvision?.customerId;
 if(!inv||!cust)throw new Error("Demo invoice was not created");
 await json(await api("/api/admin/invoices/"+inv+"/payments","POST",{amount:100000,paymentMethod:"Cash",paymentDate:new Date().toISOString().slice(0,10),clientRequestId:"demo-seed-partial-20261016"}));
 const invoice=(await db.query("select invoice_number,grand_total,paid_amount,balance_due from invoices where id=$1 and company_id='demo_solar'",[inv])).rows[0];
 if(Number(invoice.grand_total)!==350000||Number(invoice.paid_amount)!==100000||Number(invoice.balance_due)!==250000)throw new Error("Demo balances do not match");
 for(const [i,name] of [[2,"Demo Customer B — follow-up"],[3,"Demo Customer C — new enquiry"]])await json(await api("/api/leads","POST",{name,email:"customer-"+i+"@example.test",phone:"0300000000"+i,leadSource:"Direct/Referral"}));
 await json(await owners.demo_other("/api/leads","POST",{name:"Other company's sample enquiry",email:"separate@example.test",phone:"03000000004",leadSource:"Direct/Referral"}));
 const pdf=miniPdf("SUNCHASER SYNC DEMONSTRATION ONLY - INSTALLATION CHECKLIST");
 await json(await api("/api/admin/customer-documents/upload","POST",{customerId:cust,documentType:"other",title:"Demo installation checklist",fileName:"demo-checklist.pdf",mimeType:"application/pdf",base64Data:pdf.toString("base64"),clientUploadId:"demo-checklist-20261016"}));
 const state=await json(await api("/api/state"));
 if((state.leads||[]).length!==3||JSON.stringify(state.leads||[]).includes("Other company's"))throw new Error("Demo workspace isolation failed");
 const foreign=await owners.demo_other("/api/admin/invoices/"+inv);
 if(![403,404].includes(foreign.status))throw new Error("Demo invoice crossed company boundary");
 const report={event:"SYNTHETIC_DEMO_READY",primaryCompany:"demo_solar",username:"demo_owner",otherCompany:"demo_other",invoiceNumber:invoice.invoice_number,total:350000,paid:100000,balance:250000,leads:3,documents:1};
 await db.query("insert into rehearsal_audit.evidence(run_id,file_name,content) values($1,'demo-seed.json',$2)",[new Date().toISOString(),JSON.stringify(report)]);
 console.log(JSON.stringify(report));
}finally{await db.end();}
