#!/usr/bin/env node
// Real hosted API acceptance, synthetic companies only. Never prints credentials or customer records.
import pg from "pg";
import {randomBytes,createHash} from "node:crypto";
const e=process.env,BASE="http://rehearsal-crm.railway.internal:8080",OWNER="u-rehearsal-owner-20261017";
if(e.RAILWAY_PROJECT_ID!=="ea5d5d07-e276-4fa3-85af-320d92dbdcaa"||e.PGHOST!=="rehearsal-postgres.railway.internal"||e.PGDATABASE!=="sunchaser_rehearsal"||!e.TEST_PW)throw new Error("Refusing other target");
const db=new pg.Client();await db.connect();const lines=[];let passed=0;
function check(name,ok,status){lines.push((ok?"PASS: ":"FAIL: ")+name+(status?" ("+status+")":""));console.log(lines.at(-1));if(!ok)throw new Error(name);passed++;}
const json=async r=>r.json().catch(()=>({}));
const request=(token)=>(path,method="GET",body)=>fetch(BASE+path,{method,signal:AbortSignal.timeout(45000),headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function login(username,password){const r=await request()("/api/auth/login","POST",{username,password});const j=await json(r);check("synthetic sign-in",r.status===200&&Boolean(j.token),r.status);return j;}
function miniPdf(text){const body="BT /F1 12 Tf 72 720 Td ("+text+") Tj ET";const objs=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>","<< /Length "+body.length+" >>\nstream\n"+body+"\nendstream","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];let pdf="%PDF-1.4\n",offsets=[0];for(let i=0;i<objs.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+" 0 obj\n"+objs[i]+"\nendobj\n";}const xref=Buffer.byteLength(pdf);pdf+="xref\n0 6\n0000000000 65535 f \n"+offsets.slice(1).map(n=>String(n).padStart(10,"0")+" 00000 n \n").join("")+"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";return Buffer.from(pdf);}
let result="failed";
try{
 const h=await json(await fetch(BASE+"/health"));check("candidate isolation guard is active",h.tenantIsolation?.paused===false);
 await db.query("update users set is_platform_admin=true where id=$1",[OWNER]);
 const op=request((await login("rehearsal_owner",e.TEST_PW)).token);
 check("platform console API", (await op("/api/platform/overview")).status===200);
 const plan=await op("/api/platform/plans/rehearsal_core","PUT",{name:"Synthetic rehearsal only",maxStaff:3,maxLeads:20,maxDocuments:20,maxStorageMb:50,monthlyPricePkr:0});
 check("explicit pilot plan and storage limit",plan.status===200,plan.status);
 const run=randomBytes(3).toString("hex"),companies=[];
 for(const label of ["alpha","beta"]){
  const id="rehearsal_"+label+"_"+run,username="syn_"+label+"_"+run;
  const cr=await op("/api/platform/companies","POST",{id,name:"Rehearsal "+label+" Solar",ownerName:"Synthetic "+label,ownerUsername:username,ownerEmail:username+"@example.test",planId:"rehearsal_core",storageLimitMb:50,trialDays:14});
  const cj=await json(cr);check(label+": normal operator onboarding",cr.status===201&&Boolean(cj.owner?.temporaryPassword),cr.status);
  const user=await db.query("select id from users where username=$1",[username]);
  await db.query("insert into rehearsal_audit.synthetic_rows values('users',$1) on conflict do nothing",[user.rows[0].id]);
  const l=await login(username,cj.owner.temporaryPassword);check(label+": login is bound to its company",l.companyId===id);
  companies.push({id,label,api:request(l.token),tag:label.toUpperCase()+"_"+run});
 }
 for(const c of companies){
  const r=await c.api("/api/company/settings/branding","PUT",{companyName:c.tag+" Solar",officeAddress:"Synthetic demo address"});
  check(c.label+": company branding saved",r.status===200,r.status);
  const lr=await c.api("/api/leads","POST",{name:c.tag+" Synthetic Customer",email:c.tag.toLowerCase()+"@example.test",phone:c.label==="alpha"?"03000000001":"03000000002",leadSource:"Direct/Referral"});
  const lead=await json(lr);check(c.label+": enquiry saved",lr.status<300&&Boolean(lead.id),lr.status);c.lead=lead.id;
  const qr=await c.api("/api/leads/"+c.lead+"/create-quote","POST",{systemSizekW:5,panelCount:10,panelType:"Synthetic panel",inverterType:"Synthetic inverter",batteryCapacity:"None",totalCost:250000,boqItems:[{type:"item",name:c.tag+" Panels",qty:10,unit:"pcs",rate:10000,total:100000},{type:"item",name:c.tag+" Inverter",qty:1,unit:"pcs",rate:150000,total:150000}]});
  check(c.label+": quotation saved",qr.status<300,qr.status);
  c.quoteId=(await db.query("select id from quotations where lead_id=$1 and company_id=$2 order by created_at desc limit 1",[c.lead,c.id])).rows[0]?.id;
  c.quoteDownload="/api/export/pdf/manual-quote/"+c.lead+"/download?quoteId="+encodeURIComponent(c.quoteId);
  const pdf=await c.api(c.quoteDownload);const pdfBytes=Buffer.from(await pdf.arrayBuffer());
  check(c.label+": actual Chromium quotation PDF downloads",pdf.status===200&&pdf.headers.get("content-type")?.includes("application/pdf")&&pdfBytes.length>1000&&pdfBytes.subarray(0,5).toString()==="%PDF-",pdf.status);
  const contract=await c.api("/api/leads/"+c.lead,"PUT",{status:"Contracted"});const cj=await json(contract);
  c.invoice=cj.contractProvision?.invoiceId;c.customer=cj.contractProvision?.customerId;
  check(c.label+": contract creates invoice",contract.status<300&&Boolean(c.invoice),contract.status);
  if(!c.customer)c.customer=(await db.query("select customer_id from leads where id=$1 and company_id=$2",[c.lead,c.id])).rows[0]?.customer_id;
  const pay={amount:100000,paymentMethod:"Cash",paymentDate:new Date().toISOString().slice(0,10),clientRequestId:c.tag+"-partial"};
  const first=await c.api("/api/admin/invoices/"+c.invoice+"/payments","POST",pay);
  const retry=await c.api("/api/admin/invoices/"+c.invoice+"/payments","POST",pay);
  const {rows:[pc]}=await db.query("select count(*)::int n from invoice_payments where invoice_id=$1 and company_id=$2",[c.invoice,c.id]);
  check(c.label+": payment retry counted once",first.status<300&&retry.status<300&&pc.n===1);
  const over=await c.api("/api/admin/invoices/"+c.invoice+"/payments","POST",{...pay,amount:250000,clientRequestId:c.tag+"-over"});
  check(c.label+": overpayment refused",over.status>=400&&over.status<500,over.status);
  const final=await c.api("/api/admin/invoices/"+c.invoice+"/payments","POST",{...pay,amount:150000,clientRequestId:c.tag+"-final"});
  const {rows:[inv]}=await db.query("select paid_amount,balance_due,payment_status,invoice_number from invoices where id=$1 and company_id=$2",[c.invoice,c.id]);
  check(c.label+": final payment leaves zero balance",final.status<300&&Number(inv.paid_amount)===250000&&Number(inv.balance_due)===0&&inv.payment_status==="Paid",final.status);
  c.number=inv.invoice_number;
  const doc=await c.api("/api/export/pdf/invoice/"+c.invoice);const html=await doc.text();
  check(c.label+": invoice document has its own customer and branding",doc.status===200&&html.includes(c.tag+" Synthetic Customer")&&html.includes(c.tag+" Solar"),doc.status);
  const bytes=miniPdf(c.tag+" DOCUMENT");
  const up=await c.api("/api/admin/customer-documents/upload","POST",{customerId:c.customer,documentType:"other",title:c.tag+" file",fileName:c.tag+".pdf",mimeType:"application/pdf",base64Data:bytes.toString("base64"),clientUploadId:c.tag+"-upload"});
  const uj=await json(up);check(c.label+": document uploaded to real bucket",up.status===201&&Boolean(uj.id),up.status);
  const row=(await db.query("select file_url,storage_path from customer_documents where id=$1 and company_id=$2",[uj.id,c.id])).rows[0];
  const url=new URL(uj.fileUrl||row.file_url,BASE);const download=await fetch(BASE+url.pathname+url.search);const got=Buffer.from(await download.arrayBuffer());
  check(c.label+": downloaded bytes match",download.status===200&&createHash("sha256").update(got).digest("hex")===createHash("sha256").update(bytes).digest("hex"),download.status);
  check(c.label+": file uses company prefix",row.storage_path.startsWith("c/"+c.id+"/"));
  c.docPath="/api/company/files/"+url.pathname.split("/api/storage/object/")[1];
 }
 check("companies have independent invoice numbering",companies[0].number===companies[1].number);
 for(const c of companies){const other=companies.find(x=>x!==c);
  for(const path of ["/api/admin/invoices/"+other.invoice,"/api/leads/"+other.lead+"/smart-quote-versions",other.docPath,other.quoteDownload]){
   const r=await c.api(path);check(c.label+": foreign record/file refused",r.status===403||r.status===404,r.status);
  }
  const state=await c.api("/api/state");const sj=await json(state);const leads=sj.leads||[];
  check(c.label+": workspace lists own lead only",state.status===200&&leads.length===1&&leads[0].id===c.lead);
  check(c.label+": cannot open operator console",(await c.api("/api/platform/overview")).status===403);
 }
 result="passed";
} catch(err){console.error("HOSTED_CORE_STOP: "+err.message);process.exitCode=1;}
finally{
 const id=new Date().toISOString();
 await db.query("insert into rehearsal_audit.evidence(run_id,file_name,content) values($1,'core.acceptance',$2)",[id,lines.join("\n")]);
 console.log(JSON.stringify({event:"HOSTED_CORE_ACCEPTANCE",result,passed,runId:id}));
 await db.end();
}
