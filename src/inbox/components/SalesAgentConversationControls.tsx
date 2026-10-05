import { useEffect, useState } from "react";
import { authorizedFetch } from "../../services/api";
export default function SalesAgentConversationControls({conversationId,state,onChange}:{conversationId:string;state?:string;onChange:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{setError("");},[conversationId]);
  const update=async(next:string)=>{setBusy(true);setError("");try {const response=await authorizedFetch(`/api/whatsapp-agent/conversations/${conversationId}/ownership`,{method:"POST",body:JSON.stringify({state:next})});const result=await response.json();if(!response.ok)throw new Error(result.error || "Could not update AI ownership.");onChange();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="border-t border-neutral-800 p-3 text-xs"><div className="flex flex-wrap items-center gap-3"><span>Agent: {state || "AI_SHADOW"}</span>{[["HUMAN_HANDLING","Take over"],["AI_PAUSED","Pause AI"],["AI_ACTIVE","Resume AI"]].map(([next,label])=><button key={next} type="button" disabled={busy || state===next} className="rounded border border-neutral-700 px-2 py-1 disabled:opacity-40" onClick={()=>void update(next)}>{label}</button>)}</div>{error && <p role="alert" className="mt-2 text-red-300">{error}</p>}</div>;
}
