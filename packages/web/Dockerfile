FROM docker.io/oven/bun:1 AS build
WORKDIR /app

# Install dependencies
COPY package.json bun.lock ./
COPY packages/web/package.json packages/web/
COPY packages/api/package.json packages/api/
COPY packages/mcp/package.json packages/mcp/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile

# Build
COPY packages/shared/ packages/shared/
COPY packages/web/ packages/web/
RUN cd packages/web && bun run build

# Serve with nginx
FROM docker.io/library/nginx:alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
