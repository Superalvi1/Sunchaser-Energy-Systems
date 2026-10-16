import { classifyRequest, matchApproved, matchFaq, shouldHandoff, requiresStaffPolicyReview } from "./logic.mjs";
import { readFile } from "node:fs/promises";
import { pilotRecipientAllowed } from "./pilotScope.mjs";
import { GrokReplyClient } from "./grokClient.mjs";
import { pilotText } from "./pilotText.mjs";

/**
 * Moos decision agent (action-only).
 *
 * Safety architecture:
 * - The worker NEVER holds Meta credentials, NEVER downloads PDFs, and NEVER
 *   invents prices, PDFs or customer records. It emits typed actions; the CRM
 *   validates and executes every privileged step server-side (ownership, 24h
 *   window, quote approval/expiry, idempotency).
 * - Approved PDFs come only from the CRM's approved-quotes endpoint (approved,
 *   unexpired, server-filtered). The CRM fetches bytes and sends the native
 *   document itself via /send-approved-pdf.
 * - Custom quotes are drafts only: requirements are collected incrementally
 *   from the customer, equipment is chosen from the CRM catalog (never
 *   invented), the draft is created server-side via /custom-quote-draft, then
 *   a holding reply + handoff. Staff approval before any customer send.
 * - Every send is ownership-checked against the CRM immediately before
 *   sending, idempotency-keyed, and executed by the CRM transport.
 */

const CUSTOM_TTL_MS = 30 * 60000;
const ASK_TTL_MS = 15 * 60000;

/**
 * The CRM refuses mutating calls with error "moos_disabled" when
 * MOOS_ENABLED=false (shadow mode). The worker must stay completely silent
 * then: no sends, no drafts, no handoffs, no ownership changes.
 */
function isShadowModeError(e) {
  if (!e) return false;
  if (e.body && e.body.error === "moos_disabled") return true;
  return e.status === 503 && /moos_disabled/.test(String(e.message || ""));
}

export class Agent {
  constructor(store, crm, env = process.env) {
    this.store = store;
    this.crm = crm;
    this.env = env;
    this._catalog = null;
    this._faqs = null;
    this.grok = new GrokReplyClient(env);
    /** Latched when the CRM reports moos_disabled: stay silent afterwards. */
    this.shadowMode = false;
  }

  /** CRM-safe idempotency key (dots in wamids are stripped). */
  sendKey(...parts) {
    return ["moos", ...parts]
      .join(":")
      .replace(/[^A-Za-z0-9:_-]/g, "_")
      .slice(0, 128);
  }

  /** Fail closed: unknown ownership → human-owned → no send. */
  async isOwnedByHuman(msg) {
    if (!msg.conversationId) return true;
    try {
      const o = await this.crm.ownership(msg.conversationId);
      return o.humanOwned !== false;
    } catch {
      return true;
    }
  }

  async isSafeToSend(msg) {
    return (
      this.env.ENABLE_AUTOSEND === "true" &&
      pilotRecipientAllowed(msg.phone, this.env) &&
      (await this.store.preflight(msg)) &&
      !(await this.isOwnedByHuman(msg))
    );
  }

  async sendOnce(msg, key, kind, fn) {
    if (this.shadowMode) {
      await this.store.shadow(key);
      return { shadow: true };
    }
    if (!(await this.isSafeToSend(msg))) throw new Error("send_blocked_by_safety_gate");
    if (!(await this.store.reserve(key, msg, kind))) return false;
    try {
      const result = await fn();
      await this.store.sent(key, result);
      return result;
    } catch (e) {
      if (isShadowModeError(e)) {
        // Policy refusal, not a failure: latch shadow mode and stay silent.
        // No handoff, no ownership change — the CRM inbox still has the message.
        this.shadowMode = true;
        await this.store.shadow(key);
        return { shadow: true };
      }
      await this.store.unknown(key);
      throw e;
    }
  }

