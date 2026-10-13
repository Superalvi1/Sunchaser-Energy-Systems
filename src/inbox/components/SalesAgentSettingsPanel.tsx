import { useEffect, useState } from "react";
import { authorizedFetch } from "../../services/api";
import type { SalesAgentSettings } from "../../../server/whatsappAgent/agentSettings";

async function request(path: string, method = "GET", body?: unknown) {
  const response = await authorizedFetch(`/api/whatsapp-agent${path}`, { method, ...(body ? {body:JSON.stringify(body)} : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed. Please retry.");
  return result;
}
const control = "w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm";
export default function SalesAgentSettingsPanel() {
  const [settings,setSettings] = useState<SalesAgentSettings | null>(null);
  const [readiness,setReadiness] = useState<Record<string,boolean>>({});
  const [providers,setProviders]=useState<{id:string;keyName:string;configured:boolean}[]>([]);
  const [error,setError] = useState("");
  const [status,setStatus] = useState("");
  const [busy,setBusy] = useState(false);
  const [file,setFile] = useState<File | null>(null);
  const [title,setTitle] = useState("");
  const [description,setDescription] = useState("");
  const [capacity,setCapacity] = useState(10);
  const [expiry,setExpiry] = useState("");
  const [approved,setApproved] = useState(false);
  const load = async () => { setBusy(true); setError(""); try {const result=await request("/settings");setSettings(result.settings);setReadiness(result.readiness);if(result.providers)setProviders(result.providers);} catch(e) {setError((e as Error).message);} finally {setBusy(false);} };
  useEffect(()=>{let active=true; request("/settings").then(r=>{if(active){setSettings(r.settings);setReadiness(r.readiness);if(r.providers)setProviders(r.providers);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  const mutate = async (path:string,method:string,body:unknown) => {
    setBusy(true);setError("");setStatus("");
    try {const result=await request(path,method,body);setSettings(result.settings);if(result.readiness)setReadiness(result.readiness);if(result.providers)setProviders(result.providers);setStatus("Saved successfully.");return true;}
    catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}
  };
  const testConnection=async()=>{if(!settings)return;setBusy(true);setError("");setStatus("");try{const result=await request("/test-connection","POST",{provider:settings.provider,model:settings.model});setStatus(`Connection successful: ${result.reply}`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const upload = async () => {
    if(!file || !settings) return;
    setBusy(true);setError("");
    try {
      if(file.size > 10*1024*1024) throw new Error("Choose a PDF up to 10 MB.");
      const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("Could not read the PDF. Choose it again."));reader.readAsDataURL(file);});
      const saved=await mutate("/quotations","POST",{title,description,capacityKw:capacity,expiresAt:expiry ? new Date(`${expiry}T23:59:59+05:00`).toISOString() : "",approved,pdfBase64:base64,revision:settings.revision});
      if(saved){setFile(null);setTitle("");setDescription("");setApproved(false);}
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  return <section aria-busy={busy} className="space-y-4 rounded-xl border border-neutral-700 bg-neutral-950 p-4" aria-label="AI sales agent">
    <h3 className="font-semibold">AI sales agent</h3>
    <p className="text-sm text-neutral-400">Reply to new WhatsApp enquiries, share approved quotations, and prepare Smart Quote estimates after the client confirms their equipment. Staff replies take over the conversation.</p>
    {error && <p role="alert" className="text-sm text-red-300">{error} <button type="button" disabled={busy} onClick={()=>void load()} className="underline">Refresh and retry</button></p>}
    {status && <p role="status" className="text-sm text-emerald-300">{status}</p>}
    {!settings ? <p role="status">{error ? "Agent settings could not load." : "Loading agent settings…"}</p> : <>
      <ul className="text-xs text-neutral-400">{Object.entries({providerConfigured:"Selected provider API key",modelConfigured:"AI model",storageConfigured:"Document storage",whatsappEnabled:"WhatsApp inbox",autonomousSendApproved:"Owner approval for unsupervised sending (WHATSAPP_SALES_AGENT_AUTONOMOUS_SEND)"}).map(([key,label])=><li key={key}>{label}: {readiness[key] ? "Configured" : "Missing"}</li>)}</ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">AI provider<select className={control} disabled={busy} value={settings.provider || "gemini"} onChange={e=>{const provider=e.target.value as NonNullable<SalesAgentSettings["provider"]>;setSettings({...settings,provider,model:"",enabled:false});setReadiness({...readiness,providerConfigured:Boolean(providers.find(p=>p.id===provider)?.configured),modelConfigured:false});setStatus("");}}>{[["gemini","Gemini"],["openai","OpenAI"],["grok","Grok (xAI)"],["claude","Claude"]].map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label className="text-sm">Model ID<input className={control} disabled={busy} maxLength={120} value={settings.model || ""} placeholder="Exact model ID from your provider console" onChange={e=>{setSettings({...settings,model:e.target.value,enabled:false});setReadiness({...readiness,modelConfigured:Boolean(e.target.value.trim())});setStatus("");}}/></label>
      </div>
      <p className="text-sm text-neutral-400">Connection: provider API key. Your normal chat subscription login is not connected. Verify API billing with your provider before enabling customer replies.</p>
      {!readiness.providerConfigured && <p className="text-sm text-amber-300">Add {providers.find(p=>p.id===(settings.provider || "gemini"))?.keyName || "the provider API key"} in Railway service variables. Keep the key out of chat and quotations.</p>}
      <button type="button" disabled={busy || !readiness.providerConfigured || !readiness.modelConfigured} className="rounded border border-neutral-700 px-4 py-2 text-sm disabled:opacity-50" onClick={()=>void testConnection()}>Test AI connection</button>
      <p className="text-xs text-neutral-400">The test uses one provider request with a sample enquiry. It does not send a WhatsApp message.</p>
      <label className="block text-sm"><input type="checkbox" disabled={busy || !Object.values(readiness).every(Boolean)} checked={settings.enabled} onChange={e=>setSettings({...settings,enabled:e.target.checked})}/> Enable automatic replies</label>
      <label className="block text-sm"><input type="checkbox" disabled={busy} checked={settings.autoQuotes} onChange={e=>setSettings({...settings,autoQuotes:e.target.checked})}/> Allow Smart Quote estimates after client confirmation</label>
      <label className="block text-sm">Business information the agent may share<textarea className={control} rows={4} maxLength={12000} value={settings.businessFacts} onChange={e=>setSettings({...settings,businessFacts:e.target.value})} placeholder="Business hours, service areas, contact details and approved company information"/></label>
      <label className="block text-sm">Daily reply budget<input className={control} type="number" min={1} max={500} value={settings.dailyLimit} onChange={e=>setSettings({...settings,dailyLimit:Number(e.target.value)})}/></label>
      <button type="button" disabled={busy} className="rounded bg-emerald-700 px-4 py-2 text-sm disabled:opacity-50" onClick={()=>void mutate("/settings","PUT",settings)}>{busy ? "Saving…" : "Save agent settings"}</button>
      <h4 className="font-semibold">Approved quotation library</h4>
      <p className="text-xs text-neutral-400">Upload reusable package PDFs that may be sent to customers. Include equipment details and a price expiry date. Client-specific quotations should stay in that client’s proposal.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Package title<input className={control} maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label className="text-sm">Capacity<select className={control} value={capacity} onChange={e=>setCapacity(Number(e.target.value))}>{[6,8,10,12,15,20].map(k=><option key={k} value={k}>{k} kW</option>)}</select></label>
        <label className="text-sm">Equipment and package details<textarea className={control} maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
        <label className="text-sm">Price valid until (Pakistan date)<input className={control} type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
        <label className="text-sm">Quotation PDF (up to 10 MB)<input className={control} type="file" accept="application/pdf,.pdf" onChange={e=>setFile(e.target.files?.[0] || null)}/></label>
      </div>
      <label className="block text-sm"><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/> I reviewed this package and approve it for customer sharing.</label>
      <button type="button" disabled={busy || !file || !approved || !title.trim() || !description.trim() || !expiry} className="rounded bg-emerald-700 px-4 py-2 text-sm disabled:opacity-50" onClick={()=>void upload()}>Upload approved quotation</button>
      {settings.quotations.length === 0 && <p className="text-sm text-neutral-400">No approved package PDFs yet.</p>}
      {settings.quotations.map(doc=><div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-800 pt-3 text-sm"><span>{doc.title} · {doc.capacityKw} kW · {doc.approved ? "Approved" : "Paused"} · expires {doc.expiresAt.slice(0,10)}</span><button disabled={busy} className="underline" onClick={()=>void mutate(`/quotations/${doc.id}`,"PATCH",{approved:!doc.approved,revision:settings.revision})}>{doc.approved ? "Pause sharing" : "Approve sharing"}</button></div>)}
    </>}
  </section>;
}
