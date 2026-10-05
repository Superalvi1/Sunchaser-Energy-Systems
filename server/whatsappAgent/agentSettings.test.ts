import assert from "node:assert/strict";
import {test} from "node:test";
import {defaultAgentSettings,updateAgentSettings,canEnableAgent,loadAgentSettings} from "./agentSettings.ts";
import {canManageSalesAgent} from "./agentRoutes.ts";
const storage={RAILWAY_S3_ENDPOINT:"https://storage.example.test",RAILWAY_S3_BUCKET:"test-bucket",RAILWAY_S3_ACCESS_KEY_ID:"test-key",RAILWAY_S3_SECRET_ACCESS_KEY:"test-secret",RAILWAY_S3_REGION:"auto",RAILWAY_OBJECT_PROXY_SECRET:"test-proxy-secret",APP_PUBLIC_URL:"https://crm.example.test"};
test("missing provider configuration cannot enable outbound replies",()=>{assert.equal(defaultAgentSettings().enabled,false);assert.equal(canEnableAgent({...storage,WHATSAPP_CONVERSATIONS_ENABLED:"true"}),false);assert.equal(canEnableAgent({...storage,WHATSAPP_CONVERSATIONS_ENABLED:"true",GEMINI_API_KEY:"fixture-key",WHATSAPP_SALES_AI_MODEL:"fixture-model"}),true);});
test("only approved administrators manage agent settings and PDF approvals",()=>{for(const role of ["Customer","Salesperson","Technician"]){assert.equal(canManageSalesAgent({role,accountStatus:"Approved"} as any),false);}assert.equal(canManageSalesAgent({role:"Super Admin",accountStatus:"Pending"} as any),false);assert.equal(canManageSalesAgent({role:"Super Admin",accountStatus:"Approved"} as any),true);});
test("settings use conditional writes and reject stale or concurrently changed revisions",async()=>{
 const oldFetch=globalThis.fetch,previous=Object.fromEntries(Object.keys(storage).map(k=>[k,process.env[k]]));Object.assign(process.env,storage);
 let data:any=null,etag='"v1"',conflict=false;const requests:Headers[]=[];
 globalThis.fetch=async(_url,init)=>{if(init?.method==="PUT"){const headers=new Headers(init.headers);requests.push(headers);if(conflict)return new Response("",{status:412});data=JSON.parse(Buffer.from(init.body as any).toString());return new Response("",{status:200});}return data ? new Response(JSON.stringify(data),{status:200,headers:{etag}}) : new Response("",{status:404});};
 try{const first=await updateAgentSettings(0,c=>({...c,businessFacts:"Hours: 9 to 5"}));assert.equal(first.revision,1);assert.equal(requests[0].get("if-none-match"),"*");assert.equal((await loadAgentSettings()).settings.businessFacts,"Hours: 9 to 5");await assert.rejects(updateAgentSettings(0,c=>c),{status:409});conflict=true;await assert.rejects(updateAgentSettings(1,c=>({...c,enabled:true})),{status:409});assert.equal(requests[1].get("if-match"),etag);assert.equal((await loadAgentSettings()).settings.enabled,false);}
 finally{globalThis.fetch=oldFetch;for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
