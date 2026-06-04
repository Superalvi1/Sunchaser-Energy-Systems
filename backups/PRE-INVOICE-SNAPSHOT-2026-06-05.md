# Pre-invoice module snapshot (2026-06-05)

Stable baseline before invoice module work.

## Git restore points

| Ref | Commit | Description |
|-----|--------|-------------|
| Tag | `pre-invoice-module-2026-06-05` | Annotated release point |
| Branch | `backup/pre-invoice-module-2026-06-05` | Long-lived restore branch |

```bash
# Checkout backup branch (detached or new branch from tag)
git fetch origin
git checkout backup/pre-invoice-module-2026-06-05

# Or reset main to snapshot (destructive — use with care)
git checkout main
git reset --hard pre-invoice-module-2026-06-05
```

## Included in this snapshot

- Role-based registration + email verification
- Dynamic RBAC (`roles`, `role_permissions`) with persistent Super Admin edits
- Customer system profiles + document upload (`customer-documents` bucket)
- React SPA on Render at `/`
- Client portal phases (through verified production checks)
- Supabase migration: `scripts/rbac-customer-profile-schema.sql`

## Local data copy

- `backups/sunchaser-backup-pre-invoice-2026-06-05.json` — copy of `database.json` at snapshot time

## Production

- URL: https://sunchaser-energy-systems.onrender.com
- Verify: `node scripts/verify-rbac-production-full.mjs`
