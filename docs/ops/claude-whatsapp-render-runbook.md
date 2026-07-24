# Claude WhatsApp — Render live-test service runbook

**Audience:** Muhammad (Render Dashboard)  
**Branch:** `feature/claude-whatsapp-web`  
**Goal:** Run Baileys on a dedicated Render web service so production CRM deploys do not bounce the WhatsApp Web session.

---

## CRITICAL — what this is / is not

| | |
|---|---|
| **Shared (intentional)** | **Production Supabase** project `xxtdfvgkurxabpbmjban` (`https://xxtdfvgkurxabpbmjban.supabase.co`). Inbox messages, sessions table, kill switch — same data as prod. |
| **Isolated** | **Compute only** — a second Render web service (`sunchaser-claude-whatsapp`) on branch `feature/claude-whatsapp-web`. |
| **Not** | A full staging environment. Do **not** treat this as a separate database or a safe place to wipe data. |

---

## Prerequisite

1. Confirm GitHub has branch `feature/claude-whatsapp-web` (ask the engineer to **push** if it is still local-only). Render cannot build a branch that is not on GitHub.
2. Confirm migration `scripts/claude-whatsapp-web-migration.sql` has been applied on production Supabase (sessions table + `claude_whatsapp_enabled` setting).

---

## Steps (Render Dashboard — manual create)

### A. Open the production service (source of env vars)

1. Go to [https://dashboard.render.com](https://dashboard.render.com) and sign in.
2. Open the **production** web service (the one whose URL is `https://sunchaser-energy-systems.onrender.com`).
3. Open the **Environment** tab.
4. Keep this tab open — you will **copy variable names and values** from here. Do not change production.

### B. Create the new web service

5. In the top-right, click **New +** → **Web Service**.
6. Select the **Sunchaser-Energy-Systems** GitHub repository (same repo as production).
7. Set fields exactly as follows:

| Field | Value |
|-------|--------|
| **Name** | `sunchaser-claude-whatsapp` |
| **Region** | Same region as production |
| **Branch** | `feature/claude-whatsapp-web` *(not `main`)* |
| **Language / Runtime** | Node |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run start` |
| **Instance type** | Starter (or same paid tier as prod if Starter is unavailable) |

8. Under **Auto-Deploy**, set to **No** / **Off** (manual deploys only — prevents mid-test restarts from branch commits).
9. Do **not** click Create yet — add environment variables first (next section).

### C. Environment variables

10. In the new service’s **Environment** section, add every variable below.

#### Set these three explicitly (do not copy PUBLIC_BASE_URL from prod)

| Key | Value |
|-----|--------|
| `NODE_ENV` | `production` |
| `PLAYWRIGHT_BROWSERS_PATH` | `0` |
| `PORT` | `3000` |
| **`PUBLIC_BASE_URL`** | **`https://sunchaser-claude-whatsapp.onrender.com`** |

> Production uses `https://sunchaser-energy-systems.onrender.com`. This service **must** use the Claude WhatsApp URL above.

#### Copy from production (same names, same values)

Copy these **by name** from the production Environment tab. If a key is missing on production, skip it.

**Required for inbox + Claude WhatsApp session store**

- `SUPABASE_URL` → must be `https://xxtdfvgkurxabpbmjban.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`

**Copy if present on production**

- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `APP_URL`
- `PUBLIC_LEAD_API_KEY`
- `CORS_ALLOWED_ORIGINS`
- `WHATSAPP_CONVERSATIONS_ENABLED`
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_API_VERSION`
- `WHATSAPP_APP_ID`
- `WHATSAPP_META_CONFIG_ID`
- `WHATSAPP_TOKEN_ENCRYPTION_KEY`
- `VITE_API_BASE_URL` *(optional for this live test; if set for build, prefer `https://sunchaser-claude-whatsapp.onrender.com`)*
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_META_APP_ID`
- `VITE_META_CONFIG_ID`
- `VITE_META_GRAPH_VERSION`
- `VITE_ENABLE_GOOGLE_MAPS_PROVIDER`
- `VITE_GOOGLE_MAPS_API_KEY`
- `MARKETPLACE_ENABLED`
- `MARKETPLACE_GATEWAY_ENABLED`

11. Double-check: **`PUBLIC_BASE_URL` is NOT the production URL.**

### D. Deploy and verify

12. Click **Create Web Service** (or **Deploy**).
13. Wait until the deploy status is **Live**.
14. Open: `https://sunchaser-claude-whatsapp.onrender.com/health`  
    Expect: `{"status":"ok"}` (or equivalent ok JSON).
15. Open: `https://sunchaser-claude-whatsapp.onrender.com/`  
    Expect: Sunchaser login / CRM shell (same app, different host).
16. Log in as Admin → Shared Inbox → **Claude WhatsApp** (amber panel) → use this host for QR pairing and the kill switch.

### E. During the 2-day test

17. Do **not** redeploy this service unless asked.
18. Leave production (`sunchaser-energy-systems`) alone for marketplace/`main` deploys — they will not restart this service.
19. Kill switch: Inbox → Claude WhatsApp → **Turn OFF** (takes effect in a few seconds; no redeploy).

### F. After the test

20. Claude WhatsApp panel → **Turn OFF**.
21. Optionally **Suspend** or **Delete** `sunchaser-claude-whatsapp` in Render to stop billing.
22. Production Coexistence / Cloud API path remains unchanged.

---

## Optional later: Blueprint apply

Repo file `render.yaml` documents this service. After `feature/claude-whatsapp-web` is on GitHub you may use **New + → Blueprint** and select that branch; still enter all `sync: false` secrets from production. Prefer the manual steps above if the branch is not pushed yet.

---

## Reminder

**Shared data / isolated compute** — same production Supabase (`xxtdfvgkurxabpbmjban`), separate Render process. Not a disposable staging database.
