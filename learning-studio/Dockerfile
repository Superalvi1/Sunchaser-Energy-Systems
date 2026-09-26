# syntax=docker/dockerfile:1

# Sunchaser overlay is deliberately applied to a reviewed, pinned OpenMAIC
# commit. Do not track upstream main implicitly.
FROM node:22-alpine AS source
RUN apk add --no-cache git ca-certificates
ARG OPENMAIC_COMMIT=21d83ec51b908a4b169ee2be7498a29da213c74d
RUN git clone https://github.com/THU-MAIC/OpenMAIC.git /src \
  && cd /src \
  && git checkout "$OPENMAIC_COMMIT" \
  && rm -rf .git
COPY overlay/ /overlay/
RUN cp -a /overlay/. /src/
COPY branding/ /branding/
RUN node /branding/apply-branding.mjs /src

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
RUN apk add --no-cache python3 build-base g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev
COPY --from=source /src/package.json /src/pnpm-lock.yaml /src/pnpm-workspace.yaml ./
COPY --from=source /src/packages ./packages/
COPY --from=source /src/scripts ./scripts/
# Keep this install intentionally cache-mount-free on Railway staging.
# Railway's Docker cache mount IDs are service-scoped; the generic BuildKit
# cache id used previously could fail before useful build output appeared.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM base AS builder
ARG ALLOWED_FRAME_ANCESTORS=https://crm.sunchaserenergy.co
ARG NEXT_PUBLIC_PERSISTENCE=
ARG NEXT_PUBLIC_PERSISTENCE_TOKEN=
ARG NEXT_PUBLIC_MAIC_EDITOR_ENABLED=
ARG NEXT_PUBLIC_MAIC_EDITOR_RENDERER_ENABLED=
ARG NEXT_PUBLIC_MAIC_PLAYBACK_RENDERER_ENABLED=
ARG NEXT_PUBLIC_PI_CHAT_ENABLED=
ARG NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED=
ARG NEXT_PUBLIC_SHOW_VOCATIONAL_TEST_UI=
ARG NEXT_PUBLIC_ENABLE_VIDEO_EXPORT=false
ARG NEXT_PUBLIC_VIDEO_EXPORT_CTA_DESTINATION=off
ARG NEXT_PUBLIC_ENABLE_PPTX_IMPORT=true
ARG NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=false

ENV ALLOWED_FRAME_ANCESTORS=$ALLOWED_FRAME_ANCESTORS
ENV NEXT_PUBLIC_PERSISTENCE=$NEXT_PUBLIC_PERSISTENCE
ENV NEXT_PUBLIC_PERSISTENCE_TOKEN=$NEXT_PUBLIC_PERSISTENCE_TOKEN
ENV NEXT_PUBLIC_MAIC_EDITOR_ENABLED=$NEXT_PUBLIC_MAIC_EDITOR_ENABLED
ENV NEXT_PUBLIC_MAIC_EDITOR_RENDERER_ENABLED=$NEXT_PUBLIC_MAIC_EDITOR_RENDERER_ENABLED
ENV NEXT_PUBLIC_MAIC_PLAYBACK_RENDERER_ENABLED=$NEXT_PUBLIC_MAIC_PLAYBACK_RENDERER_ENABLED
ENV NEXT_PUBLIC_PI_CHAT_ENABLED=$NEXT_PUBLIC_PI_CHAT_ENABLED
ENV NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED=$NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED
ENV NEXT_PUBLIC_SHOW_VOCATIONAL_TEST_UI=$NEXT_PUBLIC_SHOW_VOCATIONAL_TEST_UI
ENV NEXT_PUBLIC_ENABLE_VIDEO_EXPORT=$NEXT_PUBLIC_ENABLE_VIDEO_EXPORT
ENV NEXT_PUBLIC_VIDEO_EXPORT_CTA_DESTINATION=$NEXT_PUBLIC_VIDEO_EXPORT_CTA_DESTINATION
ENV NEXT_PUBLIC_ENABLE_PPTX_IMPORT=$NEXT_PUBLIC_ENABLE_PPTX_IMPORT
ENV NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=$NEXT_PUBLIC_PRO_WORKBENCH_ENABLED

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=source /src ./

# This mirrors the reviewed upstream Docker build: workspace packages are built
# explicitly and Next.js produces a standalone runtime image.
RUN NODE_OPTIONS=--max-old-space-size=1024 pnpm run build:packages
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apk add --no-cache libc6-compat cairo pango jpeg giflib librsvg \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Classic OpenMAIC still stores some classroom/media artifacts under ./data in
# V1. Keep the directory writable until the Sunchaser Postgres/object-storage
# cutover is complete.
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