  async text(msg, suffix, body) {
    const key = this.sendKey(msg.messageId, "text", suffix);
    return this.sendOnce(msg, key, "text", () =>
      this.crm.sendText({
        conversationId: msg.conversationId,
        text: body,
        idempotencyKey: key,
      })
    );
  }

  /** Send an approved library PDF as a native WhatsApp document (CRM executes). */
  async pdf(msg, quote) {
    const key = this.sendKey(msg.messageId, "pdf", quote.id);
    return this.sendOnce(msg, key, "document", () =>
      this.crm.sendApprovedPdf({
        conversationId: msg.conversationId,
        quoteId: quote.id,
        idempotencyKey: key,
      })
    );
  }

  async handoff(msg, reason, summary = "") {
    if (this.shadowMode) {
      // Shadow mode: never move ownership or create handoff noise. The CRM
      // inbox retains the original message for staff either way.
      console.warn("[agent] shadow mode: handoff suppressed:", reason);
      return;
    }
    await this.store.handoff(msg, reason);
    try {
      if (msg.conversationId) await this.crm.handoff(msg.conversationId, reason, summary);
    } catch (e) {
      console.error("[agent] CRM handoff failed, held locally:", reason, String(e && e.message || e).slice(0, 120));
    }
  }

  /** Fetch approved quotes from the CRM (server-filtered: approved && unexpired). */
  async approvedQuotes() {
    const data = await this.crm.approvedQuotes();
    const list = Array.isArray(data?.quotes) ? data.quotes : [];
    // Defensive re-validation: never trust the wire blindly.
    const now = Date.now();
    return list
      .filter(
        (q) =>
          q &&
          typeof q.id === "string" &&
          Number.isFinite(q.capacityKw) &&
          Date.parse(q.expiresAt) > now
      )
      .map((q) => ({ ...q, systemType: q.systemType || this.systemTypeOf(q) }));
  }

  async catalog() {
    if (!this._catalog) this._catalog = await this.crm.catalog();
    return this._catalog;
  }

  async faqs() {
    if (!this._faqs) {
      try {
        const raw = await readFile(this.env.FAQ_FILE || "./faqs.json", "utf8");
        const parsed = JSON.parse(raw);
        this._faqs = Array.isArray(parsed) ? parsed : [];
      } catch {
        this._faqs = [];
      }
    }
    return this._faqs;
  }

  /**
   * Best-effort system-type inference for library records without a
   * first-class variant field (matches the CRM's title convention).
   */
  systemTypeOf(q) {
    const hay = `${q.title || ""} ${q.description || ""}`.toLowerCase();
    if (hay.includes("off-grid") || hay.includes("off grid")) return "off_grid";
    if (hay.includes("hybrid")) return "hybrid";
    if (hay.includes("on-grid") || hay.includes("on grid") || hay.includes("ongrid")) return "on_grid";
    return null;
  }

  async decideWithMoos(msg, available) {
    if (!this.env.MOOS_DECISION_URL) return null;
    try {
      const history = await this.store.history(msg.phone);
      const r = await fetch(this.env.MOOS_DECISION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.env.MOOS_SERVICE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          current: { text: String(msg.text || "").slice(0, 500), type: msg.type },
          history,
          availableQuotes: available.map((q) => ({ id: q.id, size: q.capacityKw, title: q.title, expiresAt: q.expiresAt })),
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) return null;
      const d = await r.json();
      // The LLM may classify intent only — never prices, PDF URLs or phone numbers.
      if (["faq", "human", "custom", "clarify"].includes(d.action)) return d;
      return null;
    } catch {
      return null;
    }
  }

  // ---------- custom-quote incremental collection ----------

  async startCustom(msg) {
    await this.store.setPending(msg.phone, { kind: "custom_name", expiresAt: Date.now() + CUSTOM_TTL_MS });
    await this.text(msg, "custom_name", "Ji, customized quotation ke liye mujhe kuch details chahiye. Aapka naam kya hai?");
    return { review: false, reason: "custom_collect_name" };
  }

