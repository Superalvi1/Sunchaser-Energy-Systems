FROM node:22-bookworm

ARG OPENMAIC_COMMIT=21d83ec51b908a4b169ee2be7498a29da213c74d
ARG ALLOWED_FRAME_ANCESTORS=https://crm.sunchaserenergy.co
ARG NEXT_PUBLIC_ENABLE_VIDEO_EXPORT=false
ARG NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=false
ARG NEXT_PUBLIC_PERSISTENCE=
ARG NEXT_PUBLIC_PERSISTENCE_TOKEN=

ENV NODE_ENV=production
ENV ALLOWED_FRAME_ANCESTORS=$ALLOWED_FRAME_ANCESTORS
ENV NEXT_PUBLIC_ENABLE_VIDEO_EXPORT=$NEXT_PUBLIC_ENABLE_VIDEO_EXPORT
ENV NEXT_PUBLIC_PRO_WORKBENCH_ENABLED=$NEXT_PUBLIC_PRO_WORKBENCH_ENABLED
ENV NEXT_PUBLIC_PERSISTENCE=$NEXT_PUBLIC_PERSISTENCE
ENV NEXT_PUBLIC_PERSISTENCE_TOKEN=$NEXT_PUBLIC_PERSISTENCE_TOKEN

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

RUN git clone https://github.com/THU-MAIC/OpenMAIC.git /app \
  && cd /app \
  && git checkout "$OPENMAIC_COMMIT" \
  && rm -rf .git

WORKDIR /app

# Overlay only the Sunchaser integration/hardening files. OpenMAIC remains pinned
# upstream so upgrades are explicit and reviewable rather than silently tracking main.
COPY overlay/ /app/

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 3000

CMD ["sh", "-c", "pnpm start -- -p ${PORT:-3000}"]
