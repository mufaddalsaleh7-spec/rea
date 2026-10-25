# Build and Test — ReaOS platform

Everything in this document was executed in the session that produced it. Where
a command could **not** be run, that is stated explicitly.

---

## 1. Environment actually observed

| Item                | Value                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| OS                  | Linux (`6.1.158+`), x64                                                                                                           |
| CPU                 | 2 vCPU (Intel Xeon @ 2.60 GHz)                                                                                                    |
| Memory              | 3.9 GB, **no swap**                                                                                                               |
| Node.js             | `v22.22.3` (satisfies the platform's `^22.19.0                                                                                    |     | ^24.11.0 |     | >=26.0.0`) |
| npm                 | `10.9.8`                                                                                                                          |
| Available toolchain | `node`, `npm`, `npx`, `bash`, `git`, `gh`, `python3`, `gcc`                                                                       |
| **Absent**          | `cargo`/`rustc`, `qemu-system-*`, `docker`, a browser (Playwright core is present, **no browser binaries**), Rust cross toolchain |

Consequence: a bootloader/kernel cannot be built or booted here, and browser
automation of the shell is not possible in this sandbox. Both are recorded as
blocked rather than assumed.

## 2. Install dependencies

```bash
cd rea
npm ci           # 523 packages, ~13 s — verified
```

`npm ci` runs `node scripts/prepare.mjs` and succeeds.

## 3. ReaOS platform checks (fast, sandbox-safe)

```bash
cd platform

# Typecheck the platform (strict, NodeNext, no emit)
../node_modules/.bin/tsc -p tsconfig.json          # verified: clean

# Run the platform test suite
../node_modules/.bin/vitest run --config vitest.config.ts
# verified: 7 files / 59 tests passing
```

No build step exists on purpose: the platform runs directly from TypeScript
sources using Node's built-in type stripping (Node ≥ 22.19), so the executed code
is exactly the reviewed code. The platform therefore avoids TypeScript syntax
that cannot be stripped (parameter properties, enums, namespaces).

### Run the desktop

```bash
cd platform
node src/main.ts --port 4173 --host 0.0.0.0
# → http://localhost:4173
#   home: ~/.reaos-home
```

Options: `--port`, `--host`, `--root <dir>`; environment equivalents
`REAOS_PORT`, `REAOS_HOST`, `REAOS_HOME`, `REAOS_ALLOWED_COMMANDS`
(comma-separated allowlist override for the terminal).

## 4. Manual verification performed in this session

Against a live server (`node src/main.ts --port 4173`), using `curl`:

| Flow                                                               | Result                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `GET /api/health`                                                  | `ok`, version, home path, composed service list                                    |
| `GET /api/system`                                                  | Real host facts; first CPU sample `null`, later samples `0–100`                    |
| `GET /api/files?path=/`                                            | Six seeded directories from the real host filesystem                               |
| `POST /api/files/mkdir` + `/write` + `/read`                       | Created, wrote and read back 15 bytes                                              |
| `GET /api/search?q=pla`                                            | Ranked file hit plus application hits                                              |
| `PATCH /api/settings`                                              | Validated, persisted, capabilities re-derived                                      |
| `POST /api/terminal/exec`                                          | Denied before the capability was granted; `node -e` returned `4` after             |
| `POST /api/notifications`                                          | Published (`201`)                                                                  |
| `POST /api/files/delete` → `/trash`                                | Moved to `/.Trash/<timestamp>-Demo`                                                |
| `POST /api/files/purge` outside trash                              | Correctly `403`                                                                    |
| `GET /` `/js/main.js` `/styles/shell.css` `/assets/reaos-mark.svg` | `200` with correct content types                                                   |
| `GET /api/events` (SSE)                                            | Stream opens with `text/event-stream`; event delivery covered by an automated test |

## 5. Headless shell smoke test (DOM harness)

No browser is available in this sandbox, so the desktop shell is exercised with a
linkedom-based harness (`platform/tools/shell-smoke.mjs`). It parses the real
`ui/index.html`, installs the browser globals the shell uses, points `fetch` at a
live server and then drives the shell the way a user would.

```bash
# 1. install a DOM implementation for the harness only (no platform dependency)
npm install --no-save --no-audit --no-fund --prefix platform linkedom

# 2. run the platform, then the harness
cd platform && node src/main.ts --port 4173 &
cd platform && node tools/shell-smoke.mjs
```

Verified checks (all passing):

| Area         | Checks                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Boot         | Boot overlay hidden, 7 dock items, theme applied from persisted settings, clock text, CPU chip populated, desktop icons                |
| Applications | All six applications open from the dock and render non-empty content; Files lists the platform's real directories                      |
| Editor       | Untitled save dialog opens, file name accepted, save reaches the platform, the saved file is readable back over the API                |
| Launcher     | Ctrl+Space opens the overlay, query "Wel" returns results including the seeded `Welcome.md`                                            |
| Settings     | Choosing "Light" in Settings changes the _server_ setting and re-themes `documentElement` (verified through the real PATCH + SSE path) |
| Terminal     | Locked without `process:spawn`; "Enable now" unlocks it; `echo hello-reaos` runs and its output is rendered                            |

This is a development aid, not a browser: layout, painting, real pointer input and
screen readers are **not** covered. A Playwright suite remains blocked on browser
binaries.

## 6. Automated test inventory (59 tests)

| File                                   | Covers                                                                                                                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/vfs.test.ts` (13)               | Layout creation, traversal rejection, symlink escape, atomic write, overwrite guard, limits, ordering, move/mkdir, invalid paths                                                                                 |
| `tests/container.test.ts` (4)          | Dependency ordering, reverse shutdown, duplicate/unknown dependency rejection, cycle rejection, rollback on failure                                                                                              |
| `tests/permissions.test.ts` (4)        | Deny-by-default, grant/revoke notification, unknown capability handling, canonical ordering                                                                                                                      |
| `tests/settings.test.ts` (6)           | Defaults + persistence, field validation, unknown-key rejection, change events, forward compatibility, corrupt-file fallback, reset                                                                              |
| `tests/files.test.ts` (8)              | Capability enforcement, `/System` protection, trash + restore path, unique trash names, root/trash protection, rename policy, search ranking/exclusion, blank query                                              |
| `tests/processHost.test.ts` (8)        | Allowlist denial, real execution, no shell expansion, timeout kill, output cap, non-zero exit, invalid args + cwd, child reaping                                                                                 |
| `tests/api.test.ts` (18, incl. 2 HTTP) | Health, metrics, catalog, full file lifecycle, 400/403 mappings, settings→capability propagation, terminal gating, search, notifications, purge policy, log access, 404s, SSE delivery, oversized body rejection |

## 7. Repository-wide checks in this sandbox

| Command                                          | Outcome                                                                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx tsc --noEmit` (whole repo)                  | **BLOCKED by environment.** The compiler reached ~95 % of 3.9 GB RAM and thrashed; no swap. Hung for >8 minutes and was killed. Requires ≥ 8 GB RAM or `NODE_OPTIONS=--max-old-space-size` with more memory.                    |
| `npm run lint` / `npm run test:run` (whole repo) | Not run: same memory profile, plus generated artifacts (`npm run build:cached`) and provider binaries that are not installed.                                                                                                   |
| `npm run check:pr`                               | Not run: superset of the above.                                                                                                                                                                                                 |
| `oxlint`/`oxfmt` on `platform/`                  | Not run by the repository's config (its `include`/`ignorePatterns` target `src/`, `tests/`, `scripts/`). Platform files are formatted consistently by hand; adding them to the repo linters is a follow-up task in the roadmap. |

The platform's own typecheck and tests are the verification gate for this work.
That is stated plainly rather than implying the REA project's full CI passed.

## 8. Known verification gaps

1. **No real-browser test.** The linkedom harness covers shell logic and
   integration; it cannot verify layout, painting, animations or real pointer
   gestures. Playwright has no browser binaries in this sandbox.
2. **No visual regression.** Screenshots require a browser.
3. **No concurrency/load testing** beyond the process-host concurrency cap test.
4. **Multi-user isolation** is not implemented, therefore not tested.
5. **`window.prompt` was deliberately avoided**; dialogs are in-shell and are
   covered by the harness only for the text prompt path (confirm/menu paths are
   not yet asserted).