  isYes(t) {
    return /^(ji|jee|haan|han|yes|y|ok|theek|confirm|sahi)\b/i.test(String(t).trim());
  }

  isNo(t) {
    return /^(nahi|nahin|no|n\b|na\b)/i.test(String(t).trim());
  }

  parsePhase(t) {
    const s = String(t).trim().toLowerCase();
    if (/three|3\s*-?\s*phase|\bteen\b/.test(s)) return "three";
    if (/single|1\s*-?\s*phase/.test(s)) return "single";
    if (/any|koi bhi|\bdono\b|both/.test(s)) return "any";
    return null;
  }

  /**
   * Recommend ONE compatible package from the approved CRM catalog based on
   * the customer's stated requirements (size, phase, battery, structure).
   * The customer never picks individual panels/inverters — they only confirm
   * or decline the recommendation. Deterministic: smallest adequate inverter,
   * highest-wattage panel, bundled-or-voltage-matched battery.
   * The CRM pricing engine re-validates every compatibility rule server-side.
   */
  recommendPackage(catalog, req) {
    const size = req.capacityKw;
    const inverters = (catalog.inverters || [])
      .filter((i) => i && i.phase && i.phase !== "unspecified")
      .filter((i) => req.phase === "any" || i.phase === req.phase)
      .filter((i) => i.capacityKw >= size)
      .sort((a, b) => a.capacityKw - b.capacityKw || String(a.id).localeCompare(String(b.id)));
    const inverter = inverters[0];
    if (!inverter) return { ok: false, reason: "no-inverter" };
    let batteryId = null;
    let batteryQty = 0;
    let batteryLabel = "Nahi";
    if (req.battery) {
      if (inverter.bundleBatteryId) {
        batteryId = inverter.bundleBatteryId;
        batteryQty = inverter.bundleBatteryQuantity > 0 ? inverter.bundleBatteryQuantity : 1;
        batteryLabel = "Inverter ke saath bundled";
      } else {
        const bat = (catalog.batteries || [])
          .filter((b) => b && !b.bundleOnly)
          .filter((b) => !inverter.voltageClass || !b.voltageClass || b.voltageClass === inverter.voltageClass)
          .sort((a, b) => a.capacityKwh - b.capacityKwh || String(a.id).localeCompare(String(b.id)))[0];
        if (!bat) return { ok: false, reason: "no-battery" };
        batteryId = bat.id;
        batteryQty = 1;
        batteryLabel = `${bat.brand}${bat.model ? " " + bat.model : ""} — ${bat.capacityKwh} kWh`;
      }
    }
    const panel = [...(catalog.panels || [])]
      .filter((p) => p && p.watts > 0)
      .sort((a, b) => b.watts - a.watts || String(a.id).localeCompare(String(b.id)))[0];
    if (!panel) return { ok: false, reason: "no-panel" };
    let panelQuantity = Math.max(1, Math.round((size * 1000) / panel.watts));
    const arrayKw = () => (panelQuantity * panel.watts) / 1000;
    while (arrayKw() < size * 0.9 && panelQuantity < 80) panelQuantity += 1;
    while (arrayKw() > size * 1.3 && panelQuantity > 1) panelQuantity -= 1;
    return {
      ok: true,
      inverterId: inverter.id,
      inverter: {
        brand: inverter.brand,
        model: inverter.model,
        capacityKw: inverter.capacityKw,
        phase: inverter.phase,
      },
      panelId: panel.id,
      panel: { brand: panel.brand, watts: panel.watts },
      panelQuantity,
      batteryId,
      batteryQty,
      batteryLabel,
    };
  }

