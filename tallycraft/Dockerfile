# TallyCraft — production image
#
# There is nothing to compile and no runtime dependency to install: the app is
# ESM on Node's built-in `node:sqlite`. That keeps the image small, the build
# reproducible and the attack surface to "Node plus our own source".
#
#   docker build -t tallycraft:1.0.0 .
#   docker run -p 3000:3000 -v tallycraft-data:/data tallycraft:1.0.0
#
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TALLYCRAFT_DB=/data/tallycraft.db

WORKDIR /app

# Only what the server actually reads.
COPY package.json ./
COPY bin ./bin
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# The database lives on a volume owned by the unprivileged user, so the image
# itself stays read-only at runtime.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

# `exec`-style: node is PID 1 and receives SIGTERM directly, which is what the
# graceful drain in bin/tallycraft.js listens for.
CMD ["node", "--disable-warning=ExperimentalWarning", "bin/tallycraft.js", "serve", "--host", "0.0.0.0"]
