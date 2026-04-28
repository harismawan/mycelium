FROM docker.io/oven/bun:1 AS build
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY apps/mcp/package.json apps/mcp/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# Build
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
RUN cd apps/web && bun run build

# Serve with nginx
FROM docker.io/library/nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
