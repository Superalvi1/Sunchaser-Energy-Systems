import http from "node:http";
import { fileURLToPath } from "node:url";
import { Store } from "./store.mjs";
import { Agent } from "./agent.mjs";
import { CrmClient } from "./crm.mjs";
import { verifyRelaySignature, validRelayEvent } from "./signature.mjs";
import { pilotRecipientAllowed } from "./pilotScope.mjs";

function bodyOf(req) {
  return new Promise((resolve, reject) => {
    const pieces = [];
    let size = 0;
    req.on("data", (part) => {
      size += part.length;
      if (size > 1024 * 1024) { reject(new Error("too_large")); req.destroy(); return; }
      pieces.push(part);
    });
    req.on("end", () => resolve(Buffer.concat(pieces)));
    req.on("error", reject);
  });
}

/**
 * Build the worker HTTP server + queue pump from injected parts.
 * Production wires the real pg Store / CrmClient / Agent; integration tests
 * inject fakes. The relay endpoint, HMAC verification, dedup and the
 * agent turn are the real code in both cases.
 */
export function createWorkerServer({ store, crm, agent, env }) {
  let draining = false;
  async function tick() {
    if (draining) return;
    draining = true;
    try {
      const job = await store.claim();
      if (!job) return;
      const m = job.payload;
      try {
        const r = await agent.process(m);
        await store.finish(m.messageId, r.review, r.reason);
      } catch (e) {
        console.error("[moos] Agent processing error", m.messageId, String(e).slice(0, 150));
        await agent.handoff(m, "send_or_processing_error_review");
        await store.finish(m.messageId, true, "send_or_processing_error");
      }
    } catch (e) {
      console.error("[moos] Queue database error", String(e).slice(0, 150));
    } finally {
      draining = false;
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      if (req.method === "GET" && u.pathname === "/healthz") { res.writeHead(200); res.end("ok"); return; }

      // Signed CRM relay — the ONLY ingress. The CRM verifies the Meta signature,
      // records and deduplicates first; this endpoint trusts only the relay HMAC.
      if (req.method === "POST" && u.pathname === "/webhooks/crm") {
        const raw = await bodyOf(req);
        if (!verifyRelaySignature(raw, req.headers["x-relay-signature-256"], env.RELAY_SECRET)) {
          res.writeHead(401); res.end("bad signature"); return;
        }
        let m;
        try { m = JSON.parse(raw.toString("utf8")); } catch { res.writeHead(400); res.end("bad json"); return; }
        if (!validRelayEvent(m)) { res.writeHead(422); res.end("invalid event"); return; }
        // Phone-number binding: ignore events for a different WhatsApp number.
        if (m.phoneNumberId !== env.MOOS_PHONE_NUMBER_ID) { res.writeHead(422); res.end("wrong number"); return; }
        // Signed relays outside the explicitly approved pilot phone cannot
        // become queue jobs, even if the CRM relay were misconfigured.
        if (!pilotRecipientAllowed(m.phone, env)) {
          res.writeHead(403); res.end("outside approved Muse pilot scope"); return;
        }
        await store.add({ ...m, text: typeof m.text === "string" ? m.text.slice(0, 4000) : "" });
        res.writeHead(200); res.end("accepted"); return;
      }

      res.writeHead(404); res.end("not found");
    } catch (e) {
      console.error("[moos] Webhook error", String(e).slice(0, 150));
      if (!res.headersSent) { res.writeHead(500); res.end("internal error"); }
    }
  });

  return { server, tick };
}

// ---- production boot (only when run directly, not when imported by tests) ----
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const env = process.env;

  // ---- boot validation (fail closed) ----
  // The worker holds NO Meta credentials: all sends execute inside the CRM via
  // the /api/moos/* action endpoints. MOOS_PHONE_NUMBER_ID is a non-secret
  // binding so the worker only processes events for our business number.
  for (const k of ["DATABASE_URL", "RELAY_SECRET", "CRM_BASE_URL", "MOOS_SERVICE_TOKEN", "ENABLE_AUTOSEND", "MOOS_PHONE_NUMBER_ID"]) {
    if (!env[k]) throw new Error("Missing " + k);
  }
  if (env.NODE_ENV === "production" && env.ENABLE_AUTOSEND !== "true") {
    console.log("[moos] production boot with ENABLE_AUTOSEND=false: worker will process but not send (handoff only).");
  }

  const store = new Store(env.DATABASE_URL);
  const crm = new CrmClient(env);
  const agent = new Agent(store, crm, env);

  const recovered = await store.recovered();
  if (recovered.length) console.error("[moos] Unfinished sends/jobs held for manual review:", recovered.length);

  const { server, tick } = createWorkerServer({ store, crm, agent, env });
  setInterval(tick, 1100).unref();

  server.listen(Number(env.PORT || 3000), () =>
    console.log("[moos] worker listening, autosend =", env.ENABLE_AUTOSEND, "crm =", env.CRM_BASE_URL));
  const stop = async () => { server.close(); await store.close(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
