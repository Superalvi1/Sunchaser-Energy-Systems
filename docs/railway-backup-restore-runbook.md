# Sunchaser Energy Systems — Railway PostgreSQL Backup & Restore Runbook

**Document Version:** 1.0.0  
**Target Environment:** Railway Production  
**Project ID:** \`11d4acc0-4f19-4c05-a41c-fa20d3b235af\`  
**Environment ID:** \`a3fcb877-f02b-44b5-af5c-f03fac71f05b\`  
**Author:** DevOps & Security Cutover Team  
**Last Updated:** September 2026  

---

## 1. Objectives & Metrics

- **Recovery Point Objective (RPO):** < 1 hour (automated continuous WAL archiving + pre-cutover logical dump)
- **Recovery Time Objective (RTO):** < 15 minutes (direct schema & data restore into temporary staging instance)
- **Zero Production Overwrite Rule:** Restores are **ALWAYS** performed into an isolated temporary database or testing instance. Never restore over the active production database.

---

## 2. Backup Procedures

### A. Automated Railway Managed Snapshots
1. Railway creates automated daily volume snapshots of the PostgreSQL service.
2. Snapshots are accessible in the Railway Dashboard under **Postgres Service → Backups**.
3. Snapshot retention: 7 days rolling.

### B. Manual Encrypted Logical Backup (Pre-Cutover Standard)
To create an encrypted snapshot before any major deployment or DNS cutover:

\`\`\`bash
# 1. Export DATABASE_URL securely (do not hardcode or commit)
export BACKUP_TIMESTAMP=$(date +%Y%m%d_%H%M%S)
export BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"

# 2. Execute pg_dump with custom compressed archive format
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="${BACKUP_DIR}/sunchaser_prod_${BACKUP_TIMESTAMP}.dump"

# 3. Encrypt the backup archive using AES-256-CBC (or age / gpg)
openssl enc -aes-256-cbc -salt -pbkdf2 \
  -in "${BACKUP_DIR}/sunchaser_prod_${BACKUP_TIMESTAMP}.dump" \
  -out "${BACKUP_DIR}/sunchaser_prod_${BACKUP_TIMESTAMP}.dump.enc" \
  -pass "pass:${BACKUP_ENCRYPTION_KEY}"

# 4. Remove plaintext unencrypted dump
rm "${BACKUP_DIR}/sunchaser_prod_${BACKUP_TIMESTAMP}.dump"

# 5. Verify encrypted file checksum
sha256sum "${BACKUP_DIR}/sunchaser_prod_${BACKUP_TIMESTAMP}.dump.enc" > "${BACKUP_DIR}/sunchaser_prod_${BACKUP_TIMESTAMP}.sha256"
\`\`\`

---

## 3. Non-Destructive Restore Procedure (Temporary Database)

### Step 1: Provision Isolated Temporary Service
1. In the Railway Dashboard (or CLI), create a temporary PostgreSQL service:
   \`\`\`bash
   railway add --plugin postgresql --service sunchaser-restore-test
   \`\`\`
2. Retrieve the temporary database connection string: \`TEMP_DATABASE_URL\`.

### Step 2: Decrypt the Backup
\`\`\`bash
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "${BACKUP_DIR}/sunchaser_prod_${BACKUP_TIMESTAMP}.dump.enc" \
  -out "${BACKUP_DIR}/sunchaser_restore_${BACKUP_TIMESTAMP}.dump" \
  -pass "pass:${BACKUP_ENCRYPTION_KEY}"
\`\`\`

### Step 3: Execute pg_restore into Temporary Database
\`\`\`bash
pg_restore \
  --dbname="$TEMP_DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  --verbose \
  "${BACKUP_DIR}/sunchaser_restore_${BACKUP_TIMESTAMP}.dump"
\`\`\`

---

## 4. Post-Restore Integrity Verification

Run the following SQL diagnostics on the restored database:

\`\`\`sql
-- 1. Table Count Verification (Must equal 142)
SELECT count(*) AS total_tables 
FROM information_schema.tables 
WHERE table_schema = 'public';

-- 2. Foreign Key & Unique Constraints (Must equal 460)
SELECT count(*) AS total_constraints 
FROM information_schema.table_constraints 
WHERE constraint_schema = 'public';

-- 3. Indexes Count (Must equal 372)
SELECT count(*) AS total_indexes 
FROM pg_indexes 
WHERE schemaname = 'public';

-- 4. RLS-Enabled Tables (Must equal 142)
SELECT count(*) AS rls_tables 
FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = true;

-- 5. Core Record Counts Verification
SELECT 'users' AS entity, count(*) FROM users
UNION ALL
SELECT 'invoices', count(*) FROM invoices
UNION ALL
SELECT 'customers', count(*) FROM customers
UNION ALL
SELECT 'leads', count(*) FROM leads
UNION ALL
SELECT 'mp_products', count(*) FROM mp_products;
\`\`\`

### Step 5: Clean Up
Once verification completes:
1. Delete the decrypted plaintext dump file: \`rm ${BACKUP_DIR}/sunchaser_restore_${BACKUP_TIMESTAMP}.dump\`.
2. Deprovision the temporary Railway service \`sunchaser-restore-test\`.

---

## 5. Emergency Rollback Triggers

If any of the following occur during or immediately following cutover:
- Critical table corruption or missing foreign keys
- RLS policy bypass or authorization failure
- Database connection pool saturation (>95% pool exhaustion for >5 minutes)

Follow [docs/railway-rollback-runbook.md](file:///Users/apple/antigravity/Sunchaser-Energy-Systems/docs/railway-rollback-runbook.md) immediately to revert traffic to the standby Supabase instance.
