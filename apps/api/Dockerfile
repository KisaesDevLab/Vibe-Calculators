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
# Upgrade corepack first — the version bundled with node:20.15.0 ships
# stale signing keys and rejects current pnpm releases ("Cannot find
# matching keyid"). corepack >=0.31 has the rotated keys.
RUN npm install -g corepack@0.33.0 \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate
# git: `pnpm deploy` re-resolves the github:-hosted @kisaes/vibe-ai-client
# with `git ls-remote` (install alone gets by on the lockfile's codeload
# tarball). Build stages only — the distroless runtime image has no git.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ----------------------------------------------------------------------
FROM base AS fetch
# Scripts must stay ENABLED through fetch/install: the git-hosted
# @kisaes/vibe-ai-client ships src/ only and relies on its "prepare" (tsc)
# to produce dist/. With --ignore-scripts, pnpm packs it into the store
# without dist (honoring files:["dist"]) and every later install reuses the
# broken entry. simple-git-hooks is skipped via env instead (no .git here),
# and engine-strict is relaxed because the SDK repo root declares
# engines.node >=24 for its own dev environment while the SDK itself
# supports >=20.
ENV SKIP_INSTALL_SIMPLE_GIT_HOOKS=1 \
    npm_config_engine_strict=false
# @kisaesdevlab/vibe-auth (single sign-on) comes from GitHub Packages, which
# wants a token even for reads. It is a BuildKit secret, written to a
# throwaway user npmrc that never lands in a layer (a failed step commits
# no layer at all):
#   docker build --secret id=NODE_AUTH_TOKEN,env=NODE_AUTH_TOKEN …
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=NODE_AUTH_TOKEN,required=true \
    printf '//npm.pkg.github.com/:_authToken=%s\n' "$(cat /run/secrets/NODE_AUTH_TOKEN)" > /root/.npmrc \
 && pnpm fetch --prod=false \
 && rm -f /root/.npmrc

# ----------------------------------------------------------------------
FROM fetch AS build
COPY package.json tsconfig.base.json tsconfig.json ./
COPY apps/api ./apps/api
COPY packages ./packages
COPY scripts ./scripts
# --prefer-offline (not --offline): preparing the git-hosted SDK needs
# network on a cold store; see the fetch stage for why scripts stay enabled.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=NODE_AUTH_TOKEN,required=true \
    printf '//npm.pkg.github.com/:_authToken=%s\n' "$(cat /run/secrets/NODE_AUTH_TOKEN)" > /root/.npmrc \
 && pnpm install --frozen-lockfile --prefer-offline \
 && rm -f /root/.npmrc
RUN pnpm --filter @vibe-calc/api... build
# tsconfig.base.json uses moduleResolution: Bundler, which lets TS
# accept extensionless relative imports during typecheck. Native Node
# ESM in the distroless runtime doesn't — see scripts/fix-esm-extensions.mjs.
RUN node scripts/fix-esm-extensions.mjs

# ----------------------------------------------------------------------
FROM build AS prune
# pnpm deploy assembles a self-contained directory containing only
# the production dependencies and built output for the chosen package.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @vibe-calc/api deploy --prod /deploy

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
