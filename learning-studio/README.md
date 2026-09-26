# Sunchaser Learning Studio

Sunchaser Learning Studio is an isolated, Sunchaser-authenticated deployment of
OpenMAIC for AI-generated courses, narrated slide-based teaching, quizzes,
interactive classroom playback and optional live AI Q&A.

## V1 scope

V1 intentionally does **not** generate course videos or run the MP4 render
service. The product flow is:

1. A Sunchaser user creates or is assigned a course.
2. AI generates the course outline, slide scenes, narration script and quizzes.
3. Narration can be synthesized once and stored with the course.
4. Learners replay stored course content without regenerating it for every view.
5. Live AI Q&A is optional and can be metered separately.
6. Completion, assessment and usage data is linked back to Sunchaser CRM.

## Upstream

OpenMAIC is pinned to:

`21d83ec51b908a4b169ee2be7498a29da213c74d`

Do not silently track upstream `main`. Upgrade the pin only after reviewing
security, persistence and API changes.

OpenMAIC is MIT licensed. See `THIRD_PARTY_NOTICES.md`.

## Authentication

The CRM remains the identity source of truth.

1. An authenticated CRM request calls `POST /api/learning/sso-ticket`.
2. CRM signs a short-lived (90 second) HMAC ticket with `LEARNING_SSO_SECRET`.
3. The browser submits the ticket by POST to Learning Studio
   `/api/sunchaser-sso`.
4. Learning Studio verifies the ticket and creates an HttpOnly 8-hour session.
5. A stable HMAC-derived OpenMAIC owner UUID is set for compatibility with
   current OpenMAIC owner-scoped storage.

The SSO secret is server-only. Never expose it in a `VITE_` or
`NEXT_PUBLIC_` variable.

## Course access hardening

The overlay changes OpenMAIC document reads so a private course can only be read
by its owner. A published course can be read by authenticated Learning Studio
users. Writes and deletes remain owner-only.

Enrollment-level authorization is a separate Sunchaser policy layer and should
be enforced before paid/public rollout.

## Railway deployment

Deploy this directory as a separate Railway service from the same repository.

- Root directory: `/learning-studio`
- Dockerfile: `Dockerfile`
- Health check: `/api/health`
- Port: Railway `PORT`
- Suggested private/staging service name: `sunchaser-learning-studio-staging`

Required variables for the first authenticated smoke:

```
NODE_ENV=production
LEARNING_SSO_SECRET=<same high-entropy value as CRM>
SUNCHASER_CRM_URL=https://crm.sunchaserenergy.co
LEARNING_PUBLIC_URL=https://sunchaser-learning-studio-staging-production.up.railway.app
```

Do not enable paid AI until authentication and access isolation pass.

When generation is enabled later, add at least one server-side LLM provider
credential supported by OpenMAIC. Provider keys belong only on this Railway
service.

For the private OpenClaw subscription gateway used by Sunchaser, configure:

```
OPENAI_API_KEY=<same value as the private gateway bearer token>
OPENAI_BASE_URL=http://learning-openclaw.railway.internal:18789/v1
OPENAI_MODELS=openclaw/default
DEFAULT_MODEL=openai:openclaw/default
```

`learning-openclaw` must run in this same Railway project and environment.
Do not expose its gateway publicly. Railway private DNS does not cross project
or environment boundaries.

## Persistence safety

Do **not** enable OpenMAIC's development
`NEXT_PUBLIC_PERSISTENCE_TOKEN` authentication on a public production
deployment. Upstream explicitly documents it as development-only and not a
user-isolation mechanism.

Sunchaser's durable application records live in PostgreSQL using
`scripts/learning-studio-schema.sql`. The production generation worker will
claim jobs from `learning_generation_jobs` rather than rely on a web-process
filesystem job runner.

## Video policy for V1

Keep these disabled:

```
NEXT_PUBLIC_ENABLE_VIDEO_EXPORT=false
NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=false
```

Do not deploy OpenMAIC's render-service container in V1.
