# ReaOS Platform Architecture

Status of every component is tracked in [FEATURE_STATUS.md](FEATURE_STATUS.md).
This document describes what exists, how the parts fit, and — importantly — what
ReaOS inherits from the host instead of implementing itself.

---

## 1. Layering

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  Applications (browser ES modules, served by the platform process)  │
 │  Files · TextEdit · Terminal · Activity · Settings · Console        │
 └───────────────────────────────┬─────────────────────────────────────┘
                                 │ platform context (openApp/openFile/notify…)
 ┌───────────────────────────────┴─────────────────────────────────────┐
 │  Desktop shell: window manager · dock · menu bar · launcher ·       │
 │  notification centre · dialogs · design tokens                      │
 └───────────────────────────────┬─────────────────────────────────────┘
                                 │ HTTP + Server-Sent Events (same origin)
 ┌───────────────────────────────┴─────────────────────────────────────┐
 │  Transport: platform/src/server (routing, static shell, SSE, limits)│
 ├─────────────────────────────────────────────────────────────────────┤
 │  API: platform/src/server/api.ts (pure request → response functions) │
 ├─────────────────────────────────────────────────────────────────────┤
 │  Services: settings · files (policy) · apps · launcher ·            │
 │            notifications                                            │
 ├─────────────────────────────────────────────────────────────────────┤
 │  Kernel primitives: virtual filesystem · process host · system      │
 │  telemetry · service container · permissions · events · logging     │
 └───────────────────────────────┬─────────────────────────────────────┘
                                 │ Node.js APIs (fs, child_process, os, http)
 ┌───────────────────────────────┴─────────────────────────────────────┐
 │  INHERITED HOST: Linux kernel · scheduler · VM · drivers · network  │
 └─────────────────────────────────────────────────────────────────────┘
```

**Inherited (not written by ReaOS):** CPU, firmware, host kernel, scheduler,
virtual memory, device drivers, TCP/IP, storage device, Node.js runtime.

**Original (written for ReaOS):** namespace and access policy, capability
broker, service lifecycle, event bus, logging, request limits, process
supervision, telemetry sampling and derivation, settings validation and
persistence, application catalog, launcher ranking, the entire desktop shell and
all six applications.

ReaOS is therefore **not** a kernel, and it does not claim to be. It is a
platform layer with desktop-environment responsibilities, in the same sense that
a desktop environment is a distinct component of a complete OS distribution.

## 2. Kernel primitives (`platform/src/kernel/`)

| Module           | Responsibility                                            | Key invariants                                                                                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vfs.ts`         | Virtual filesystem namespace rooted at one host directory | Virtual absolute paths only; `..` rejected; symlink escapes rejected via `realpath` on the nearest existing ancestor; reads bounded (1 MiB); listings bounded (2,000 entries, `truncated` flag); writes atomic (temp file + rename); ordering locale-independent |
| `processHost.ts` | Starts allowlisted host executables                       | No shell ever; command must be on the allowlist; arguments passed as an array; minimal environment (no ambient secrets); byte-capped output; hard timeout with `SIGKILL`; concurrency cap; capability check injected by the platform                             |
| `systemInfo.ts`  | Real host telemetry                                       | CPU usage is a delta between two `os.cpus()` samples (first sample reports `null`, never a fabricated number); memory/load/uptime from the host                                                                                                                  |

## 3. Services (`platform/src/services/`)

- **settings** — field-by-field validation, atomic persistence to
  `System/settings.json`, forward-compatible loading (unknown keys ignored,
  corrupt file reported without being destroyed), change event on write.
- **files** — _policy_ over the VFS: `fs:read` / `fs:write` capability checks,
  `/System` read-only, deletion moves entries to `/.Trash` with collision-safe
  names, permanent deletion only from inside the trash, bounded search.
- **apps** — the single owner of application identity (id, name, glyph,
  capabilities, default window size, renderer module).
- **launcher** — merges application catalogue and real file search into one
  ranked result list.
- **notifications** — bounded ring of records, dismissal as real state,
  publication guarded by `notifications:publish`.

