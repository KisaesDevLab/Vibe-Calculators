# syntax=docker/dockerfile:1.7
#
# Vibe Calculators API container.
#
# Multi-stage:
#   1. base    — node 20 + corepack-pinned pnpm; baseline image cache
#   2. fetch   — pnpm fetch using the lockfile only (max layer cache reuse)
#   3. build   — install workspace deps offline, run TS build for the API
#                and its workspace deps
#   4. prune   — produce a deploy/ directory holding only what apps/api
#                actually needs at runtime
#   5. runtime — distroless node 20; runs the compiled entry point
#
# OCI labels are populated by the release workflow (phase-01.14).

ARG NODE_VERSION=20.15.0
ARG PNPM_VERSION=9.15.9

# ----------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ----------------------------------------------------------------------
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --prod=false

# ----------------------------------------------------------------------
FROM fetch AS build
COPY package.json tsconfig.base.json tsconfig.json ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline
RUN pnpm --filter @vibe-calc/api... build

# ----------------------------------------------------------------------
FROM build AS prune
# pnpm deploy assembles a self-contained directory containing only
# the production dependencies and built output for the chosen package.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @vibe-calc/api deploy --prod --legacy /deploy

# ----------------------------------------------------------------------
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runtime
ARG GIT_SHA=unknown
ARG VERSION=0.0.0
ENV NODE_ENV=production \
    GIT_SHA=${GIT_SHA} \
    PORT=3000

# OCI image annotations
LABEL org.opencontainers.image.title="vibecalc-api" \
      org.opencontainers.image.description="Vibe Calculators API server" \
      org.opencontainers.image.source="https://github.com/vibe-calculators/vibe-calculators" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

WORKDIR /app
COPY --from=prune --chown=nonroot:nonroot /deploy /app

EXPOSE 3000

# distroless nodejs sets ENTRYPOINT ["node"], so CMD is just args.
CMD ["dist/index.js"]
