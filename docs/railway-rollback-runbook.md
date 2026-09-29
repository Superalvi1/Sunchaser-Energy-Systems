# Sunchaser Energy Systems — Railway Production Rollback Runbook

**Purpose:** Rapid, non-destructive fallback to legacy infrastructure in the event of an unforeseen production incident on Railway during the cutover observation period.

---

## 1. Rollback Decision Triggers

Initiate immediate rollback if any of the following occur:
1. **Critical Service Outage:** Unresolved 5xx error rate > 5% on `crm.sunchaserenergy.co` for > 15 consecutive minutes.
2. **Data Inconsistency:** Database connection failures or transactional integrity failures that cannot be resolved in-place.
3. **Core Workflow Failure:** PDF generation engine or payment/invoice processing unrecoverable.
4. **Security Alert:** Unauthorized data access or RLS regression.

---

## 2. Legacy Service Inventory & Standby Endpoints

| Service | Legacy Platform | Standby URL / Endpoint | Status |
| :--- | :--- | :--- | :--- |
| **CRM Backend & SPA** | Render | `https://sunchaser-energy-systems.onrender.com` | Standby / Running |
| **Database** | Supabase | `xxtdfvgkurxabpbmjban.supabase.co` | Standby / Running |
| **Marketing Website** | Vercel | `https://sunchaser-marketing-website.vercel.app` | Standby / Running |
| **Quote Tool** | Vercel | `https://quote-sunchaser.vercel.app` | Standby / Running |
| **SmartQuote** | Vercel | `https://smartquote-sunchaser.vercel.app` | Standby / Running |

---

## 3. Step-by-Step Rollback Execution

### Step 1: DNS Fallback (GoDaddy DNS Management)
If Railway routing or edge networking is impaired:
1. Access GoDaddy DNS Management for `sunchaserenergy.co`.
2. Update CNAME records:
   - `crm.sunchaserenergy.co` → Point back to `sunchaser-energy-systems.onrender.com`
   - `quote.sunchaserenergy.co` → Point back to Vercel CNAME
   - `smartquote.sunchaserenergy.co` → Point back to Vercel CNAME
3. Set TTL to 600s (10 minutes) for fast propagation.

### Step 2: Database Traffic Fallback
The CRM backend codebase maintains dual-read fallback support for `DATABASE_URL || SUPABASE_DB_URL` and `SUPABASE_URL`:
1. If the database must revert to Supabase:
   - In Render (or Railway service env vars), ensure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are prioritized.
   - Restart the service.
2. Verify database connection:
   \`\`\`bash
   curl -sI https://sunchaser-energy-systems.onrender.com/health
   \`\`\`

### Step 3: Marketing Website API Fallback
In `Sunchaser-Marketing-Website`:
1. Update `NEXT_PUBLIC_CRM_API_BASE_URL` in Vercel to `https://sunchaser-energy-systems.onrender.com`.
2. Trigger an immediate deployment in Vercel.

### Step 4: Verification of Rollback
1. Verify CRM login at Render URL:
   \`\`\`bash
   curl -s -X POST https://sunchaser-energy-systems.onrender.com/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"<CRM_ADMIN_PASSWORD>"}'
   \`\`\`
2. Verify customer leads and invoices are accessible.
3. Notify the team and log incident details.
