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

# pnpm-workspace.yaml carries the allowBuilds approvals. Without it pnpm 11
# exits non-zero on unapproved dependency build scripts and the build fails.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

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

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
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

USER node

EXPOSE 3000

CMD ["node", "dist/main"]

# ============================================================
# DEVELOPMENT STAGE
# ============================================================
FROM deps AS development

ENV NODE_ENV=development
ENV PORT=3000

COPY . .

EXPOSE 3000 9229

CMD ["pnpm", "run", "start:dev"]
