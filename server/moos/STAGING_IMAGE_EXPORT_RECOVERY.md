# Moos CRM — Railway staging image-export recovery (2026-10-15)

This file documents the staging-only build retry and intentionally has **no runtime effect**.

## Incident

Railway service `moos-crm-isolated-staging` in the dedicated **Sunchaser Railway Staging** project failed deployment `99649722-cd9f-4544-b4f0-12482893aff3` while exporting a Railpack container image:

```text
Build Failed: build daemon returned an error
Internal: unknown blob sha256:... in history
```

Vite and esbuild compiled successfully beforehand. Railway did not reach application
startup for this deployment; the previous successful service remained online.
The exact root cause is not established, but the error originated from the
Railway build/image-cache/export layer, not a TypeScript compile error.

## Recovery attempt

This docs-only change triggers one fresh GitHub-source build because Railway
watches `/server/moos/**`. It must not change the existing CRM or worker app behavior.
Do not retry by merging the draft PR, switching domains, disabling health checks,
or changing a production database.

## Staging guardrails and acceptance

- `MOOS_ENABLED=false` (CRM)
- `MOOS_RELAY_ENABLED=false` (CRM)
- `WHATSAPP_AI_AUTO_REPLY_ENABLED=false` (CRM)
- `ENABLE_AUTOSEND=false` (worker)
- `MOOS_TEST_ONLY_RECIPIENT_E164` must remain set to the user-approved
  recipient in the **private Railway staging configuration**.
- Require a successful new CRM staging build *and* healthy app deployment.
- Require latest GitHub Moos no-send test and CRM preflight success.
- A health check alone does not prove WhatsApp/CRM operations: staging CRM
  still needs an isolated functional data backend, approved PDF fixture,
  Meta/provider connection and verified legacy-agent exclusion.
- A real 10 kW hybrid PDF test must not occur until those gates pass.
  Do not activate general customer auto-replies or merge the draft PR.

If the fresh build fails with another `unknown blob`, inspect Railway's
new build log and consider a cache reset through supported Railway mechanisms.
Avoid altering runtime application code solely to mask infrastructure failure.
