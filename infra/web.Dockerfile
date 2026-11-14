# Builds the web app (and its OpenAPI-generated client, already committed) into static files served by Caddy.
FROM oven/bun:1.2 AS build
WORKDIR /src
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY crates/pehle-api/package.json crates/pehle-api/package.json
RUN bun install --frozen-lockfile
COPY packages/api-client packages/api-client
COPY apps/web apps/web
RUN cd apps/web && bunx vite build

FROM caddy:2.10-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv/web
