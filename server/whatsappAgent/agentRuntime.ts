import { getSupabase, isSupabaseActive } from "../../dbManager.ts";
import { hydrateActorFromUsername } from "../middleware/actor.ts";
import { canSendOutboundWhatsApp } from "../whatsappTransport/whatsappPermissions.ts";
import { createDefaultWhatsAppInboxRepositories } from "../whatsappTransport/whatsappInboxRepository.ts";
import { createDefaultWhatsAppRepository, safeAudit } from "../whatsappTransport/whatsappRepository.ts";
import { readWhatsAppConfig } from "../whatsappTransport/whatsappConfig.ts";
import { sendOutboundPlainText } from "../whatsappTransport/whatsappOutboundService.ts";
import { buildRailwayObjectProxyUrl, getRailwayObject, putRailwayObject } from "../storage/railwayObjectStorage.ts";
import { loadAgentSettings, canEnableAgent } from "./agentSettings.ts";
import { decideSalesReply } from "./agentProvider.ts";
import { runAgentTurn, type AgentTurnPorts } from "./agentService.ts";

const JOB = "wa-ai-job:", RUN = "wa-ai-run:";
const companyId = "sunchaser";
export function absoluteCrmFileUrl(path: string) { return new URL(path, "https://crm.sunchaserenergy.co").href; }
export function createSalesAgentRuntime(createQuote: AgentTurnPorts["createQuote"]) {
  let draining = false;
  let cached: Awaited<ReturnType<typeof loadAgentSettings>> | null = null;
  let loadedAt = 0;
  const settings = async (fresh = false) => {
    if (fresh || !cached || Date.now() - loadedAt > 30000) { cached = await loadAgentSettings(); loadedAt = Date.now(); }
    return cached.settings;
  };
  const enqueue = async (conversationId: string, messageId: string) => {
    if (!canEnableAgent() || !isSupabaseActive()) return;
    const config = await settings();
    if (!config.enabled) return;
    const repos = createDefaultWhatsAppInboxRepositories();
    await repos.idempotency.claim({ idempotencyKey: JOB + messageId, conversationId, companyId });
  };
  const drain = async () => {
    if (draining || !canEnableAgent() || !isSupabaseActive()) return;
    draining = true;
    try {
      const config = await settings();
      if (!config.enabled) return;
      const actor = await hydrateActorFromUsername(config.ownerUsername, undefined, "jwt");
      if (!actor.ok || !canSendOutboundWhatsApp(actor.actor)) return;
      const client = getSupabase()!;
      const repos = createDefaultWhatsAppInboxRepositories();
      const repo = createDefaultWhatsAppRepository();
      // Count all claimed runs, including failures, to bound API spend per Pakistan day.
      const pktDay = new Date(Date.now() + 5 * 3600000).toISOString().slice(0,10);
      const { count, error: countError } = await client.from("whatsapp_outbound_idempotency_keys").select("idempotency_key", {count:"exact",head:true}).eq("company_id",companyId).like("idempotency_key", RUN + "%").gte("created_at", pktDay + "T00:00:00+05:00");
      if (countError || count === null || count >= config.dailyLimit) return;
      const { data, error } = await client.from("whatsapp_outbound_idempotency_keys").select("*").eq("company_id",companyId).eq("state","processing").like("idempotency_key", JOB + "%").order("created_at",{ascending:true}).limit(Math.min(2,config.dailyLimit - count));
      if (error) throw error;
      for (const job of data || []) {
        const messageId = job.idempotency_key.slice(JOB.length);
        const conversationId = job.conversation_id;
        const runKey = RUN + messageId;
        const claim = await repos.idempotency.claim({idempotencyKey:runKey,conversationId,companyId});
        if (claim.kind !== "claimed") {
          // Never blindly replay a send after a crash or a provider timeout.
          if (Date.now() - Date.parse(claim.row.createdAt) > 60000) {
            await repos.idempotency.markOutcomeUnknown({idempotencyKey:job.idempotency_key,conversationId,companyId});
            await repos.idempotency.markOutcomeUnknown({idempotencyKey:runKey,conversationId,companyId});
            const c = await repos.conversations.getById(conversationId, companyId);
            if(c) await repos.conversations.compareAndSet(c.id,c.lockVersion,{companyId,aiOwnershipState:"HUMAN_HANDLING"});
          }
          continue;
        }
        const handoff = async () => {
          const c = await repos.conversations.getById(conversationId,companyId);
          if (c) await repos.conversations.compareAndSet(c.id,c.lockVersion,{companyId,aiOwnershipState:"HUMAN_HANDLING"});
        };
        const outcome = await runAgentTurn(config,messageId,{
          getConversation:()=>repos.conversations.getById(conversationId,companyId),
          getLatestInbound:()=>repos.messages.getLatestInbound(conversationId,companyId),
          history:async()=> (await repos.messages.listByConversation(conversationId,{companyId,limit:20})).rows,
          phone:async()=> (await repo.getConversationBundle(conversationId,companyId))?.contact.phoneE164 || "",
          decide:decideSalesReply,
          createQuote,
          documentUrl:path=>absoluteCrmFileUrl(buildRailwayObjectProxyUrl("customer-documents",path)),
          handoff,
          stillEnabled:async()=> {const latest=await settings(true); return latest.enabled && latest.revision===config.revision;},
          confirmation:async()=> {
            const obj=await getRailwayObject("customer-documents",`whatsapp-agent/pending/${conversationId}.json`);
            return obj ? JSON.parse(obj.body.toString("utf8")) : null;
          },
          saveConfirmation:async pending=> {
            await putRailwayObject("customer-documents",`whatsapp-agent/pending/${conversationId}.json`,Buffer.from(JSON.stringify(pending)),"application/json");
          },
          send:async text=> {
            const result = await sendOutboundPlainText(conversationId,text,{repo,config:readWhatsAppConfig(),actor:actor.actor,companyId,clientIdempotencyKey:runKey});
            return result.httpStatus === 201 ? {ok:true,messageId:result.messageId} : {ok:false,unknown:result.httpStatus === 202 || result.httpStatus === 504 || result.providerOutcome === "accepted"};
          }
        });
        for (const idempotencyKey of [runKey,job.idempotency_key]) {
          if (outcome.state === "sent" && outcome.messageId) await repos.idempotency.markCompleted({idempotencyKey,conversationId,companyId,messageId:outcome.messageId});
          else if (outcome.state === "unknown") await repos.idempotency.markOutcomeUnknown({idempotencyKey,conversationId,companyId});
          else await repos.idempotency.markFailedKnown({idempotencyKey,conversationId,companyId,error:outcome.reason});
        }
        await safeAudit(repo,{eventType:"sales_agent_turn",entityType:"conversation",entityId:conversationId,metadata:{state:outcome.state,reason:outcome.reason,messageId}});
      }
    } catch { console.warn("[sales-agent] Worker could not complete; pending jobs remain for review/recovery."); }
    finally { draining = false; }
  };
  const pauseForStaff = async (conversationId:string) => {
    if(!canEnableAgent()) return;
    const repos=createDefaultWhatsAppInboxRepositories(),c=await repos.conversations.getById(conversationId,companyId);
    if(c && !await repos.conversations.compareAndSet(c.id,c.lockVersion,{companyId,aiOwnershipState:"HUMAN_HANDLING"}).then(r=>r.ok)) throw new Error("Conversation changed; retry the staff reply.");
  };
  return { enqueue, drain, pauseForStaff, invalidate:()=>{cached=null;} };
}
