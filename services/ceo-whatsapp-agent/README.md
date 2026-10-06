# Superalvi1 WhatsApp CEO Agent

Private test worker for WhatsApp's personal-account Third-Party Agents feature.

## Security
- The WhatsApp agent token is supplied only through Railway environment variables.
- No token is committed to GitHub.
- Database access is forced to read-only at the PostgreSQL session level.
- This test build does not send customer WhatsApp messages or mutate CRM data.

## Commands
- `ping`
- `status`
- `leads`
- `crm`
- `who are you`
- `help`

## Runtime
Uses Meta/WhatsApp Agent Platform long polling through `whagent==0.1.0`.
