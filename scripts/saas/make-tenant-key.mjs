// Mints the PostgREST key for the non-bypass crm_tenant role. Run OFFLINE by the owner; the signing secret is read
// from an environment variable and is never printed or written anywhere.
//   PGRST_JWT_SECRET='<postgrest jwt secret>' node scripts/saas/make-tenant-key.mjs [--days 365]
// Put the printed key into the CRM service variable CRM_TENANT_POSTGREST_KEY. Re-run to rotate.
import jwt from "jsonwebtoken";
const secret = process.env.PGRST_JWT_SECRET;
if (!secret || secret.length < 32) { console.error("Set PGRST_JWT_SECRET (the PostgREST jwt-secret, at least 32 characters)."); process.exit(2); }
const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : 365;
if (!Number.isFinite(days) || days < 1 || days > 730) { console.error("--days must be 1..730"); process.exit(2); }
process.stdout.write(jwt.sign({ role: "crm_tenant", purpose: "crm-tenant-v1" }, secret, { expiresIn: `${days}d` }) + "\n");
