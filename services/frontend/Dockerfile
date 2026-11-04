# syntax=docker/dockerfile:1.28.0
# node:*-alpine is multi-arch. Next 16 ships SWC for linux-x64-musl and
# linux-arm64-musl. Do not pass --omit=optional (that drops the matching SWC
# binary). Do not pin --platform=linux/amd64.

FROM node:26.13.0-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
# Playwright e2e and unit tests are host-only (`make test-frontend-e2e`).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# --omit=dev keeps Playwright/Vitest/ESLint out of the image. Optional deps
# (Next SWC) stay installed. shadcn must remain in package.json dependencies
# because src/app/globals.css imports shadcn/tailwind.css.
RUN npm ci --omit=dev

FROM node:26.13.0-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
# Baked at build time: next inlines NEXT_PUBLIC_* into the client bundle, so the
# running container cannot pick this up from the environment later.
ARG NEXT_PUBLIC_GIT_SHA=dev
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_GIT_SHA=$NEXT_PUBLIC_GIT_SHA \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26.13.0-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/scripts/with-timestamps.mjs ./scripts/with-timestamps.mjs
EXPOSE 3000
CMD ["node", "scripts/with-timestamps.mjs", "node", "server.js"]

FROM node:26.13.0-alpine AS development
WORKDIR /app
RUN apk add --no-cache libc6-compat
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_GIT_SHA=dev
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_GIT_SHA=$NEXT_PUBLIC_GIT_SHA \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    WATCHPACK_POLLING=true
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]
