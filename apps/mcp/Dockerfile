FROM docker.io/oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/mcp/package.json apps/mcp/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY packages/shared/ packages/shared/
COPY apps/mcp/ apps/mcp/
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mycelium?schema=public bunx prisma generate

FROM base AS runner
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/mcp apps/mcp
COPY --from=build /app/apps/api/prisma apps/api/prisma

WORKDIR /app/apps/mcp
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
EXPOSE 3001

CMD ["bun", "src/index.js"]
