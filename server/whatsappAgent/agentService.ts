import type { WhatsAppConversationInbox } from "../whatsappTransport/whatsappInboxDatabaseTypes.ts";
import type { InboxMessageRef } from "../whatsappTransport/whatsappInboxRepoSupport.ts";
import { guardPromptInjection } from "../whatsappTransport/aiQueryAgent/queryInjectionGuard.ts";
import { QueryPolicyLayer } from "../whatsappTransport/aiQueryAgent/queryPolicyLayer.ts";
import { computeFreeFormEligibility } from "../whatsappTransport/whatsappInboxFreeForm.ts";
import type { SalesAgentSettings } from "./agentSettings.ts";
import type { AgentDecision } from "./agentProvider.ts";
import { calculateAgentQuote, currentApprovedQuotations, publicAgentCatalog, type QuoteRequirements } from "./quoteTools.ts";
export type PendingConfirmation = { requirements: QuoteRequirements; sourceId: string; expiresAt: number };
export const isClientConfirmation = (text: string) => /^(?:yes|yes please|confirmed|confirm|proceed|ok|okay|han|haan|ji|jee|theek hai|جی|ہاں|تصدیق)[.!\s]*$/i.test(text.trim());
export type AgentTurnPorts = {
  getConversation(): Promise<WhatsAppConversationInbox | null>;
  getLatestInbound(): Promise<InboxMessageRef | null>;
  history(): Promise<InboxMessageRef[]>;
  phone(): Promise<string>;
  decide(settings: SalesAgentSettings, history: {role:string;text:string}[], signal: AbortSignal): Promise<AgentDecision>;
  createQuote(input: QuoteRequirements, phone: string, messageId: string): Promise<{quoteNumber:string; totalPkr:number; url:string}>;
  documentUrl(path: string): string;
  send(text: string): Promise<{ok:boolean;messageId?:string;unknown?:boolean}>;
  handoff(): Promise<void>;
  stillEnabled(): Promise<boolean>;
  confirmation(): Promise<PendingConfirmation | null>;
  saveConfirmation(pending: PendingConfirmation | null): Promise<void>;
};
export type AgentTurnResult = { state: "skipped" | "sent" | "handoff" | "failed" | "unknown"; reason: string; messageId?: string };
export function canAgentHandle(conversation: WhatsAppConversationInbox | null) {
  return Boolean(conversation && ["open", "pending"].includes(conversation.status) && !conversation.assignedUserId && ["AI_SHADOW", "AI_ACTIVE"].includes(conversation.aiOwnershipState || "AI_SHADOW"));
}
/** Every turn uses current server records; no customer-controlled recipient or price. */
export async function runAgentTurn(settings: SalesAgentSettings, sourceId: string, ports: AgentTurnPorts, now: () => number = Date.now): Promise<AgentTurnResult> {
  if (!settings.enabled || !canAgentHandle(await ports.getConversation())) return {state:"skipped",reason:"disabled_or_human_owned"};
  const source = await ports.getLatestInbound();
  if (!source || source.id !== sourceId || !source.textBody || source.isBackfill || !computeFreeFormEligibility(source, now()).freeFormAllowed) return {state:"skipped",reason:"superseded_or_window_closed"};
  const history = await ports.history();
  // A manual outbound after the incoming message takes priority.
  if (history.some(m => m.direction === "outbound" && Date.parse(m.createdAt) > Date.parse(source.createdAt))) return {state:"skipped",reason:"already_answered"};
  const policy = new QueryPolicyLayer().evaluate(source.textBody);
  if (guardPromptInjection(source.textBody).suspected || policy.escalationReasons.some(r => ["injection","angry","human_request","legal","medical","dangerous"].includes(r)) || /\boff[\s-]?grid\b/i.test(source.textBody) || (policy.intent === "unsupported_high_risk" && policy.confidence > 0.5) || ["complaint","billing_payment","after_sales","net_metering","human_request"].includes(policy.intent)) {
    await ports.handoff(); return {state:"handoff",reason:"human_review_required"};
  }
  if (history.some(m => m.direction === "inbound" && guardPromptInjection(m.textBody).suspected)) { await ports.handoff(); return {state:"handoff",reason:"unsafe_history"}; }
  let decision: AgentDecision;
  const pending = await ports.confirmation();
  const confirmed = pending && pending.sourceId !== sourceId && pending.expiresAt > now() && isClientConfirmation(source.textBody);
  try {
    if (confirmed) decision = {action:"create_quote",text:"",requirements:pending.requirements};
    else {
      if (pending) await ports.saveConfirmation(null);
      decision = await ports.decide({ ...settings, quotations: currentApprovedQuotations(settings.quotations, now()) }, history.slice(0,20).reverse().map(m => ({role:m.direction === "inbound" ? "customer" : "assistant",text:(m.textBody || "[non-text message]").slice(0,1500)})), AbortSignal.timeout(25000));
    }
  } catch { await ports.handoff(); return {state:"failed",reason:"provider_unavailable"}; }
  if (decision.action === "handoff") { await ports.handoff(); return {state:"handoff",reason:"agent_escalation"}; }
  let text = decision.text.trim();
  try {
    if (decision.action === "share_quotation") {
      const doc = currentApprovedQuotations(settings.quotations, now()).find(d => d.id === decision.quotationId);
      if (!doc) throw new Error("Approved quotation is unavailable.");
      text = `${text}\n${doc.title}\n${ports.documentUrl(doc.storagePath)}`;
    } else if (decision.action === "create_quote") {
      if (!settings.autoQuotes || !decision.requirements) throw new Error("Automatic quotes are disabled.");
      const phone = await ports.phone();
      const requirements = {...decision.requirements,confirmed:true};
      calculateAgentQuote(requirements, phone); // Before persistence, validate against real catalogue.
      if (!confirmed) {
        const panel=publicAgentCatalog.panels.find(p=>p.id===requirements.panelId)!;
        const inverter=publicAgentCatalog.inverters.find(i=>i.id===requirements.inverterId)!;
        const battery=publicAgentCatalog.batteries.find(b=>b.id===requirements.batteryId);
        text=`Please confirm your estimate: ${requirements.systemCapacityKw} kW, ${requirements.panelQuantity} ${panel.brand} ${panel.watts}W panels, ${requirements.inverterQuantity} ${inverter.brand} ${inverter.model || ""} ${inverter.capacityKw}kW inverter, ${battery ? `${requirements.batteryQuantity} ${battery.brand} ${battery.capacityKwh}kWh batteries` : "no battery"}, ${requirements.structureType}, for ${requirements.name} in ${requirements.city}. Includes 30m AC cable, 90m DC cable, 90m earthing cable, two earthing bores, installation, local transport and survey. Reply YES to generate the PDF, or tell me what to change. Final site suitability requires a survey.`;
        await ports.saveConfirmation({requirements,sourceId,expiresAt:now()+30*60000});
      } else {
      const quote = await ports.createQuote(requirements, phone, sourceId);
      text = `Your Sunchaser solar estimate ${quote.quoteNumber} is PKR ${Math.round(quote.totalPkr).toLocaleString("en-PK")}.\nDownload your quotation: ${quote.url}\nThis uses the equipment and standard allowances you confirmed. Final site suitability and extra work require a survey. The quotation is saved in our CRM for follow-up.`;
      await ports.saveConfirmation(null);
      }
    }
  } catch { await ports.handoff(); return {state:"handoff",reason:"quotation_needs_review"}; }
  if (!text || text.length > 4096) { await ports.handoff(); return {state:"failed",reason:"invalid_reply"}; }
  const latest = await ports.getLatestInbound();
  const recentHistory = await ports.history();
  if (!await ports.stillEnabled() || !canAgentHandle(await ports.getConversation()) || latest?.id !== sourceId || !computeFreeFormEligibility(latest, now()).freeFormAllowed || recentHistory.some(m => m.direction === "outbound" && Date.parse(m.createdAt) > Date.parse(source.createdAt))) return {state:"skipped",reason:"changed_before_send"};
  try {
    const sent = await ports.send(text);
    if (!sent.ok) { await ports.handoff(); return {state:sent.unknown ? "unknown" : "failed",reason:"delivery_failed"}; }
    return {state:"sent",reason:decision.action,messageId:sent.messageId};
  } catch { await ports.handoff(); return {state:"unknown",reason:"delivery_unknown"}; }
}
