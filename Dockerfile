# syntax=docker/dockerfile:1

ARG NODE_VERSION=24-alpine
ARG PNPM_VERSION=11.3.0

# ============================================================
# BASE STAGE
# ============================================================
FROM node:${NODE_VERSION} AS base

ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}

ENV PNPM_HOME=/pnpm
WORKDIR /app

# Every stage runs as the unprivileged node user (uid 1000). The dev overlay
# bind-mounts the host source over /app, so a root-running container writes
# root-owned dist/ back onto the host and breaks host-side `pnpm build`.
# uid 1000 matches the default host user, so the mount stays writable both ways.
RUN mkdir -p /pnpm && chown -R node:node /pnpm /app
USER node

# pnpm-workspace.yaml carries the allowBuilds approvals. Without it pnpm 11
# exits non-zero on unapproved dependency build scripts and the build fails.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ============================================================
# DEPENDENCIES
# ============================================================
FROM base AS deps
RUN pnpm install --frozen-lockfile

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

# ============================================================
# BUILDER STAGE
# ============================================================
FROM deps AS builder

COPY --chown=node:node tsconfig.json tsconfig.build.json nest-cli.json ./
COPY --chown=node:node src ./src
RUN pnpm run build

# ============================================================
# PRODUCTION STAGE
# ============================================================
FROM node:${NODE_VERSION} AS production

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node docker-entrypoint.sh ./

USER node

EXPOSE 3000

# The entrypoint dispatches serve / migrate / seed off the first argument, so
# `docker compose run --rm api migrate` uses this same image and configuration.
#
# Invoked through `sh` rather than relying on the file's execute bit: the
# development stage bind-mounts the host tree over /app, so the mode that
# matters there is the one in the working copy, and a checkout that dropped it
# (or `--chmod`, which needs BuildKit) would break the container rather than
# fail the build. `exec` inside the script still replaces this shell, so signal
# handling and enableShutdownHooks are unaffected.
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["serve"]

# ============================================================
# DEVELOPMENT STAGE
# ============================================================
FROM deps AS development

ENV NODE_ENV=development
ENV PORT=3000

COPY --chown=node:node . .

EXPOSE 3000 9229

# Same entrypoint as production, so `migrate` and `seed` mean the same thing in
# both stacks. It branches on NODE_ENV: here it runs from source through
# ts-node and the watcher, there from compiled output in dist/.
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
CMD ["serve"]
