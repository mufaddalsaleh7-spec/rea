# ReaOS Roadmap

Milestones are ordered by dependency, not by desire. Each states its exit
criteria and its blocking prerequisites. Status here must match
[FEATURE_STATUS.md](FEATURE_STATUS.md).

---

## M1 — Foundation (this session) — **DONE**

Kernel primitives, services, API, shell, six applications, docs.

Exit criteria met:

- platform typechecks under `strict` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes`;
- 59 automated tests pass;
- server boots and every documented route was exercised with real requests;
- REA itself is untouched apart from a README pointer.

## M2 — Verification depth — **NEXT** (partially delivered)

Goal: convert the remaining 🟡 BUILD_VERIFIED rows to ✅ TEST_VERIFIED.

Delivered in this session: a headless DOM harness
(`platform/tools/shell-smoke.mjs`) that boots the real shell against a live
platform and asserts boot, every application window, the editor save round-trip,
launcher search, server-driven re-theming and the terminal capability flow.

Remaining:

1. Headless browser suite (Playwright) for layout, painting and pointer input —
   **blocked here**: browser binaries are not obtainable in this sandbox.
2. Static checks for `platform/`: add the module to `oxlint`/`oxfmt` scope and
   to a nightly typecheck job so platform code is held to the repository's own
   bar.
3. Failure-injection tests: settings write failure, VFS permission errors,
   process start failure, SSE reconnect.

Exit criteria: a CI job runs platform tests on every pull request, and shell
behaviour is asserted through the DOM.

## M3 — Persistence and recovery

- Journal/undo for destructive file operations (trash is already recoverable;
  add restore-to-original-path and an operation log).
- Settings migration with explicit schema versions.
- Crash-safe session restore (reopen windows after a shell reload).
- Log persistence with rotation.

Exit criteria: power-loss simulation (kill -9 between write stages) leaves the
namespace consistent; tests cover each stage.

## M4 — Real application platform

- Third-party application manifests (installed into a `Applications/` namespace)
  with declared capabilities and an install/remove flow.
- Capability prompts generated from manifest declarations instead of a global
  setting.
- Application lifecycle supervision (crashed app → isolated failure surface).
- Multi-window document model shared by applications.

Exit criteria: an application that is not in the built-in catalog can be
installed, launched, denied a capability and uninstalled entirely through
platform APIs, with tests.

## M5 — Security hardening

- Authenticate the shell session (token issued at boot, required by the API) so
  binding to a network interface is safe by default.
- Bind loopback by default; require an explicit flag for network exposure.
- Rate limiting and per-session request quotas.
- Content Security Policy for the shell.
- Audit log for privileged actions.

Exit criteria: default configuration is not reachable from another host; the
audit log records every spawn and every destructive file operation.

## M6 — Native desktop track (research)

Options, in rough order of cost:

1. **Native window in a host toolkit** (e.g. a Node-backed window with an
   embedded web view): removes the browser from the equation while keeping the
   current shell.
2. **Own compositor** (WASM/WebGPU or a native GPU API): real rendering surface.
3. **Kernel track**: bootloader + kernel + drivers on hardware or QEMU.

The kernel track stays PLANNED because it needs prerequisites this environment
cannot provide (cross toolchain, QEMU/KVM, hardware or an emulator with a
graphics device). If pursued, the honest plan is a staged bring-up:

1. bootloader → long mode → serial output;
2. physical/virtual memory + interrupts;
3. framebuffer text console;
4. pre-emptive scheduler and syscalls;
5. driver model (PS/2 or virtio input, simple storage);
6. port ReaOS's service/namespace/permission model onto the kernel, reusing the
   capability semantics proven here.

Nothing in the current work blocks that path: the permission model, namespace
rules and process supervision semantics are already specified and tested
independently of the host.

## M7 — Ecosystem and product polish

- File manager: multi-select, drag-and-drop, thumbnail grid, copy/move.
- Editor: syntax highlighting, find/replace, tabs.
- Launcher: recent items, calculator-style actions, preference ranking.
- Accessibility: full keyboard-only traversal audit, screen-reader labels,
  contrast verification.
- Theming: user-defined accent, high-contrast mode, compact density.
- Packaging: a signed desktop launcher script, versioned release artifacts for
  the platform module (kept separate from the `rea-agents` npm package).

## Explicit non-goals for now

- Claiming macOS compatibility (running macOS software).
- Copying Apple brand assets, fonts, icons or code.
- Replacing or refactoring the REA reverse-engineering product.
- Shipping a bootable ISO before the prerequisites above exist.
