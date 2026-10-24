# Changelog

All notable changes to Lumina OS. Format: [Keep a Changelog](https://keepachangelog.com/),
versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] — "crystal" — 2026-10-24

The first coherent release: a working desktop, a freestanding kernel source tree,
a brokered syscall surface, and a reproducible agent pipeline.

### Added — runtime and shell (C++17)

- **Software compositor** with antialiased rounded geometry from a signed
  distance field, alpha-correct fills, cached shadow masks, separable box blur
  and vector icon primitives.
- **Window management**: z-order, focus, hit-tested chrome (titlebar, traffic
  lights, resize edges), drag with magnetic top edge, zoom, minimise, and
  240 ms/170 ms open/close animation.
- **Desktop shell**: menubar with five working menus and live app/clock/syscall
  badges, docking bar with proximity magnification and running indicators,
  control centre (Wi-Fi, Bluetooth, appearance, glass, brightness, volume,
  accent, focus), spotlight search, three workspaces with HUD, and a 1.9 s boot
  sequence with subsystem log.
- **Seven first-party apps**: Files (navigable sandbox tree), Terminal
  (history, scrollback, wrapping, broker-backed commands), Notes (instant save),
  Settings (all tokens), Monitor (live `/proc` telemetry and frame pacing),
  About, and **Build Studio** (the pipeline, rendered).
- **Fifteen-frame still tour** and a **live preview server** streaming raw RGBA
  with pointer/keyboard input, bound to `0.0.0.0` for proxied previews.
- **Dependency-free PNG writer** plus an offline optimiser that shrinks stills by
  ~98% with real deflate.

### Added — kernel (Rust + assembly)

- Multiboot2 header requesting a 1280×800×32 framebuffer; 32-bit entry that
  builds PML4/PDPT/PD (1 GiB identity map, 2 MiB pages), enables PAE + long mode
  and far-jumps into 64-bit Rust.
- GDT with ring-3 selectors and a TSS, 16 KiB ring-0 stack, 8 KiB IST stack for
  double faults.
- IDT with 48+ stubs through one trampoline, fatal-exception reporting with
  vector, `rip` and `cr2`, PIC remap to vectors 32..47, PIT at 100 Hz.
- Bitmap physical-frame allocator over the firmware map and a first-fit heap
  behind `GlobalAlloc`, both failure-typed.
- Preemptive round-robin scheduler where new and preempted threads share one
  `InterruptFrame` representation.
- Framebuffer console: boot splash, pipeline panel, subsystem log, live status
  strip, panic screen.
- `int 0x80` gate wired alongside `SYSCALL`/`SYSRET` MSRs, with a boot self-test
  and a heartbeat kernel thread.
- The nine agent roles compiled into the image, queryable from ring 3.

### Added — syscalls (Python + Rust)

- 24 typed calls across 8 domains, with a single table mirrored in Rust and
  Python and enforced by a cross-language parity test.
- Ring-3 broker with path confinement, read-only mode, frame/surface/IPC/read
  budgets, typed errno failures and a JSONL audit trail with monotonic sequence
  numbers.
- `--list`, `--describe`, `--call`, `--exec`, `--self-test`, `--audit`.

### Added — pipeline and tooling (Python)

- `agents/manifest.json`: nine agents with language, target, owned layer,
  skills, outputs, capabilities and commands.
- `agents/orchestrator.py`: `--check`, `--plan`, `--run`, `--verify`,
  `--status`, `--json`; reports `build/pipeline.json`; distinguishes `passed`,
  `skipped` and `failed`; refuses unknown capabilities and missing outputs.
- `tools/lumina/lumctl.py`: `status`, `doctor`, `apps`, `syscalls`, `agents`,
  `build`, `shots`, `preview`, `verify`, `release`.
- `tools/lumina/optimize_png.py` and `kernel/scripts/check-image.sh`.

### Added — verification

- `tests/test_core.cpp`: 134 checks over geometry, colour, rasteriser coverage,
  UTF-8 folding, theme tokens, window lifecycle, input routing, workspaces,
  every app, and a framebuffer determinism hash.
- `tests/test_sysd.py`: 43 unittest cases over the surface, Rust/Python parity,
  policy, budgets, audit integrity, shell mapping and the manifest.
- `sysd.py --self-test`: 17 invariants including traversal denial and
  capability coverage.

### Documentation

- `README.md`, `docs/architecture.md`, `docs/kernel.md`, `docs/syscalls.md`,
  `docs/design-language.md`, `docs/agents.md`, `docs/security-model.md`,
  `docs/threat-model.md`, `docs/beyond-macos.md`,
  `THIRD_PARTY_NOTICES.md`.

### Known limitations

- The Rust kernel was **not compiled or booted** while assembling this release
  (no Rust toolchain in the build environment). Source is complete and reviewed;
  `docs/kernel.md` documents the expected serial log and the exact QEMU command.
- Ring 3 isolation is wired (DPL 3 selectors, TSS, `int 0x80` gate) but the boot
  path enters the desktop as a kernel thread.
- No network stack, no package signatures, no per-app MMU isolation.
- The broker's audit log is ordered but not hash-chained.

## [0.1.0] — internal

- Bootstrap: compositor prototype, theme tokens, single-window shell.
