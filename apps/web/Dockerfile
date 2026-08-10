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
#   4. runtime — caddy:2-alpine serving dist/ on :80 (Vibe family
#               convention: every client tier listens on :80
#               internally). The top-level ingress Caddy
#               reverse-proxies / -> vibe-calculators-client:80 and
#               /api -> vibe-calculators-server:3000 (see
#               docker-compose.yml + Caddyfile, phases 1.10 / 1.11).

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
# Scripts must stay ENABLED through fetch/install: the git-hosted
# @kisaes/vibe-ai-client (packages/llm) ships src/ only and relies on its
# "prepare" (tsc) to produce dist/. With --ignore-scripts, pnpm packs it
# into the store without dist (honoring files:["dist"]) and every later
# install reuses the broken entry. simple-git-hooks is skipped via env
# instead (no .git here), and engine-strict is relaxed because the SDK repo
# root declares engines.node >=24 for its own dev environment while the SDK
# itself supports >=20.
ENV SKIP_INSTALL_SIMPLE_GIT_HOOKS=1 \
    npm_config_engine_strict=false
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --prod=false

# ----------------------------------------------------------------------
FROM fetch AS build
COPY package.json tsconfig.base.json tsconfig.json ./
COPY apps/web ./apps/web
COPY packages ./packages
# --prefer-offline (not --offline): preparing the git-hosted SDK needs
# network on a cold store; see the fetch stage for why scripts stay enabled.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline
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
# Runtime base-path injection — substitutes /__VIBE_BASE_PATH__/ in
# the built SPA bundle before Caddy starts so the same image can serve
# either '/' (standalone) or '/<prefix>/' (Vibe-Appliance shared Caddy
# in LAN / Tailscale modes). VITE_BASE_PATH defaults to '/'.
COPY apps/web/docker/web-entrypoint.sh /usr/local/bin/web-entrypoint.sh
RUN chmod +x /usr/local/bin/web-entrypoint.sh

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/ > /dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/web-entrypoint.sh"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
