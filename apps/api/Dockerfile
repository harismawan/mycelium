FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production

# Build prisma client
FROM deps AS build
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
RUN cd apps/api && bunx prisma generate

# Production
FROM base AS runner
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/api apps/api

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "src/index.js"]
