# Runbook — keeping the preview up

Written after three preview outages in one session. It states what broke, why a
sandbox cannot be made to stop breaking, and the exact commands an operator (or
an agent) should run.

## TL;DR

```bash
npm run check     # 5-second diagnosis, changes nothing
npm run up        # repair whatever drifted, then serve under supervision
```

Then open the preview from the chat's LIVE PREVIEW card — never a saved URL.

## The failure model

The host is an ephemeral sandbox. Four independent failure modes exist, and only
some are ours to fix:

| #   | Failure                             | Symptom                                                   | Who fixes it                                                            |
| --- | ----------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | **Sandbox recycled**                | `502 Bad Gateway · Sandbox not found`                     | Arena. A new sandbox means a new hostname; old URLs are dead by design. |
| 2   | **Stale preview binding**           | panel says "Unavailable" while the server answers locally | The supervisor + a fresh preview entry                                  |
| 3   | **Orphaned process holds the port** | `EADDRINUSE`, or a zombie serving an old build            | The supervisor + the server's parent-death guard                        |
| 4   | **Host saturation**                 | server alive but slow; naive checks flap                  | The supervisor's watchdog                                               |

Failure 1 is unfixable from inside. The engineering response is to make 2–4
impossible and to make recovery from 1 a single command.

## What the system does now

### Supervisor (`scripts/serve.mjs`, `npm run preview`)

- **Port resolution.** Reuses our own listener (detected via `/api/instance`),
  skips a foreign listener by moving to the next free port, and refuses to bind
  over anyone else's socket. Never crashes on `EADDRINUSE`.
- **Idempotent start.** Running it twice prints `already running (pid …, uptime …)`
  and exits 0 instead of double-binding.
- **Crash restart.** Exponential backoff (0.5 s → 8 s), bounded at 8 restarts per
  minute, then it stops with a readable message rather than spinning forever.
- **Hang watchdog.** Probes `/healthz` every 10 s; after 3 consecutive failures it
  kills and restarts the server. Covers failure 4.
- **No wrapper chain.** It spawns `node` directly, so `SIGTERM`/`SIGINT` reach the
  server. (The original `npm start` chain left an orphan holding the port.)

### Parent-death guard (`bin/tallycraft.js serve`)

The server receives `--parent-pid` and exits by itself if that process
disappears. Proven against `SIGKILL`: no handler runs, yet the port is released
within ~2 s. Without this, an abruptly killed supervisor strands the server.

### Readiness contract (`GET /api/instance`)

```json
{
  "service": "tallycraft",
  "status": "ok",
  "pid": 2980,
  "supervisorPid": 2966,
  "port": 3000,
  "localUrl": "http://127.0.0.1:3000",
  "previewUrl": "https://3000-<sandbox>.e2b.app",
  "sandboxId": "…",
  "uptimeSeconds": 4,
  "database": "…/data/tallycraft.db",
  "git": { "branch": "arena/12415f30-rea", "commit": "674fde0" }
}
```

One request answers: is it up, which port, which preview URL, which commit, and
whose process is it. `service` lets a supervisor distinguish its own listener
from a stranger on the same port.

Discovery files are also written to `.runtime/` (git-ignored):
`preview.json` from the server, `supervisor.json` with restart counts.

### Idempotent bootstrap (`scripts/bootstrap.mjs`, `npm run up`)

Repairs a recycled sandbox in five reported steps, skipping anything already
satisfied:

1. **Git** — compares local HEAD with `git ls-remote`; hard-resets to the pushed
   session branch only when drift is real.
2. **Dependencies** — `npm ci` only if `node_modules` is missing.
3. **Build** — `npm run build:cached` only if `dist` is missing.
4. **Agents** — runs `rea doctor`; re-runs setup only when registrations or the
   skill are not aligned.
5. **Preview** — hands over to the supervisor with `--serve`.

`npm run check` runs steps 1–3 in report-only mode.

## Diagnosing, in order

```bash
# 1. Does a server answer, and is it ours?
curl -s localhost:3000/api/instance | head -20

# 2. What is holding the port?
ss -ltnp | grep :3000

# 3. Is the process managed or orphaned?
ps -eo pid,ppid,etime,args | grep tallycraft

# 4. What does the supervisor think?
tail -20 .runtime/supervisor.json 2>/dev/null; cat .runtime/supervisor.json 2>/dev/null
```

Interpretation:

| Observation                                    | Meaning                     | Action                                                                    |
| ---------------------------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| `/api/instance` answers, `service: tallycraft` | Healthy                     | If the panel still fails, it's failure 1 or 2 — reopen from the chat card |
| `/api/instance` answers, different `service`   | Foreign process on the port | `npm run preview` moves to the next free port                             |
| Connection refused, no `ss` listener           | Nothing running             | `npm run preview`                                                         |
| Listener exists but no response                | Hung                        | Supervisor watchdog restarts it; if not supervised, `npm run preview`     |
| `502 Sandbox not found`                        | Sandbox gone                | `npm run up` in the new sandbox                                           |

## Incident record

| #   | Symptom reported            | Actual cause                                            | Evidence                                    | Fix shipped                                           |
| --- | --------------------------- | ------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| 1   | Preview Unavailable         | Stale port mapping after restart; server was healthy    | local `200` in 2 ms, empty proxy access log | Fresh process, `/healthz`, access log                 |
| 2   | Preview Unavailable (again) | Orphan `node` from `npm → sh → node` chain holding 3000 | `ps` showed node whose parent was gone      | Direct `node` spawn; later the parent-death guard     |
| 3   | `502 Sandbox not found`     | Sandbox recycled; hostname gone                         | `E2B_SANDBOX_ID` changed between turns      | Bootstrap script; URL now derived, never stored       |
| 4   | Repeated outages            | Sandbox replaced per session, no recovery path          | 3 different sandbox IDs in one session      | Supervisor + idempotent bootstrap + snapshot fallback |

## Fallback that cannot 502

`public/snapshot.html` (`npm run snapshot`) inlines every API response the client
requests and swaps `fetch` for a lookup table: one ~168 KB file rendering the
whole workspace with no server, no network and no proxy. Read-only by design.
Tests assert it covers every endpoint the client asks for.

## Ports

| Port  | Use                                                       |
| ----- | --------------------------------------------------------- |
| 3000  | Supervised preview (`npm run preview`)                    |
| 3001+ | Automatic fallback when 3000 is held by a foreign process |

Binding is always `0.0.0.0` so the preview proxy can reach it.
