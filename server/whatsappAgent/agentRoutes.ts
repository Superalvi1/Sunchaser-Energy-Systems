import express from "express";
import { randomUUID } from "node:crypto";
import type { RequestActor } from "../middleware/actor.ts";
import { agentReadiness, canEnableAgent, loadAgentSettings, updateAgentSettings } from "./agentSettings.ts";
import { putRailwayObject, buildRailwayObjectProxyUrl } from "../storage/railwayObjectStorage.ts";
import { createDefaultWhatsAppInboxRepositories } from "../whatsappTransport/whatsappInboxRepository.ts";
import { publicAgentCatalog } from "./quoteTools.ts";
import { absoluteCrmFileUrl } from "./agentRuntime.ts";
export function canManageSalesAgent(actor?: RequestActor) { return Boolean(actor && actor.accountStatus === "Approved" && ["Super Admin","Admin","Technical CEO"].includes(actor.role)); }
export function createSalesAgentRouter(invalidate: () => void) {
  const router = express.Router();
  router.use((req,res,next)=> {
    if (!canManageSalesAgent((req as any).actor)) return res.status(403).json({error:"An approved administrator must manage the sales agent."});
    next();
  });
  router.get("/settings", async (_req,res)=> {
    try { const {settings} = await loadAgentSettings(); res.json({settings,readiness:agentReadiness(),catalog:publicAgentCatalog}); }
    catch { res.status(503).json({error:"Agent storage is unavailable. Check Railway object storage configuration."}); }
  });
  router.put("/settings",async(req,res)=> {
    try {
      const b = req.body;
      if (!b || typeof b.enabled !== "boolean" || typeof b.autoQuotes !== "boolean" || typeof b.businessFacts !== "string" || b.businessFacts.length > 12000 || !Number.isInteger(b.dailyLimit) || b.dailyLimit < 1 || b.dailyLimit > 500 || !Number.isInteger(b.revision)) return res.status(400).json({error:"Invalid agent settings."});
      if (b.enabled && !canEnableAgent()) return res.status(409).json({error:"Add GEMINI_API_KEY and WHATSAPP_SALES_AI_MODEL in Railway, and verify WhatsApp and storage before enabling replies."});
      const actor = (req as any).actor as RequestActor;
      const settings = await updateAgentSettings(b.revision,current=> ({...current, enabled:b.enabled,autoQuotes:b.autoQuotes,businessFacts:b.businessFacts,dailyLimit:b.dailyLimit,ownerUsername:actor.username}));
      invalidate(); res.json({settings,readiness:agentReadiness()});
    } catch (e:any) { res.status(e.status || 503).json({error:e.status === 409 ? e.message : "Could not save agent settings."}); }
  });
  router.post("/quotations",async(req,res)=> {
    try {
      const b=req.body;
      if (!b || b.approved !== true || typeof b.title !== "string" || !b.title.trim() || b.title.length > 200 || typeof b.description !== "string" || b.description.length > 2000 || ![6,8,10,12,15,20].includes(b.capacityKw) || !Number.isFinite(Date.parse(b.expiresAt)) || Date.parse(b.expiresAt) <= Date.now() || typeof b.pdfBase64 !== "string" || b.pdfBase64.length > 14*1024*1024 || !Number.isInteger(b.revision)) return res.status(400).json({error:"Provide a reviewed PDF, package details and a future expiry date."});
      const pdf=Buffer.from(b.pdfBase64,"base64");
      if (pdf.length > 10*1024*1024 || pdf.subarray(0,5).toString() !== "%PDF-") return res.status(400).json({error:"Upload a valid PDF up to 10 MB."});
      const existing=await loadAgentSettings();
      if (existing.settings.revision !== b.revision) return res.status(409).json({error:"Settings changed. Refresh and retry."});
      if (existing.settings.quotations.length >= 100) return res.status(400).json({error:"The library supports up to 100 quotations."});
      const id=randomUUID(), storagePath=`whatsapp-agent/approved/${id}.pdf`;
      await putRailwayObject("customer-documents",storagePath,pdf,"application/pdf");
      const settings=await updateAgentSettings(b.revision,c=>({...c,quotations:[...c.quotations,{id,title:b.title.trim(),description:b.description.trim(),capacityKw:b.capacityKw,expiresAt:new Date(b.expiresAt).toISOString(),storagePath,approved:true}]}));
      invalidate(); res.json({settings});
    } catch(e:any) { res.status(e.status||503).json({error:e.status === 409 ? e.message : "Could not save the approved quotation."}); }
  });
  router.patch("/quotations/:id",async(req,res)=> {
    try {
      if (typeof req.body?.approved !== "boolean" || !Number.isInteger(req.body.revision)) return res.status(400).json({error:"Invalid quotation approval."});
      const settings=await updateAgentSettings(req.body.revision,c=>{
        if(!c.quotations.some(d=>d.id===req.params.id)) throw Object.assign(new Error("Quotation not found."),{status:404});
        return {...c,quotations:c.quotations.map(d=>d.id===req.params.id ? {...d,approved:req.body.approved} : d)};
      });
      invalidate(); res.json({settings});
    } catch(e:any) { res.status(e.status||503).json({error:"Could not change quotation approval. Refresh and retry."}); }
  });
  router.get("/quotations/:id",async(req,res)=> {
    try { const {settings}=await loadAgentSettings(); const doc=settings.quotations.find(d=>d.id===req.params.id); if(!doc) return res.status(404).json({error:"Quotation not found."}); res.json({url:absoluteCrmFileUrl(buildRailwayObjectProxyUrl("customer-documents",doc.storagePath))}); }
    catch {res.status(503).json({error:"Could not open quotation."});}
  });
  router.post("/conversations/:id/ownership",async(req,res)=> {
    try {
      const state=req.body?.state;
      if (!["AI_ACTIVE","AI_PAUSED","HUMAN_HANDLING"].includes(state)) return res.status(400).json({error:"Invalid ownership state."});
      if(state==="AI_ACTIVE" && (!canEnableAgent() || !(await loadAgentSettings()).settings.enabled)) return res.status(409).json({error:"Configure and enable the agent first."});
      const repos=createDefaultWhatsAppInboxRepositories(),c=await repos.conversations.getById(req.params.id,"sunchaser");
      if (!c) return res.status(404).json({error:"Conversation not found."});
      if(state==="AI_ACTIVE" && c.assignedUserId) return res.status(409).json({error:"Unassign this conversation before returning it to the AI."});
      const result=await repos.conversations.compareAndSet(c.id,c.lockVersion,{companyId:"sunchaser",aiOwnershipState:state});
      if(!result.ok) return res.status(409).json({error:"Conversation changed. Refresh and try again."});
      res.json({conversation:result.row});
    } catch {res.status(503).json({error:"Could not update conversation ownership."});}
  });
  return router;
}
