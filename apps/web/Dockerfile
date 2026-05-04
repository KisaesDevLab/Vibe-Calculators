# syntax=docker/dockerfile:1.7
#
# Vibe Calculators web (frontend) container.
#
# Multi-stage:
#   1. base   — node 20 + corepack-pinned pnpm
#   2. fetch  — pnpm fetch using lockfile only (cacheable)
#   3. build  — install workspace deps offline, run vite build for
#               apps/web (dependent shared-types is built first via
#               pnpm's filter ... topological resolution)
#   4. runtime — caddy:2-alpine serving dist/ on :8080. The top-level
#               ingress Caddy reverse-proxies / -> web:8080 and /api
#               -> api:3000 (see docker-compose.yml + Caddyfile,
#               phases 1.10 / 1.11).

ARG NODE_VERSION=20.15.0
ARG PNPM_VERSION=9.15.9
ARG CADDY_VERSION=2.8.4

# ----------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1
# Upgrade corepack first — the version bundled with node:20.15.0 ships
# stale signing keys and rejects current pnpm releases ("Cannot find
# matching keyid"). corepack >=0.31 has the rotated keys.
RUN npm install -g corepack@0.33.0 \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# ----------------------------------------------------------------------
FROM base AS fetch
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# --ignore-scripts: fetch shouldn't run lifecycle hooks; in particular
# simple-git-hooks' postinstall would fail here because the workspace
# package.json files haven't been COPYd yet.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --prod=false --ignore-scripts

# ----------------------------------------------------------------------
FROM fetch AS build
COPY package.json tsconfig.base.json tsconfig.json ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --ignore-scripts
RUN pnpm --filter @vibe-calc/web... build

# ----------------------------------------------------------------------
FROM caddy:${CADDY_VERSION}-alpine AS runtime
ARG GIT_SHA=unknown
ARG VERSION=0.0.0

LABEL org.opencontainers.image.title="vibecalc-web" \
      org.opencontainers.image.description="Vibe Calculators frontend (static assets + Caddy)" \
      org.opencontainers.image.source="https://github.com/vibe-calculators/vibe-calculators" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

# Lightweight Caddyfile: serve the SPA on :8080 with HTML5 history-mode
# fallback so client-side routes (e.g. /health, /clients/123) resolve
# to index.html. Compress responses; disable Caddy's auto-HTTPS since
# the ingress Caddy is the TLS terminator.
COPY apps/web/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/ > /dev/null || exit 1
