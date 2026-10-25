# ReaOS Feature Status Matrix

Status vocabulary (defined by the project brief):

- **PLANNED** — designed, not started.
- **IN_PROGRESS** — partially implemented.
- **IMPLEMENTED** — code exists and integrates, but build/tests not yet run for it.
- **BUILD_VERIFIED** — compiles/loads and runs in the current environment.
- **TEST_VERIFIED** — automated tests cover it **and** they pass.
- **BLOCKED** — cannot proceed in this environment; prerequisite named.

Last updated: 2026-10-25. Legend: ✅ tested, 🟡 built only, ◻ planned, ⛔ blocked.

Verification methods:

- **unit/API tests** — `platform/tests` (59 tests, all passing).
- **DOM harness** — `platform/tools/shell-smoke.mjs` (linkedom, all checks
  passing). It drives the real shell against a live platform. It is _not_ a
  browser: layout/painting/pointer gestures are unverified.
- **manual** — `curl` against a live server, recorded in
  [BUILD_AND_TEST.md](BUILD_AND_TEST.md).

---

## 1. Platform core

| Feature                                                             | Status            | Evidence / note                                                                          |
| ------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| Service container with dependency-ordered boot and rollback         | ✅ TEST_VERIFIED  | `tests/container.test.ts` (4 tests)                                                      |
| Virtual filesystem namespace (escape-proof, path-safe)              | ✅ TEST_VERIFIED  | `tests/vfs.test.ts` (13 tests)                                                           |
| Atomic file writes                                                  | ✅ TEST_VERIFIED  | vfs test + implementation (temp + rename)                                                |
| Virtual filesystem size/listing bounds                              | ✅ TEST_VERIFIED  | vfs test                                                                                 |
| Capability broker (deny by default)                                 | ✅ TEST_VERIFIED  | `tests/permissions.test.ts`                                                              |
| Capability enforcement in file operations                           | ✅ TEST_VERIFIED  | `tests/files.test.ts`                                                                    |
| Capability enforcement in process execution                         | ✅ TEST_VERIFIED  | process host + API gating tests                                                          |
| Process host: allowlist, no shell, timeout, output cap, minimal env | ✅ TEST_VERIFIED  | `tests/processHost.test.ts` (8 tests)                                                    |
| Real host telemetry (CPU delta, memory, load, uptime)               | ✅ TEST_VERIFIED  | API test asserts `null` first sample then 0–100                                          |
| Structured logging with bounded ring buffer                         | ✅ TEST_VERIFIED  | API test reads the system log                                                            |
| Settings: validation, atomic persistence, forward compatibility     | ✅ TEST_VERIFIED  | `tests/settings.test.ts` (6 tests)                                                       |
| Settings: corrupt-file fallback without data loss                   | ✅ TEST_VERIFIED  | settings test                                                                            |
| Event bus (typed topics, SSE delivery)                              | ✅ TEST_VERIFIED  | SSE test through HTTP                                                                    |
| Session boot seeds a usable home directory                          | ✅ BUILD_VERIFIED | observed via live API listing                                                            |
| Filesystem sandbox at host level (chroot/namespace/VM)              | ◻ PLANNED         | Current isolation is path-level inside one process                                       |
| Kernel, scheduler, memory manager, drivers                          | ⛔ BLOCKED        | Requires a bootloader + toolchain + emulator; none available. Track described in ROADMAP |
| Networking/system services beyond HTTP                              | ◻ PLANNED         | HTTP is the only transport                                                               |
| Software installation/update mechanism                              | ◻ PLANNED         | —                                                                                        |
| Authentication / multi-user accounts                                | ◻ PLANNED         | Single-user only                                                                         |

## 2. Desktop shell