## 4. Permissions

Capabilities: `fs:read`, `fs:write`, `process:spawn`, `settings:write`,
`notifications:publish`, `system:info`.

- Deny by default; the broker only knows capabilities that were explicitly set.
- The session baseline is granted at boot; `process:spawn` is derived from the
  `terminalEnabled` setting and re-derived on every settings change.
- The broker is enforced in the kernel/service layer (`files`, `processes`,
  `notifications`), not in the UI. A caller that skips the UI still gets denied.
- Grant/revoke notifications are published as `session.permissionsChanged`.

## 5. Boot sequence

`platform/src/boot.ts` composes a dependency-ordered container:

```
filesystem  →  settings  →  permissions  →  services
(layout)       (load/seed)   (derive)        (files, apps, launcher,
                                              notifications, telemetry,
                                              process host, home seeding)
```

A failing stage rolls back services already started (reverse order) and reports
the failing service. The same container drives shutdown, which additionally
kills child processes.

## 6. Transport and API

`platform/src/server/api.ts` is a pure function of `(platform, request)`; the
HTTP server is a thin adapter, which is why the whole API surface is testable
without a socket. Response shape is stable:

```json
{ "ok": true,  "data": … }
{ "ok": false, "error": { "code": "…", "message": "…", "details": … } }
```

Error codes map deterministically to statuses (400/403/404/409/413/500/503).

Routes: health, capabilities, system telemetry, system log, apps, settings
(read/patch/reset), files (list/read/write/mkdir/rename/trash/purge/empty
trash), search, notifications (list/publish/dismiss/dismiss-all), terminal exec,
and `/api/events` (SSE).

Transport protections: 2 MiB body limit, `nosniff`, no-store on API responses,
static serving confined to the UI directory with extension-aware SPA fallback,
0.0.0.0 binding for preview proxies.

## 7. Desktop shell

| Module                        | Responsibility                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `wm.js`                       | Window lifetime, z-order, pointer dragging, corner resizing, minimize, zoom, cascade placement                                     |
| `dock.js` (inside `shell.js`) | Application dock with running indicators, hover magnification, context menus                                                       |
| `shell.js`                    | Session state (settings, capabilities, notifications), theming, menu bar, system menu, desktop icons, global shortcuts, SSE wiring |
| `launcher.js`                 | Command-palette search over apps and files                                                                                         |
| `notifications.js`            | Toast stack plus notification centre panel                                                                                         |
| `dialog.js`                   | Promise-based `askText` / `askConfirm` modals with focus trapping                                                                  |
| `apps/*.js`                   | Six applications, each rendering into a window body through the platform context                                                   |

Design system: `ui/styles/tokens.css` owns colour, typography, spacing, radii,
motion and the five wallpapers (original gradients). Themes resolve from the
server-side settings object, so appearance is system state rather than local
preference.

## 8. Security posture

- All file access crosses the VFS namespace check, then service policy.
- No shell interpolation anywhere; arguments are arrays.
- Child processes get a minimal environment and are always reaped.
- `/System` cannot be written through the files API.
- Permanent deletion is restricted to the trash.
- Request bodies are bounded; listing/read sizes are bounded.
- The server trusts no `Host`/`Origin` header for routing and never executes
  repository content.
- Not yet implemented: authentication, TLS, multi-user isolation, sandboxing
  below the process boundary. ReaOS binds to `0.0.0.0` for preview access and is
  intended for local/single-user use; see known limitations in the roadmap.

## 9. Why the shell is served over HTTP

A desktop shell must run somewhere. A browser is the one display technology
available in this environment without writing a compositor and GPU driver.
Serving the shell from the same process as the platform keeps a single origin,
allows Server-Sent Events for push updates, and means zero client toolchain: the
files on disk are the files that run.

This is documented as an inherited boundary: ReaOS owns the shell, services and
namespace; the browser and host kernel own rendering and hardware. A native
compositor is a separate, later track ([ROADMAP.md](ROADMAP.md)).
