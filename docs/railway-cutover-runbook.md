# Sunchaser Energy Systems — Railway Production Cutover Runbook

**Environment:** Production  
**Target Domains:**
- CRM: `https://crm.sunchaserenergy.co`
- Marketing Website: `https://www.sunchaserenergy.co`
- Apex Redirect: `https://sunchaserenergy.co` → `https://www.sunchaserenergy.co`
- Quote Tool: `https://quote.sunchaserenergy.co`
- SmartQuote: `https://smartquote.sunchaserenergy.co`

---

## 1. Cutover Timeline & Execution Checklist

### Phase 1: Pre-Cutover Verification (T-24 Hours) — [COMPLETE]
- [x] Run baseline audit across both repositories (`docs/railway-final-audit.md`).
- [x] Run comprehensive authenticated smoke suite (23/23 tests passed, 100%).
- [x] Run read-only data reconciliation (zero orphaned records, billing parity confirmed).
- [x] Verify valid TLS certificates across all 5 public domains.
- [x] Confirm Apex domain 301 permanent redirect to `www.sunchaserenergy.co`.
- [x] Confirm Railway scheduled marketplace price sync is succeeding.
- [x] Mount structured readiness probes (`/ready`, `/api/ready`) and correlation IDs.

### Phase 2: Cutover Execution (T-0)
1. **Pre-flight Health Probes:**
   \`\`\`bash
   curl -sI https://crm.sunchaserenergy.co/health
   curl -sI https://crm.sunchaserenergy.co/ready
   curl -sI https://www.sunchaserenergy.co
   curl -sI https://quote.sunchaserenergy.co
   curl -sI https://smartquote.sunchaserenergy.co
   \`\`\`
   All must return HTTP `200 OK`.

2. **DNS Routing Confirmation:**
   - Authoritative DNS on GoDaddy routes:
     - `crm.sunchaserenergy.co` → Railway CNAME
     - `quote.sunchaserenergy.co` → Railway CNAME
     - `smartquote.sunchaserenergy.co` → Railway CNAME
     - `www.sunchaserenergy.co` → Vercel CNAME (or Railway Marketing container)
     - `sunchaserenergy.co` (Apex) → HTTP 301 redirect to `www.sunchaserenergy.co`

3. **Deploy chore/railway-final-cutover:**
   - Merge `chore/railway-final-cutover` into `main` after PR approval.
   - Confirm Railway CI/CD builds and deploys successfully.
   - Run verification smoke test: `npm run test:comprehensive-smoke`.

### Phase 3: Post-Cutover Observation Window (48–72 Hours)
- Keep legacy services (Render, Supabase, Vercel) online and idle.
- Monitor error logs and request correlation IDs in Railway Dashboard.
- Monitor daily price sync execution at midnight PKT.
- Verify lead captures from Marketing, Quote, and SmartQuote tools in real time.
- Verify customer document uploads and quotation PDF generation.

---

## 2. Validation Commands Reference

\`\`\`bash
# 1. Run live comprehensive smoke suite
npm run test:comprehensive-smoke

# 2. Run data reconciliation audit
node scripts/reconcile-railway-supabase.mjs

# 3. Check readiness endpoint with database latency & memory
curl -s https://crm.sunchaserenergy.co/ready | jq .

# 4. Check PDF rendering engine status
curl -s https://crm.sunchaserenergy.co/api/debug/pdf-engine | jq .
\`\`\`