  recommendationText(name, city, size, structureType, rec) {
    const inv = rec.inverter;
    return [
      `Ji ${name}, aapki requirement ke liye main ye approved package recommend karta hoon:`,
      `• ${size} kW solar system, ${city}`,
      `• Inverter: ${inv.brand}${inv.model ? " " + inv.model : ""} — ${inv.capacityKw} kW (${inv.phase} phase)`,
      `• Panels: ${rec.panel.brand} ${rec.panel.watts}W × ${rec.panelQuantity}`,
      `• Battery: ${rec.batteryLabel}`,
      `• Structure: ${structureType === "elevated" ? "Elevated" : "Standard"}`,
      `Quotation ka draft ban jayega jo hamari team review karke aapko bhejegi. Aage barhun? "Ji" likh kar confirm karein.`,
    ].join("\n");
  }

  async continueCustom(msg, pending, t) {
    const phone = msg.phone;
    const set = (p) => this.store.setPending(phone, { ...p, expiresAt: Date.now() + CUSTOM_TTL_MS });

    if (pending.kind === "custom_name") {
      const name = t.trim().slice(0, 60);
      if (name.length < 2 || /^\d+$/.test(name)) {
        await this.text(msg, "custom_name_retry", "Mazrat, naam samajh nahi aaya. Apna naam likh kar bhejein.");
        return { review: false, reason: "custom_collect_name_retry" };
      }
      await set({ kind: "custom_city", name });
      await this.text(msg, "custom_city", `Shukriya ${name}. Installation kis city mein hogi?`);
      return { review: false, reason: "custom_collect_city" };
    }

    if (pending.kind === "custom_city") {
      const city = t.trim().slice(0, 60);
      if (city.length < 2) {
        await this.text(msg, "custom_city_retry", "City ka naam likh kar bhejein, taake quotation usi ke hisaab se ban sake.");
        return { review: false, reason: "custom_collect_city_retry" };
      }
      await set({ kind: "custom_capacity", name: pending.name, city });
      await this.text(msg, "custom_capacity", "Kitne kW ka system chahiye? (6, 8, 10, 12, 15 ya 20 likhein)");
      return { review: false, reason: "custom_collect_capacity" };
    }

    if (pending.kind === "custom_capacity") {
      const m = t.trim().match(/^(6|8|10|12|15|20)$/);
      if (!m) {
        await this.text(msg, "custom_capacity_retry", "Mazrat — 6, 8, 10, 12, 15 ya 20 mein se aik size likhein.");
        return { review: false, reason: "custom_collect_capacity_retry" };
      }
      await set({ kind: "custom_battery", name: pending.name, city: pending.city, capacityKw: Number(m[1]) });
      await this.text(msg, "custom_battery", "Battery backup chahiye? (Ji ya Nahi likhein)");
      return { review: false, reason: "custom_collect_battery" };
    }

    if (pending.kind === "custom_battery") {
      let battery = null;
      if (this.isYes(t)) battery = true;
      else if (this.isNo(t)) battery = false;
      else {
        await this.text(msg, "custom_battery_retry", "Ji ya Nahi likh kar batayein ke battery backup chahiye ya nahi.");
        return { review: false, reason: "custom_collect_battery_retry" };
      }
      await set({ kind: "custom_structure", name: pending.name, city: pending.city, capacityKw: pending.capacityKw, battery });
      await this.text(msg, "custom_structure", "Structure standard hoga ya elevated? (Standard ya Elevated likhein)");
      return { review: false, reason: "custom_collect_structure" };
    }

    if (pending.kind === "custom_structure") {
      const s = t.trim().toLowerCase();
      let structureType = null;
      if (/elevat/.test(s)) structureType = "elevated";
      else if (/standard|l2|normal|chhat/.test(s)) structureType = "standard-l2";
      else {
        await this.text(msg, "custom_structure_retry", "Standard ya Elevated likh kar batayein.");
        return { review: false, reason: "custom_collect_structure_retry" };
      }
      await set({ kind: "custom_phase", name: pending.name, city: pending.city, capacityKw: pending.capacityKw, battery: pending.battery, structureType });
      await this.text(msg, "custom_phase", "Bijli ka connection single phase hai ya three phase? (Single ya Three Phase likhein)");
      return { review: false, reason: "custom_collect_phase" };
    }

    if (pending.kind === "custom_phase") {
      const phase = this.parsePhase(t);
      if (!phase) {
        await this.text(msg, "custom_phase_retry", "Single Phase ya Three Phase likh kar batayein.");
        return { review: false, reason: "custom_collect_phase_retry" };
      }
      const catalog = await this.catalog();
      const rec = this.recommendPackage(catalog, { capacityKw: pending.capacityKw, battery: pending.battery, phase });
      if (!rec.ok) {
        await this.text(msg, "custom_nopackage", "Mazrat, aapki requirements ke liye maujooda approved catalog mein compatible package available nahi. Hamari technical team aap se rabta karke custom solution degi.");
        await this.handoff(msg, "custom_no_compatible_package", `${pending.capacityKw}kW ${phase} phase battery=${pending.battery} (${rec.reason})`);
        return { review: true, reason: "custom_no_package" };
      }
      await set({ kind: "custom_confirm", name: pending.name, city: pending.city, capacityKw: pending.capacityKw, battery: pending.battery, structureType: pending.structureType, phase, recommendation: rec });
      await this.text(msg, "custom_confirm", this.recommendationText(pending.name, pending.city, pending.capacityKw, pending.structureType, rec));
      return { review: false, reason: "custom_collect_confirm" };
    }

    if (pending.kind === "custom_confirm") {
      if (this.isYes(t)) {
        const rec = pending.recommendation;
        const requirements = rec ? this.buildRequirements(pending, rec) : null;
        if (!requirements) {
          await this.handoff(msg, "custom_requirements_invalid", JSON.stringify(pending).slice(0, 300));
          return { review: true, reason: "custom_invalid" };
        }
        if (this.shadowMode) {
          // MOOS_ENABLED=false: never create drafts in shadow mode.
          return { review: false, reason: "shadow_mode_no_draft" };
        }
        let draft;
        try {
          draft = await this.crm.customQuoteDraft({ conversationId: msg.conversationId, inboundMessageId: msg.messageId, requirements });
        } catch (e) {
          if (isShadowModeError(e)) {
            this.shadowMode = true;
            return { review: false, reason: "shadow_mode_no_draft" };
          }
          const detail = String((e && e.body && e.body.error) || (e && e.message) || "").slice(0, 300);
          await this.text(msg, "custom_draft_failed", "Mazrat, in details par quotation banane ke liye hamari technical team ko review karna hoga. Koi team member aap se jald rabta karega.");
          await this.handoff(msg, "quotation_needs_review", detail);
          return { review: true, reason: "custom_draft_failed" };
        }
        await this.store.setPending(phone, null);
        await this.text(msg, "custom_draft_ready",
          `Shukriya ${pending.name}! Aapki customized quotation (${draft.quoteNumber}) hamari technical team review kar ke jald isi WhatsApp par share karegi.`);
        await this.handoff(msg, "custom_quote_draft_ready", `Draft ${draft.quoteNumber} for ${pending.name}, ${pending.city}`);
        return { review: true, reason: "custom_draft_ready" };
      }
      if (this.isNo(t)) {
        await this.store.setPending(phone, null);
        await this.handoff(msg, "custom_customer_rejected_summary", JSON.stringify(pending).slice(0, 300));
        return { review: true, reason: "custom_rejected" };
      }
      await this.text(msg, "custom_confirm_retry", "Ji likh kar confirm karein, ya Nahi likhein agar details durust karni hain.");
      return { review: false, reason: "custom_collect_confirm_retry" };
    }

    // Unknown pending kind — clear and hand off rather than looping.
    await this.store.setPending(phone, null);
    await this.handoff(msg, "unknown_pending_state", String(pending.kind).slice(0, 80));
    return { review: true, reason: "unknown_pending" };
  }

