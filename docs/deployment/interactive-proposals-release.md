# Interactive proposals + client CRM link release runbook

Branch: `fix/client-crm-link-and-interactive-proposals`
Draft PR: https://github.com/Superalvi1/Sunchaser-Energy-Systems/pull/63

Do not merge to `main` or deploy production until SQL has been reviewed on staging
and Hassan is confirmed visible in CRM Clients.

## Required order

1. Apply `scripts/client-crm-link-schema.sql` in the target Supabase SQL editor.
2. Apply `scripts/backfill-client-crm-profiles.sql` (creates missing customer + lead rows, including Hassan).
3. Apply `scripts/interactive-proposals-schema.sql`.
4. Confirm the unique `customers.user_id` index created. If it fails, inspect duplicate `user_id` rows before retrying — do not drop existing customers.
5. Deploy the Express backend preview with the existing Supabase server credentials.
6. Deploy the Vite frontend preview with `VITE_API_BASE_URL` set to that backend.
7. Run the smoke checks below using a test lead and quotation.
8. Wait for explicit approval before production.

Do not expose `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, or a raw proposal token in logs, frontend
environment variables, screenshots, or analytics.

## Environment contract

No new secrets. Existing:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `SUPABASE_ANON_KEY`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `APP_URL` / `PUBLIC_BASE_URL` / `VITE_APP_URL` for public proposal links
- `VITE_API_BASE_URL`
- `CORS_ALLOWED_ORIGINS`

Do not change `.env.production` in this PR.

## Preview smoke checks

- Self-registering a Customer user creates `users.customer_id` → `customers.id` → `leads.customer_id`.
- Hassan (or another previously unlinked Customer user) appears under CRM Clients after SQL / login / `POST /api/admin/backfill-client-profiles`.
- Staff **Open Client Portal / Manage Client** opens only the selected lead.
- After client login the dashboard loads. Solar Wizard is optional, never a loop.
- Missing `users.customer_id` shows **Profile setup pending**, not a blank page.
- Staff can create a proposal only while authenticated and authorized for the lead.
- The generated `/proposal/<token>` URL opens without a CRM login (web path, hash route, `?proposal=`).
- Viewing the link changes status from `Sent` to `Viewed`.
- Panel, battery, inverter, and structure changes are repriced by the server.
- An invalid or out-of-range selection is normalized or rejected server-side.
- Accepting records the accepted configuration and price snapshot.
- Reopening an accepted proposal does not silently mutate the accepted snapshot.
- A revoked, expired, malformed, or unknown token does not reveal proposal data.
- The original saved quotation remains unchanged.
- Customer JWTs cannot call `/api/interactive-proposals` or `/api/leads`.
- `/health` remains healthy and the browser console has no CORS errors.

## Rollback

Roll back the application deployment first. The database migrations are additive, so
leave the new columns/tables in place during application rollback unless a separate
review authorizes schema removal. Revoke any test links created during smoke testing.
