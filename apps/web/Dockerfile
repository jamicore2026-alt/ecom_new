# Build context MUST be the repository root:
#   docker build -f apps/web/Dockerfile .
FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/
RUN bun install --frozen-lockfile

COPY apps/web ./apps/web
WORKDIR /app/apps/web

ENV NODE_ENV=production
# Runtime API location for the internal /api + /uploads proxy (not baked at build).
ARG API_ORIGIN=http://localhost:3005
ENV API_ORIGIN=$API_ORIGIN

RUN bun run build

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

CMD ["bun", "./build/index.js"]
