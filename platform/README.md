# ReaOS — desktop platform module

ReaOS is an independent desktop platform built inside the REA repository. It has
its own filesystem namespace, capability model, system services, desktop shell
and applications. It runs on a host kernel (Linux today) and does not claim to
be a kernel itself.

> ReaOS is not affiliated with, endorsed by, or derived from Apple Inc.
> macOS inspired the interaction model; all code, naming and artwork here are
> original. The REA reverse-engineering toolkit remains a separate product in
> this repository and is not modified by this module.

## Quick start

```bash
cd platform
node src/main.ts --port 4173 --host 0.0.0.0
```

Open <http://localhost:4173>. The first boot creates `~/.reaos-home` with
`Desktop`, `Documents`, `Downloads`, `Pictures`, `System` and `.Trash`, plus a
welcome document.

Requirements: Node.js ≥ 22.19 (native TypeScript type stripping) and nothing
else — there is no install step and no build step for this module.

## Verify

```bash
cd platform
../node_modules/.bin/tsc -p tsconfig.json
../node_modules/.bin/vitest run --config vitest.config.ts
```

Current result: typecheck clean, 59 tests passing (see
`docs/FEATURE_STATUS.md` in the repository root for per-feature status).

## What exists

- **Kernel primitives** — escape-proof virtual filesystem with atomic writes,
  allowlisted process host (no shell, hard timeouts, output caps), real host
  telemetry.
- **Services** — settings, files (trash-first deletion), application catalog,
  launcher search, notifications, structured logging, typed event bus.
- **Shell** — window manager, dock, menu bar, launcher, notification centre,
  dialogs, themes (light/dark/auto × 5 accents × 5 wallpapers).
- **Applications** — Files, TextEdit, Terminal, Activity, Settings, Console.

## Layout

```
platform/
├── src/
│   ├── core/        Result algebra, errors, events, logging, permissions, container
│   ├── kernel/      vfs, process host, system telemetry
│   ├── services/    settings, files, apps, launcher, notifications
│   ├── server/      API (pure functions) + HTTP/SSE transport
│   ├── boot.ts      composition root and boot/shutdown lifecycle
│   └── main.ts      process entry point
├── ui/              desktop shell (plain ES modules, no build step)
│   ├── styles/      design tokens + shell + app styles
│   └── js/          shell, window manager, apps
└── tests/           vitest suite
```

Architecture, inherited vs. original components, security posture and roadmap
live in `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` and `docs/FEATURE_STATUS.md`
at the repository root.

## Terminal safety model

The terminal is not a shell. A command line is split into a program and
arguments (quotes honoured); the program must appear in the platform allowlist
(`node`, `ls`, `cat`, `grep`, `uname`, …); there is no pipe, redirect or glob
support; child processes receive a minimal environment, byte-capped output and a
hard timeout. Command execution is **off by default** and requires the
`process:spawn` capability, which can be granted from Settings → Privacy or via
the Terminal's own enable button.

## Configuration

| Flag     | Environment              | Meaning                                                        |
| -------- | ------------------------ | -------------------------------------------------------------- |
| `--port` | `REAOS_PORT`             | HTTP port (default `4173`)                                     |
| `--host` | `REAOS_HOST`             | Bind address (default `0.0.0.0` for preview access)            |
| `--root` | `REAOS_HOME`             | Host directory backing the namespace (default `~/.reaos-home`) |
| —        | `REAOS_ALLOWED_COMMANDS` | Comma-separated override of the command allowlist              |

## Known limitations

- No authentication: intended for local, single-user use. Binding to a public
  interface should be done only behind a trusted proxy.
- The shell renders in a browser; there is no native compositor yet.
- Visual and DOM-level automated tests are pending (no browser binaries in the
  development sandbox used here).
- Only the trash protects destructive actions; there is no undo history yet.
