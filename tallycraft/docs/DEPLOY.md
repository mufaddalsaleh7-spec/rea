# Deploying TallyCraft

TallyCraft is one Node process and one SQLite file. It needs no build step, no
package install and no external service. That makes deployment a small problem
with three real decisions:

1. **Where does the database live?** It must be on a persistent volume, and
   exactly one process may write to it.
2. **How does TLS terminate?** A reverse proxy (nginx, Caddy, or the platform).
3. **Who is allowed in?** The app ships no login. Put an identity layer in
   front of it before it faces the internet.

Everything below assumes Node 22.5+ (`node:sqlite`).

---

## 1. One command on a server (Docker)

```bash
cd tallycraft
cp .env.example .env          # set TALLYCRAFT_DEMO=0 for a real book
docker compose up -d --build
docker compose ps             # STATUS should become "healthy"
```

Open `http://<server>:3000`. The database lives in the `tallycraft-data` volume.

What the compose file guarantees:

| Concern  | How                                                                   |
| -------- | --------------------------------------------------------------------- |
| Restart  | `restart: unless-stopped`; Docker restarts on crash and on reboot     |
| Data     | Named volume at `/data`, matching `TALLYCRAFT_DB`                     |
| Health   | `node scripts/healthcheck.mjs` every 30 s, 3 failures marks unhealthy |
| Shutdown | `stop_grace_period: 20s`; the server drains, checkpoints, then exits  |
| Log size | json-file driver capped at 10 MB × 5                                  |

Upgrade:

```bash
docker compose exec tallycraft node scripts/backup.mjs   # 1. back up
git pull                                                 # 2. new source
docker compose up -d --build                             # 3. rebuild, restart
curl -s localhost:3000/api/instance | head               # 4. confirm
```

Rollback the image with `docker compose up -d` after tagging the previous
image; rollback the data with `node scripts/restore.mjs --from <backup> --yes`.

---

## 2. Bare VPS (systemd + nginx)

```bash
sudo useradd --system --home /opt/tallycraft --shell /usr/sbin/nologin tallycraft
sudo rsync -a --exclude data --exclude backups ./ /opt/tallycraft/
sudo install -d -o tallycraft -g tallycraft /opt/tallycraft/data
sudo cp deploy/systemd/tallycraft.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now tallycraft
sudo systemctl status tallycraft --no-pager
```

The unit binds `127.0.0.1:3000` only, runs as an unprivileged user with
`ProtectSystem=strict` and write access to the data directory alone.

Then terminate TLS and put identity in front:

```bash
sudo cp deploy/nginx/tallycraft.conf /etc/nginx/sites-available/tallycraft
sudo ln -s /etc/nginx/sites-available/tallycraft /etc/nginx/sites-enabled/
sudo certbot --nginx -d books.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Uncomment the `auth_basic` / `allow` lines in the nginx config (or use Caddy
with `basicauth`, Cloudflare Access, Tailscale, or a VPN) before this is
reachable from the internet.

`deploy/Caddyfile` is the two-line alternative when you want automatic TLS
without cerbot.

---

## 3. Managed platforms

| Platform | File          | Notes                                                                                |
| -------- | ------------- | ------------------------------------------------------------------------------------ |
| Render   | `render.yaml` | Docker service + 1 GB disk at `/data`; set `PUBLIC_URL` after first deploy           |
| Fly.io   | `fly.toml`    | Needs a volume (`fly volumes create tallycraft_data --size 1`); keep **one** machine |

`PUBLIC_URL` is what `/api/instance` and the install prompt report, so set it
to the address people actually open (e.g. `https://books.example.com`). Without
it the app falls back to the request host or the sandbox preview derivation.

---

## Configuration

Every value is read once at boot by `src/config.js`. A bad value stops the
process with the variable named — a typo must never boot into a silently wrong
configuration.

| Variable             | Default              | Meaning                                                       |
| -------------------- | -------------------- | ------------------------------------------------------------- |
| `PORT`               | `3000`               | Listen port (accepts `3000:3000` by mistake-with-forgiveness) |
| `HOST`               | `0.0.0.0`            | Bind address; use `127.0.0.1` behind a local proxy            |
| `TALLYCRAFT_DB`      | `data/tallycraft.db` | Database path. The directory is created if missing            |
| `TALLYCRAFT_DEMO`    | off                  | Seed the demo company when the database is empty              |
| `TALLYCRAFT_ALIASES` | empty                | Extra ports answering the same app (preview proxies only)     |
| `PUBLIC_URL`         | derived              | Canonical external URL reported in `/api/instance`            |
| `TALLYCRAFT_RELEASE` | git commit           | Build label shown in `/api/instance`                          |
| `NODE_ENV`           | `development`        | `production` in every deployment                              |

