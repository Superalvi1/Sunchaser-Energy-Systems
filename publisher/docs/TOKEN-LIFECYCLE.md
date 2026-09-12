# Token lifecycle (production)

See PARALLEL-REVIEW.md §6 for the full tables.

Facebook: short user → long user (~60d) → Page token via `/accounts` (no expiry if minted from long user). Persist `tokenIssuedAt`. Reexchange only when the user token is **≥ 24h old** and remaining ≤ 7 days. Never assume issued-at = now-48h. `debug_token` distinguishes expiry vs revoke (190/463 vs 190/460). Do **not** bind a Page token until the user picks a Page.

TikTok: access 86400s, refresh 31536000s, **rotate refresh_token**, refresh 1h before access expiry, store `refresh_token_expires_at` and `tokenIssuedAt`.

Never log tokens. Envelope format shared with CRM WhatsApp crypto, **different key**.