| Feature                                                                  | Status                         | Evidence / note                                                         |
| ------------------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------- |
| Shell boots and hides the boot overlay                                   | ✅ TEST_VERIFIED (DOM harness) | `shell-smoke.mjs`                                                       |
| Window manager: open, focus, content render, close                       | ✅ TEST_VERIFIED (DOM harness) | All six applications opened from the dock                               |
| Window manager: drag, corner resize, minimize, zoom, cascade restore     | 🟡 BUILD_VERIFIED              | Implemented; needs real pointer input to verify                         |
| Dock renders the catalog and opens applications                          | ✅ TEST_VERIFIED (DOM harness) | 7 dock items asserted                                                   |
| Dock running indicators, hover magnification, context menu               | 🟡 BUILD_VERIFIED              | Implemented; not asserted                                               |
| Menu bar system menu, app/window menu, shortcut list panel               | 🟡 BUILD_VERIFIED              | Implemented; not asserted                                               |
| Live clock (host time, optional seconds)                                 | ✅ TEST_VERIFIED (DOM harness) | Non-empty clock asserted                                                |
| Status chips: CPU usage, terminal capability                             | ✅ TEST_VERIFIED               | Endpoint tests + harness asserts the CPU chip text                      |
| Launcher: Ctrl+Space, ranked app + file search                           | ✅ TEST_VERIFIED (DOM harness) | Query "Wel" returned the seeded document                                |
| Keyboard navigation inside the launcher (↑/↓/⏎)                          | 🟡 BUILD_VERIFIED              | Implemented; not asserted                                               |
| Notification centre panel + toasts                                       | 🟡 BUILD_VERIFIED              | Backend publish/dismiss/SSE are TEST_VERIFIED; UI surfaces not asserted |
| Desktop icons render                                                     | ✅ TEST_VERIFIED (DOM harness) | 2 icons asserted                                                        |
| Desktop context menu                                                     | 🟡 BUILD_VERIFIED              | Implemented; not asserted                                               |
| Modal text prompt (used by save/new folder)                              | ✅ TEST_VERIFIED (DOM harness) | Driven during the editor save flow                                      |
| Modal confirm dialog                                                     | 🟡 BUILD_VERIFIED              | Implemented; not asserted                                               |
| Theming: light/dark/auto, accents, wallpapers, dock size, reduced motion | ✅ TEST_VERIFIED (DOM harness) | Settings change re-themed `documentElement` through the server          |
| Shortcuts: Ctrl+Space                                                    | ✅ TEST_VERIFIED (DOM harness) | Used to open the launcher                                               |
| Shortcuts: Ctrl+W/M/S, Ctrl+1–6                                          | 🟡 BUILD_VERIFIED              | Implemented; not asserted                                               |
| Accessibility: roles, labels, visible focus, reduced motion              | 🟡 BUILD_VERIFIED              | Screen-reader audit still pending                                       |
| Browser-based UI test suite                                              | ⛔ BLOCKED                     | No browser binaries in the sandbox                                      |
| Native compositor / GPU rendering                                        | ◻ PLANNED                      | Requires a native windowing track                                       |

## 3. Applications

| Application                                                 | Status                                          | Capabilities          | Backed by                             |
| ----------------------------------------------------------- | ----------------------------------------------- | --------------------- | ------------------------------------- |
| Files — browse real directories                             | ✅ TEST_VERIFIED (DOM harness)                  | `fs:read`             | `/api/files`                          |
| Files — create, rename, trash, purge, search                | 🟡 BUILD_VERIFIED (UI) / ✅ TEST_VERIFIED (API) | `fs:write`            | `/api/files/*`                        |
| TextEdit — open, edit, save, dirty indicator                | ✅ TEST_VERIFIED (DOM harness + API)            | `fs:read`, `fs:write` | `/api/files/read`, `/api/files/write` |
| TextEdit — revert, tab insertion, word/line counters        | 🟡 BUILD_VERIFIED                               | —                     | —                                     |
| Terminal — locked until the capability is granted           | ✅ TEST_VERIFIED (DOM harness)                  | —                     | `/api/capabilities`                   |
| Terminal — enable from the UI, run a command, render output | ✅ TEST_VERIFIED (DOM harness)                  | `process:spawn`       | `/api/terminal/exec`                  |
| Terminal — history, built-ins (`help`, `open`, `caps`)      | 🟡 BUILD_VERIFIED                               | —                     | —                                     |
| Activity — renders the window and live cards                | ✅ TEST_VERIFIED (DOM harness)                  | `system:info`         | `/api/system`                         |
| Activity — sparkline drawing                                | 🟡 BUILD_VERIFIED                               | —                     | Canvas (no browser to paint)          |
| Settings — sections render, theme change persists           | ✅ TEST_VERIFIED (DOM harness + API)            | `settings:write`      | `/api/settings`                       |
| Settings — privacy toggle, reset, test notification         | 🟡 BUILD_VERIFIED (UI) / ✅ TEST_VERIFIED (API) | —                     | `/api/settings`, `/api/notifications` |
| Console — log window renders                                | ✅ TEST_VERIFIED (DOM harness)                  | `system:info`         | `/api/system/logs`                    |
| Console — level/text filters                                | 🟡 BUILD_VERIFIED                               | —                     | —                                     |

"No fake data" check: every application reads a platform endpoint listed in
[ARCHITECTURE.md](ARCHITECTURE.md) §6. There are no hard-coded metrics, file
trees or log entries in the UI.

## 4. Design identity

| Item                                                  | Status                                          |
| ----------------------------------------------------- | ----------------------------------------------- |
| Design tokens (colour, type, spacing, radius, motion) | 🟡 BUILD_VERIFIED                               |
| Original logo/mark and five wallpaper gradients       | 🟡 BUILD_VERIFIED                               |
| Consistent window/dock/panel/control vocabulary       | 🟡 BUILD_VERIFIED                               |
| Third-party icon or font assets                       | None used (system font stack, our own SVG mark) |
| Visual review by a human designer                     | ◻ PLANNED                                       |

## 5. What would promote the remaining 🟡 rows

1. **Pointer/interaction coverage** — a Playwright suite (blocked: no browser
   binaries here) asserting drag, resize, minimize, zoom, dock context menus,
   notification panel and confirm dialogs.
2. **Painting coverage** — screenshot comparison for the sparkline, glass
   surfaces and wallpaper rendering.
3. **Accessibility audit** — keyboard-only traversal and a screen-reader pass.
4. **Files operations through the UI** — the API paths are tested; the harness
   covers listing and the editor save. Create/rename/trash buttons still need a
   UI-level assertion.
