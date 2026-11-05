# syntax=docker/dockerfile:1.7
#
# NeuroMEP images (Section 7, D-14; hosting WBS 1.8.3). One file, three images:
#   docker build --target web -t neuromep-web .   React build served by Nginx, /api proxied to the API
#   docker build --target api -t neuromep-api .   Node + Express API with production dependencies only
#   docker build --target db  -t neuromep-db  .   MongoDB single-node replica set (transactions need one)
# compose.yaml builds and runs all three together; see docker/README.md.

ARG NODE_VERSION=24-alpine
ARG NGINX_VERSION=1.28-alpine
ARG MONGO_VERSION=8.0

# ---- Dependencies: every workspace from the lockfile (dev tools are needed to build) ---------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# mongodb-memory-server (API tests) would download a MongoDB binary; Playwright has no browsers here.
ENV MONGOMS_DISABLE_POSTINSTALL=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/rulepacks/package.json packages/rulepacks/
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci

# ---- Build: shared -> rulepacks -> engine -> api -> web (workspace order) --------------------
FROM deps AS build
COPY tsconfig.base.json vitest.shared.ts ./
COPY packages packages
COPY apps apps
# Optional login-page "Demo Credentials" line for a staging build (never for production).
ARG VITE_DEMO_EMAIL=""
ARG VITE_DEMO_PASSWORD=""
RUN VITE_DEMO_EMAIL="$VITE_DEMO_EMAIL" VITE_DEMO_PASSWORD="$VITE_DEMO_PASSWORD" npm run build

# ---- API production dependencies only (express, mongodb, pdfjs-dist, zod + workspace links) ---
FROM node:${NODE_VERSION} AS api-deps
WORKDIR /app
ENV npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/rulepacks/package.json packages/rulepacks/
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace @neuromep/api --include-workspace-root=false

# ---- API image -------------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS api
LABEL org.opencontainers.image.title="neuromep-api" \
      org.opencontainers.image.description="NeuroMEP API (Node + Express, design doc layer 06)"
ENV NODE_ENV=production \
    API_PORT=4000 \
    DATA_DIR=/data \
    PLANS_DIR=/data/plans
WORKDIR /app
COPY --from=api-deps /app/package.json ./
COPY --from=api-deps /app/node_modules ./node_modules
# Workspace packages are linked from node_modules/@neuromep: their package.json and build output.
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/rulepacks/package.json packages/rulepacks/
COPY --from=build /app/packages/rulepacks/dist packages/rulepacks/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
# Draft legend symbols (A-11); SYMBOLS_DIR can point at a mounted approved set instead.
COPY --from=build /app/apps/api/symbols apps/api/symbols
# Floor-plan PDFs (A-02) live in /data/plans, a volume owned by the unprivileged user.
RUN mkdir -p /data/plans && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]

# ---- Web image: static build behind Nginx, /api proxied to the API container ----------------
FROM nginx:${NGINX_VERSION} AS web
LABEL org.opencontainers.image.title="neuromep-web" \
      org.opencontainers.image.description="NeuroMEP web UI (React build served by Nginx)"
ENV API_UPSTREAM=api:4000 \
    SERVER_NAME=_ \
    RESOLVER=127.0.0.11
RUN rm -f /etc/nginx/conf.d/default.conf
COPY docker/web/app.conf docker/web/headers.conf docker/web/http.conf.template docker/web/https.conf.template /etc/neuromep/
COPY --chmod=0755 docker/web/40-neuromep-site.sh /docker-entrypoint.d/
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

# ---- Database image: MongoDB as a single-node replica set with authentication ----------------
FROM mongo:${MONGO_VERSION} AS db
LABEL org.opencontainers.image.title="neuromep-db" \
      org.opencontainers.image.description="MongoDB single-node replica set for NeuroMEP"
ENV MONGO_REPLICA_SET=rs0 \
    MONGO_REPLICA_HOST=db:27017
COPY --chmod=0755 docker/db/entrypoint.sh /usr/local/bin/neuromep-db-entrypoint.sh
COPY --chmod=0755 docker/db/healthcheck.sh /usr/local/bin/neuromep-db-healthcheck.sh
COPY docker/db/10-app-user.js /docker-entrypoint-initdb.d/
EXPOSE 27017
HEALTHCHECK --interval=10s --timeout=10s --start-period=60s --retries=6 \
  CMD neuromep-db-healthcheck.sh
ENTRYPOINT ["neuromep-db-entrypoint.sh"]
CMD ["mongod", "--replSet", "rs0", "--keyFile", "/data/configdb/keyfile", "--bind_ip_all"]
