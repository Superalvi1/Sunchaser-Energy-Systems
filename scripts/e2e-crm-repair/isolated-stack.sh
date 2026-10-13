#!/usr/bin/env bash
# Builds a disposable, synthetic-data CRM stack for the repair journeys:
# PostgreSQL + PostgREST + a local S3-compatible store, plus an env file for `node dist/server.cjs`.
# Never point these variables at production. Requires: PostgreSQL 16 binaries, a PostgREST binary, openssl, node.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
STACK="${E2E_STACK_DIR:-/srv/sunchaser-e2e}"
PG_PORT="${E2E_PG_PORT:-55432}"
PGRST_PORT="${E2E_PGRST_PORT:-54321}"
S3_PORT="${E2E_S3_PORT:-9443}"
APP_PORT="${E2E_APP_PORT:-3100}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
POSTGREST="${POSTGREST_BIN:-postgrest}"
: "${TEST_PW:?Set TEST_PW to the password for the synthetic users}"

mkdir -p "$STACK"
chown postgres:postgres "$STACK" 2>/dev/null || true
if [ ! -d "$STACK/data" ]; then
  su postgres -c "$PG_BIN/initdb -D $STACK/data -U postgres --auth=trust" > "$STACK/initdb.log"
fi
su postgres -c "$PG_BIN/pg_ctl -D $STACK/data -o '-p $PG_PORT -k $STACK' -l $STACK/pg.log start" || true
sleep 2
PSQL="psql -h $STACK -p $PG_PORT -U postgres"
$PSQL -tAc "select 1 from pg_database where datname='sunchaser_test'" | grep -q 1 || $PSQL -qc "create database sunchaser_test"
P="$PSQL -d sunchaser_test -q"

$P <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
create or replace function auth.role() returns text language sql stable as $f$ select nullif(current_setting('request.jwt.claim.role', true), '') $f$;
create extension if not exists pgcrypto;
SQL

# Production's schema is not fully reproducible from tracked migrations; these files cover the journeys.
# Several are applied twice because they reference each other.
SCHEMA_FILES="supabase-schema.sql scripts/quotation-settings-schema.sql scripts/client-portal-schema.sql
scripts/client-crm-link-schema.sql scripts/client-portal-customer-user.sql scripts/client-portal-phase2-schema.sql
scripts/client-portal-pakistan-aftersales-schema.sql scripts/rbac-customer-profile-schema.sql
scripts/client-portal-phase3-schema.sql scripts/client-portal-phase4-schema.sql scripts/client-portal-phase5-schema.sql
scripts/client-portal-phase6-schema.sql scripts/client-portal-phase7-schema.sql scripts/client-portal-phase8-schema.sql
scripts/client-portal-phase9-schema.sql scripts/client-portal-phase10-schema.sql scripts/client-portal-phase11-schema.sql
scripts/customer-invitation-schema.sql scripts/leads-soft-delete-schema.sql scripts/migrate-user-roles.sql
scripts/migrate-user-roles-v2.sql scripts/user-registration-full-migration.sql scripts/user-registration-schema.sql
scripts/invoice-module-schema.sql scripts/invoice-status-schema.sql scripts/invoice-archive-schema.sql
scripts/invoice-vyapar-schema.sql scripts/invoice-bank-accounts-update.sql scripts/party-ledger-phase2-schema.sql
scripts/party-ledger-archive-schema.sql scripts/internal-costing-investor-schema.sql scripts/internal-costing-phase23-schema.sql
scripts/project-completion-warranty-schema.sql scripts/project-deliveries-completion-stage.sql
scripts/delivery-management-schema.sql scripts/delivery-verification-schema.sql scripts/interactive-proposals-schema.sql
scripts/design-sessions-schema.sql scripts/inventory-foundation-schema.sql scripts/unified-messaging-normalized-schema.sql
scripts/whatsapp-transport-schema.sql scripts/whatsapp-inbox-schema.sql scripts/whatsapp-hardening-rc124.sql
scripts/whatsapp-business-discovery-rc125.sql scripts/whatsapp-business-discovery-rc126.sql
scripts/whatsapp-connect-phase1a-2a-migration.sql scripts/whatsapp-web-session-lease-migration.sql
scripts/whatsapp-web-owner-diagnostics-migration.sql scripts/whatsapp-web-sync-jobs-migration.sql
scripts/whatsapp-web-contact-history-sync-migration.sql"
for pass in 1 2; do
  for f in $SCHEMA_FILES; do $P -f "$REPO/$f" > "$STACK/schema-pass$pass.log" 2>&1 || true; done
