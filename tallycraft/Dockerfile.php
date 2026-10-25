# TallyCraft — PHP backend + React client.
#
#   docker build -f Dockerfile.php -t tallycraft-php .
#   docker run -p 8080:8080 -v tallycraft-data:/data tallycraft-php
#
# The React bundle is committed, so the image needs no Node toolchain: PHP and
# one SQLite file are the entire runtime.

FROM php:8.3-cli

RUN docker-php-ext-install pdo_sqlite \
 && mkdir -p /data

WORKDIR /app

COPY api-php ./api-php
COPY public ./public

ENV TALLYCRAFT_DB=/data/tallycraft.db \
    PORT=8080 \
    NODE_ENV=production

RUN useradd --system --uid 10001 tallycraft \
 && mkdir -p /data \
 && chown -R tallycraft:tallycraft /data /app/api-php
USER tallycraft

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD php -r '$r=@file_get_contents("http://127.0.0.1:8080/api/health"); exit($r===false?1:0);'

# index.php is the router script: PHP asks it first, it serves /api/*, /healthz,
# /app/* and the classic client, and reads files itself when it needs to.
CMD ["php", "-S", "0.0.0.0:8080", "-t", "api-php/public", "api-php/public/index.php"]
