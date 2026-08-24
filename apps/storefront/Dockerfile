# Build context MUST be the repository root:
#   docker build -f apps/storefront/Dockerfile .
FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/storefront/package.json ./apps/storefront/
RUN bun install --frozen-lockfile

COPY apps/storefront ./apps/storefront
WORKDIR /app/apps/storefront

# Frontends proxy /api and /uploads to the API at runtime via API_ORIGIN.
# PUBLIC_* vars are baked in at build time — pass them as build args.
ARG PUBLIC_API_URL=http://localhost:3005
ARG PUBLIC_DEFAULT_STORE=acme-store
ARG PUBLIC_STOREFRONT_URL=http://localhost:5479
ENV PUBLIC_API_URL=$PUBLIC_API_URL \
    PUBLIC_DEFAULT_STORE=$PUBLIC_DEFAULT_STORE \
    PUBLIC_STOREFRONT_URL=$PUBLIC_STOREFRONT_URL \
    NODE_ENV=production

RUN bun run build

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["bun", "./build/index.js"]