  buildRequirements(p, rec) {
    // The recommendation already carries validated catalog records and
    // quantities; the CRM engine (calculateAgentQuote) re-validates every
    // compatibility rule server-side before generating the draft PDF.
    if (!rec || !rec.ok || !rec.panelId || !rec.inverterId) return null;
    if (rec.batteryId && !rec.batteryQty) return null;
    return {
      name: p.name,
      city: p.city,
      systemCapacityKw: p.capacityKw,
      panelId: rec.panelId,
      inverterId: rec.inverterId,
      batteryId: rec.batteryId || null,
      panelQuantity: rec.panelQuantity,
      inverterQuantity: 1,
      batteryQuantity: rec.batteryQty || 0,
      structureType: p.structureType,
      confirmed: true,
    };
  }

  /** In the initial live pilot, handle text enquiries only.
   * Never enter the approved-PDF, custom quote, catalogue or draft actions.
   * An absent setting defaults to text-only in production (fail closed).
   */
  textOnly() {
    return this.env.MUSE_TEXT_ONLY_MODE === "true" ||
      (this.env.NODE_ENV === "production" && this.env.MUSE_TEXT_ONLY_MODE !== "false");
  }

  async processTextOnly(msg, text) {
    const t = String(text || "").trim();
    if (shouldHandoff(t) || requiresStaffPolicyReview(t)) {
      await this.text(msg, "text_only_staff", pilotText(t, "review"));
      await this.handoff(msg, "text_only_staff_review", t.slice(0, 500));
      return { review: true, reason: "text_only_handoff" };
    }

    // Only facts in the tiny approved baseline knowledge file are eligible
    // for automatic factual replies. Unapproved 64-FAQ patch stays excluded.
    const faq = matchFaq(t, await this.faqs());
    if (faq) {
      await this.text(msg, `faq:${faq.id}`, faq.id === "service_area" ? pilotText(t, "service_area") : faq.answer);
      return { review: false, reason: "text_only_faq" };
    }

    if (/^(hi|hello|hey|aoa|a\.?o\.?a\.?|assalamu?\s*alaikum|asalamualaikum|salam|السلام\s*علیکم|سلام|اسلام\s*علیکم)[!.,\s]*$/i.test(t)) {
      await this.text(msg, "text_only_welcome", pilotText(t, "welcome"));
      return { review: false, reason: "text_only_greeting" };
    }

    // A price, system-size, custom-solar or quotation question is NOT a request
    // to send a file. Defer commercial terms to a person during the pilot.
    const classified = classifyRequest(t);
    if (classified.quoteIntent || classified.sizes.length || classified.custom ||
        /\b(price|cost|rate|estimate|quotation|quote|kitne|qeemat)\b|قیمت|ریٹ|کوٹیشن/i.test(t)) {
      await this.text(msg, "text_only_sales", pilotText(t, "sales"));
      await this.handoff(msg, "text_only_sales_enquiry", t.slice(0, 500));
      return { review: true, reason: "text_only_sales_handoff" };
    }

    // A Grok model can respond only when explicitly enabled with an xAI
    // server-side API key. Keep ordinary policy and quote requests on staff.
    // Provider errors, refusals or malformed responses fail to human handoff.
    if (this.grok.enabled()) {
      let decision = null;
      try {
        decision = await this.grok.respond(t, await this.store.history(msg.phone));
      } catch {
        decision = null;
      }
      if (decision?.action === "reply") {
        await this.text(msg, "grok_text", decision.reply);
        return { review: false, reason: "grok_text_reply" };
      }
      await this.text(msg, "grok_review", pilotText(t, "review"));
      await this.handoff(msg, decision?.action === "handoff" ? "grok_requested_staff" : "grok_unavailable_or_unverified", t.slice(0, 500));
      return { review: true, reason: "grok_handoff" };
    }

    await this.text(msg, "text_only_review", pilotText(t, "review"));
    await this.handoff(msg, "text_only_unreviewed_question", t.slice(0, 500));
    return { review: true, reason: "text_only_review_handoff" };
  }

