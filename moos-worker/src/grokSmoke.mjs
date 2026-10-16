/**
 * Explicit, text-only Grok staging smoke test. NEVER touches Meta / CRM / WhatsApp.
 * Run only after XAI_API_KEY is installed privately in Railway worker variables.
 */
import { GrokReplyClient } from "./grokClient.mjs";
if (!process.env.XAI_API_KEY) {
  console.error("XAI_API_KEY missing. Add only to staging Railway service variables.");
  process.exitCode = 2;
} else {
  const c = new GrokReplyClient({...process.env,MUSE_GROK_ENABLED:"true"});
  const safe = await c.respond("Please explain on-grid solar in one short sentence.",[]);
  if (safe?.action === "reply" && safe.reply.length <= 450) {
    console.log("Muse xAI synthetic test PASS: structured short response received, no WhatsApp send");
  } else {
    console.error("Muse xAI synthetic test NOT READY: provider unavailable, handoff, or unsafe response");
    process.exitCode = 1;
  }
}
