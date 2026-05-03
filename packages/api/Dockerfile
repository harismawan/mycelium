FROM docker.io/oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY packages/mcp/package.json packages/mcp/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# Build prisma client
FROM deps AS build
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/
RUN cd packages/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mycelium?schema=public bunx prisma generate

# Production
FROM base AS runner
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/packages/api packages/api

WORKDIR /app/packages/api
ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "src/index.js"]