  // ---------- main turn ----------

  async process(msg) {
    // Rollback must prevent ALL CRM side effects and provider requests, not
    // merely fail at the final send (which previously triggered a handoff).
    if (this.env.ENABLE_AUTOSEND !== "true") return { review: false, reason: "worker_disabled" };
    if (!pilotRecipientAllowed(msg.phone, this.env)) return { review: false, reason: "outside_pilot_scope" };
    if (!(await this.store.preflight(msg))) return { review: false, reason: "superseded_or_closed" };
    if (await this.isOwnedByHuman(msg)) return { review: false, reason: "crm_human_owned" };
    if (msg.type !== "text" && msg.type !== "interactive") {
      await this.handoff(msg, "media_or_unsupported_message_requires_review", `Non-text message (${msg.type}) needs staff review.`);
      return { review: true, reason: "unsupported_media" };
    }
    const t = String(msg.text || "").slice(0, 2000);
    if (this.textOnly()) return this.processTextOnly(msg, t);

    if (shouldHandoff(t)) {
      await this.text(msg, "human_ack", "Ji, main aapki baat hamari team se karwa deta hoon. Koi team member jald rabta karega.");
      await this.handoff(msg, "customer_requested_staff_or_risk", t.slice(0, 500));
      return { review: true, reason: "human_request" };
    }

    // Policy, warranty, financing and backup questions must not accidentally
    // trigger a quotation PDF merely because a capacity such as 10kW appears.
    if (requiresStaffPolicyReview(t)) {
      await this.text(msg, "policy_review", "Is sawal par hamari team verified tafseel check karke jawab degi. Aapka paigham consultant ko forward kar diya gaya hai.");
      await this.handoff(msg, "unverified_policy_requires_staff", t.slice(0, 500));
      return { review: true, reason: "unverified_policy_handoff" };
    }
    const pending = await this.store.pending(msg.phone);
    if (pending && String(pending.kind || "").startsWith("custom_")) {
      return this.continueCustom(msg, pending, t);
    }
    if (pending?.kind === "need_size" && !classifyRequest(t).sizes.length && /^(6|8|10|12|15|20)$/.test(t.trim())) {
      const c = classifyRequest(t);
      c.sizes = [Number(t.trim())];
      c.quoteIntent = true;
      return this.approvedFlow(msg, c, t);
    }
    if (pending?.kind === "need_type" && /^(hybrid|on.?grid|off.?grid)$/i.test(t.trim())) {
      const c = classifyRequest(t);
      c.type = /(?:off)/i.test(t) ? "off_grid" : /hybrid/i.test(t) ? "hybrid" : "on_grid";
      c.sizes = pending.sizes;
      c.quoteIntent = true;
      return this.approvedFlow(msg, c, t);
    }

    const classified = classifyRequest(t);

    if (classified.custom) return this.startCustom(msg);

    if (classified.quoteIntent || classified.sizes.length) {
      return this.approvedFlow(msg, classified, t);
    }

    const faqMatch = matchFaq(t, await this.faqs());
    if (faqMatch) {
      await this.text(msg, `faq:${faqMatch.id}`, faqMatch.answer);
      return { review: false, reason: "faq" };
    }

    let registry = [];
    try {
      registry = await this.approvedQuotes();
    } catch {
      registry = [];
    }
    const moos = await this.decideWithMoos(msg, registry);
    if (moos?.action === "faq" && typeof moos.faqId === "string") {
      const fact = (await this.faqs()).find((x) => x.id === moos.faqId && typeof x.answer === "string" && x.answer.length < 1500);
      if (fact) {
        await this.text(msg, `faq:${fact.id}`, fact.answer);
        return { review: false, reason: "faq" };
      }
    }
    if (moos?.action === "custom") return this.startCustom(msg);
    if (moos?.action === "clarify") {
      await this.text(msg, "clarify", "Shukriya! Sunchaser Energy Systems se rabta karne ka. Apna required system size (6/8/10/12/15/20 kW), city aur on-grid ya hybrid batayein.");
      return { review: false, reason: "clarify" };
    }
    await this.text(msg, "fallback", "Sunchaser Energy Systems se rabta karne ka shukriya. Hamari team aapka paigham dekh kar jald jawab degi. Aap apna solar system size aur on-grid ya hybrid bhi likh sakte hain.");
    await this.handoff(msg, moos?.action === "human" ? "moos_requested_staff" : "unresolved_message", t.slice(0, 500));
    return { review: true, reason: "fallback_handoff" };
  }