done
# Present in production but not in a tracked script.
$P -c "alter table public.invoices add column if not exists created_by_user_id text"
$P -v ON_ERROR_STOP=1 -f "$REPO/scripts/smart-quote-versions-schema.sql" > /dev/null
$P -c "grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant all on all functions in schema public to service_role;"

# Synthetic users (hashed passwords, onboarding completed).
(cd "$REPO" && TEST_PW="$TEST_PW" npx tsx -e '
import { hashPassword } from "./src/lib/passwordHash.ts";
const h = () => hashPassword(process.env.TEST_PW!);
const rows = [["u-test-admin","t_admin","Test Super Admin","Super Admin"],["u-test-sales","t_sales","Test Sales Exec","Sales Executive"],["u-test-accounts","t_accounts","Test Accounts","Accounts Manager"],["u-test-portal-a","t_portal_a","Synthetic Portal Client","Customer"],["u-test-portal-b","t_portal_b","Synthetic Other Client","Customer"]];
console.log("insert into public.users (id,username,password,name,email,role,account_status,email_verified,onboarding_completed) values " + rows.map(([id,u,n,r]) => `(\x27${id}\x27,\x27${u}\x27,\x27${h()}\x27,\x27${n}\x27,\x27${u}@example.test\x27,\x27${r}\x27,\x27Approved\x27,true,true)`).join(",") + " on conflict (id) do update set password = excluded.password;");
') | $P

# PostgREST with a service-role key signed by a local secret.
PGRST_SECRET="$(openssl rand -hex 32)"
SERVICE_KEY="$(cd "$REPO" && node -e "console.log(require('jsonwebtoken').sign({role:'service_role'},process.argv[1],{expiresIn:'30d'}))" "$PGRST_SECRET")"
cat > "$STACK/pgrst.conf" <<CONF
db-uri = "postgres://authenticator@/sunchaser_test?host=$STACK&port=$PG_PORT"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$PGRST_SECRET"
server-host = "127.0.0.1"
server-port = $PGRST_PORT
CONF
nohup "$POSTGREST" "$STACK/pgrst.conf" > "$STACK/pgrst.log" 2>&1 &

# Local S3-compatible store over HTTPS (does not verify request signatures).
mkdir -p "$STACK/s3"
grep -q "testbucket.s3.local" /etc/hosts || echo "127.0.0.1 s3.local testbucket.s3.local" >> /etc/hosts
[ -f "$STACK/s3/cert.pem" ] || openssl req -x509 -newkey rsa:2048 -nodes -keyout "$STACK/s3/key.pem" -out "$STACK/s3/cert.pem" -days 30 -subj "/CN=s3.local" -addext "subjectAltName=DNS:s3.local,DNS:testbucket.s3.local" 2>/dev/null
(cd "$STACK/s3" && S3_PORT="$S3_PORT" nohup node "$REPO/scripts/e2e-crm-repair/s3-mock.mjs" "$STACK/s3/objects" > "$STACK/s3/s3.log" 2>&1 &)

cat > "$STACK/env.sh" <<ENV
export NODE_ENV=production PORT=$APP_PORT JWT_EXPIRES_IN=8h LOGIN_RATE_LIMIT_MAX=500
export RAILWAY_POSTGREST_URL=http://127.0.0.1:$PGRST_PORT SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY
export JWT_SECRET=$(openssl rand -hex 32) RAILWAY_OBJECT_PROXY_SECRET=$(openssl rand -hex 32)
export RAILWAY_S3_ENDPOINT=https://s3.local:$S3_PORT RAILWAY_S3_BUCKET=testbucket RAILWAY_S3_ACCESS_KEY_ID=test RAILWAY_S3_SECRET_ACCESS_KEY=test RAILWAY_S3_REGION=auto
export NODE_EXTRA_CA_CERTS=$STACK/s3/cert.pem
export WHATSAPP_CONVERSATIONS_ENABLED=true WHATSAPP_APP_SECRET=$(openssl rand -hex 24) WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(openssl rand -hex 12) WHATSAPP_PHONE_NUMBER_ID=100000000000001
export WHATSAPP_TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
export WHATSAPP_AI_AUTO_REPLY_ENABLED=false WHATSAPP_AI_QUERY_DRAFT_ENABLED=false WHATSAPP_AI_LIVE_PROVIDER_ENABLED=false
export MARKETPLACE_ENABLED=false UNIFIED_MESSAGING_POSTGRES_ENABLED=false
export E2E_PSQL="-h $STACK -p $PG_PORT -U postgres -d sunchaser_test" E2E_BASE_URL=http://127.0.0.1:$APP_PORT
ENV
chmod 600 "$STACK/env.sh"
echo "Stack ready. Build with VITE_API_BASE_URL= (empty) so the UI calls the local server, then:"
echo "  source $STACK/env.sh && node dist/server.cjs"
