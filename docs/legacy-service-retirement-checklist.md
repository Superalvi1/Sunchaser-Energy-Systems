# Sunchaser Energy Systems — Legacy Service Retirement Checklist

**Mandatory Rule:** Do **NOT** retire, decommission, or delete any legacy service (Render, Supabase, Vercel) until all conditions on this checklist are met and verified by leadership.

---

## 1. Prerequisites for Legacy Decommissioning

- [ ] **48–72 Hour Stability Window:** Railway production has operated continuously with zero critical incidents for at least 72 hours.
- [ ] **Traffic Confirmation:** Web server logs show 100% of production traffic arriving at Railway endpoints (`crm`, `www`, `quote`, `smartquote`). Zero incoming production traffic on Render.
- [ ] **Data Finality Verification:** Run `node scripts/reconcile-railway-supabase.mjs` to ensure no data drift has occurred.
- [ ] **Final Encrypted Backup:** Take an offline, encrypted `pg_dump` of both Railway PostgreSQL and Supabase PostgreSQL. Store securely in encrypted long-term cold storage.
- [ ] **External Integrations Cut Over:**
  - [ ] WhatsApp Webhook confirmed receiving events at Railway.
  - [ ] Meta (Facebook/Instagram) Lead Ads sending leads to Railway CRM.
  - [ ] Google OAuth redirect URIs updated and tested.
  - [ ] Android App API base verified pointing to `https://crm.sunchaserenergy.co`.

---

## 2. Order of Decommissioning

### Stage 1: Render Services (T+72h Minimum)
1. Turn off auto-deploy on Render.
2. Put Render service into "Suspended" mode for 7 days before deletion.
3. If no errors or traffic spikes occur, delete Render web service and background workers.

### Stage 2: Legacy Vercel Deployments (T+72h Minimum)
1. Remove custom domains from old Vercel project (if traffic has migrated to Railway Marketing).
2. Archive old preview deployments.

### Stage 3: Supabase Legacy Project (T+14 Days Minimum)
1. Change Supabase project settings to pause database compute.
2. Maintain snapshot in cold storage for 90 days.
3. Decommission project only after quarterly financial close confirms all invoices and payments reconcile.