Fast failure looks like this:

```text
Configuration error — PORT: expected a port between 1 and 65535, got "eighty"
```

---

## Data: backup, restore, upgrade

The database is a single file (plus `-wal`/`-shm` sidecars while running).

```bash
# Hot backup while the server is up. Verifies integrity, prints a SHA-256.
node scripts/backup.mjs                       # → backups/tallycraft-YYYYMMDD-HHMMSS.db
node scripts/backup.mjs --keep 30 --json      # machine-readable, 30-day retention

# Restore. Stop the app first; it keeps the replaced file as .pre-restore-<stamp>.
node scripts/restore.mjs --from backups/tallycraft-20261024-120000.db --yes
```

Inside a container:

```bash
docker compose exec tallycraft node scripts/backup.mjs
docker cp tallycraft:/data/tallycraft.db ./offsite-$(date +%F).db
```

`backup.mjs` uses `VACUUM INTO`, so it is consistent even mid-transaction. Do
not copy `tallycraft.db` with `cp` while the server is writing: that can copy a
torn file.

Cron it, and get the copies off the machine:

```cron
15 2 * * * cd /opt/tallycraft && /usr/bin/node scripts/backup.mjs --keep 30 --out /var/backups/tallycraft >> /var/log/tallycraft-backup.log 2>&1
```

Restore drill, once per quarter, on a scratch copy:

```bash
node scripts/restore.mjs --from backups/latest.db --db /tmp/drill.db --yes
node bin/tallycraft.js report trial-balance --db /tmp/drill.db
```

A backup you have never restored is an assumption, not a backup.

---

## Operating it

| Need                    | Command                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| Is it alive?            | `curl -fsS localhost:3000/healthz` → `ok`                                    |
| What is running?        | `curl -s localhost:3000/api/instance` (pid, port, db, commit)                |
| Is the book balanced?   | `curl -s localhost:3000/api/reports/trial-balance \| head -c 200`            |
| Logs (Docker)           | `docker compose logs -f --tail 100`                                          |
| Logs (systemd)          | `journalctl -u tallycraft -f`                                                |
| Restart                 | `docker compose restart` / `systemctl restart tallycraft`                    |
| CLI report on live data | `docker compose exec tallycraft node bin/tallycraft.js report balance-sheet` |

### Scaling rule

SQLite allows many readers, one writer, and the app relies on that. Run
**one** instance per database. Do not put two replicas behind a load balancer
pointing at the same volume, and do not share the volume over NFS. If a single
node stops coping with read traffic, serve the JSON API from a read replica
(`VACUUM INTO` a copy on a schedule) rather than from a second writer.

### Security posture

- No built-in authentication yet. Never expose it directly to the internet
  without nginx `auth_basic`, Caddy `basicauth`, Cloudflare Access, Tailscale,
  or a VPN.
- TLS is mandatory in practice; the nginx config ships HSTS and refuses caching
  of API responses, the shell and the service worker.
- The container runs as `node`, not root, and the image contains no build
  toolchain.
- `data/`, `backups/` and `.runtime/` are git-ignored; keep them out of images
  and out of repositories.
- Tally XML import is capped by `client_max_body_size 16m` in nginx; adjust if
  you import very large masters.

### Troubleshooting

| Symptom                                       | Cause                                           | Fix                                                               |
| --------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| Container restarts every few seconds          | `PORT`/`TALLYCRAFT_DB` unreadable or unwritable | `docker compose logs`; check the volume owner                     |
| `Configuration error — PORT: …` in logs       | Bad env value                                   | Fix `.env`, `docker compose up -d`                                |
| Healthy, but every deploy starts with no book | No volume mounted where `TALLYCRAFT_DB` points  | Mount a disk at `/data`                                           |
| `database is locked` under load               | Two writers on one file                         | One instance per database                                         |
| Reports show old numbers in a browser         | Service worker cache (by design, offline-first) | Reload once; the ticker offers "Reload" when an update is waiting |
| Backup fails with "No database"               | App never started, or wrong `--db`              | Check `TALLYCRAFT_DB` and volume mount                            |
| Restore refuses to run                        | Safety check triggered                          | Stop the server, re-run with `--yes`                              |

---

## What a deploy actually changes

Nothing in the code path: the same `bin/tallycraft.js serve` runs on a laptop,
in the sandbox preview and in a container. Deployment only changes where the
file lives, who can reach the port, and how the process is supervised.
