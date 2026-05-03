FROM docker.io/oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY packages/mcp/package.json packages/mcp/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY packages/shared/ packages/shared/
COPY packages/mcp/ packages/mcp/
COPY packages/api/prisma packages/api/prisma
RUN cd packages/api && DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mycelium?schema=public bunx prisma generate

FROM base AS runner
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/packages/mcp packages/mcp
COPY --from=build /app/packages/api/prisma packages/api/prisma

WORKDIR /app/packages/mcp
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
EXPOSE 3001

CMD ["bun", "src/index.js"]
