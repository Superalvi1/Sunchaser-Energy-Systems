/**
 * Startup smoke test for the production CJS bundle.
 * Launches dist/server.cjs, waits for GET /health, then exits cleanly.
 *
 * Usage: node scripts/smoke-server-start.mjs
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "dist", "server.cjs");
// server.ts listens on hardcoded 3000
const port = Number(process.env.SMOKE_PORT || 3000);
const healthUrl = `http://127.0.0.1:${port}/health`;
const maxWaitMs = Number(process.env.SMOKE_TIMEOUT_MS || 45000);

if (!fs.existsSync(serverPath)) {
  console.error(`[smoke] missing ${serverPath} — run build first`);
  process.exit(1);
}

const child = spawn(process.execPath, [serverPath], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    PLAYWRIGHT_BROWSERS_PATH: "0",
    // Production inbox wiring requires an encryption key when Supabase is configured.
    WHATSAPP_TOKEN_ENCRYPTION_KEY:
      process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY ||
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
let finished = false;

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

function shutdown(code) {
  finished = true;
  if (!child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(code), 250);
}

child.on("exit", (code, signal) => {
  if (finished) return;
  console.error(`[smoke] server exited early code=${code} signal=${signal}`);
  if (stderr) console.error(stderr.slice(0, 2000));
  if (stdout) console.error(stdout.slice(0, 2000));
  process.exit(code || 1);
});

const started = Date.now();
let healthy = false;

while (Date.now() - started < maxWaitMs) {
  const combined = `${stderr}\n${stdout}`;
  if (combined.includes("ERR_INVALID_ARG_TYPE")) {
    console.error("[smoke] FAIL: ERR_INVALID_ARG_TYPE detected");
    console.error(combined.slice(0, 2000));
    shutdown(1);
    break;
  }
  try {
    const res = await fetch(healthUrl);
    if (res.ok) {
      const body = await res.json();
      if (body?.status === "ok") {
        healthy = true;
        break;
      }
    }
  } catch {
    /* not ready yet */
  }
  await delay(400);
}

if (!healthy) {
  console.error("[smoke] FAIL: /health did not become ready");
  console.error((stderr || stdout).slice(0, 2000));
  shutdown(1);
} else {
  console.log(`[smoke] PASS: ${healthUrl} responded status=ok`);
  shutdown(0);
}
