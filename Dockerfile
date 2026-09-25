# ---------- build the web client ----------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# the desktop app's Electron isn't needed to build the web client
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci

COPY vite.config.js ./
COPY shared ./shared
COPY client ./client
RUN npm run build

# ---------- runtime ----------
FROM node:24-alpine AS runtime
WORKDIR /app

# git is required for GitHub-backed workspaces; tini reaps zombies; su-exec drops root
RUN apk add --no-cache git tini su-exec ca-certificates && \
    git config --system --add safe.directory '*'

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY shared ./shared
# maintenance commands run with `docker exec` (mail test, pruning accounts)
COPY scripts ./scripts
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown -R node:node /data /app

# /data must be backed by a named volume or bind mount (docker-compose.yml declares one).
# Without one, this VOLUME gives each new container an empty unnamed volume, so a redeploy
# looks like a wipe; the old data survives in the orphaned volume (scripts/find-obi-data.sh
# finds it) and the server logs a warning at startup.
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/healthz >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
