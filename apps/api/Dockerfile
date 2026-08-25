# Build context MUST be the repository root:
#   docker build -f apps/api/Dockerfile .
FROM oven/bun:1.3-alpine

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
# devDependencies stay installed: drizzle-kit (db:migrate) runs as a deploy command.
RUN bun install --frozen-lockfile

COPY apps/api ./apps/api
WORKDIR /app/apps/api

ENV NODE_ENV=production
# Mount a persistent volume here in Coolify so uploaded images survive redeploys.
RUN mkdir -p /app/apps/api/uploads

EXPOSE 3005
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
  CMD wget -q --spider "http://127.0.0.1:${PORT:-3005}/health" || exit 1

CMD ["bun", "src/index.ts"]