  async approvedFlow(msg, classified, t) {
    if (classified.type === "off_grid") {
      await this.text(msg, "offgrid_ack", "Off-grid system ke liye site survey zaroori hota hai. Hamari technical team aap se rabta kar ke details legi.");
      await this.handoff(msg, "off_grid_requires_consultant", t.slice(0, 500));
      return { review: true, reason: "off_grid" };
    }
    if (!classified.sizes.length) {
      await this.store.setPending(msg.phone, { kind: "need_size", expiresAt: Date.now() + ASK_TTL_MS });
      await this.text(msg, "ask_size", "Bara-e-meherbani batayein ke kaun se size ki quotation chahiye: 6, 8, 10, 12, 15 ya 20 kW? On-grid ya hybrid bhi mention karein.");
      return { review: false, reason: "need_size" };
    }
    if (classified.ambiguous) {
      await this.store.setPending(msg.phone, { kind: "need_type", sizes: classified.sizes, expiresAt: Date.now() + ASK_TTL_MS });
      await this.text(msg, "ask_type", "On-grid quotation chahiye ya hybrid? Apni pasand confirm karein.");
      return { review: false, reason: "ambiguous_type" };
    }
    if (classified.sizes.length > 3) {
      await this.text(msg, "too_many", "Aik waqt mein zyada se zyada 3 quotations bhej sakta hoon. Pehle 3 sizes batayein.");
      return { review: false, reason: "too_many" };
    }

    let registry = [];
    try {
      registry = await this.approvedQuotes();
    } catch (e) {
      await this.handoff(msg, "crm_quote_library_unavailable", String(e && e.message || e).slice(0, 200));
      return { review: true, reason: "library_unavailable" };
    }

    const quotes = [];
    for (const kw of classified.sizes.slice(0, 3)) {
      const found = matchApproved(registry, kw, classified.type);
      if (found.status === "clarify_type" || found.status === "ambiguous_revision") {
        await this.store.setPending(msg.phone, { kind: "need_type", sizes: classified.sizes, expiresAt: Date.now() + ASK_TTL_MS });
        await this.text(msg, "ask_type", `${kw} kW quotation ke liye on-grid ya hybrid confirm karein. Sirf maujooda approved package hi share kar sakta hoon.`);
        return { review: false, reason: "need_type" };
      }
      if (found.status !== "ok") {
        await this.text(msg, "missing", `Mazrat, ${kw} kW${classified.type ? " " + classified.type.replace("_", "-") : ""} ki maujooda approved quotation filhal tayyar nahi. Hamari team latest price check kar ke aap se share karegi.`);
        await this.handoff(msg, "approved_pdf_missing_or_expired", `No approved ${kw}kW${classified.type ? " " + classified.type : ""} PDF in library.`);
        return { review: true, reason: "missing_quote" };
      }
      quotes.push(found.quote);
    }
    await this.store.setPending(msg.phone, null);
    for (const q of quotes) await this.pdf(msg, q);
    return { review: false, reason: "sent_" + quotes.length + "_approved_pdfs" };
  }
}
