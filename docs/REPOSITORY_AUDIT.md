# Repository Audit — `mufaddalsaleh7-spec/rea`

Date: 2026-10-25
Branch: `arena/84e2e5b8-rea` (from `main` @ `e5ee3ac`, "fix(apktool): preserve decoded APK Evidence subject (#4771)")
Auditor: Arena agent, on the sandbox image described in [BUILD_AND_TEST.md](BUILD_AND_TEST.md).

This document records what the repository actually contains before any change was
made. Nothing here is inferred from the project name.

---

## 1. What this repository is

**REA ("Reverse Engineer Anything") is not an operating system and contains no
kernel, bootloader, desktop environment or GUI toolkit.**

It is a mature, production-grade **Node.js/TypeScript reverse-engineering
toolkit** published to npm as `rea-agents` (v6.5.0, MIT). It exposes a shared
service layer through two adapters:

| Adapter    | Entry point                      | Purpose                                    |
| ---------- | -------------------------------- | ------------------------------------------ |
| CLI        | `scripts/rea.mjs` → `src/cli.ts` | Terminal workflows                         |
| MCP server | `src/main.ts`                    | Model Context Protocol tools for AI agents |

Measured facts from the checkout:

| Property           | Value                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language           | TypeScript (ESM, `"type": "module"`), plus Python and Java bridge sources                                                                                   |
| Runtime            | Node.js `^22.19.0                                                                                                                                           |     | ^24.11.0 |     | >=26.0.0` (`.nvmrc` pins 24.18.0) |
| Package manager    | npm 11.16.0 (pinned via `packageManager`)                                                                                                                   |
| Source size        | `src/` ≈ 21 MB, 43 domain directories, ~4,200 tracked files in total                                                                                        |
| Tests              | `tests/` ≈ 13 MB across 8 suites (acceptance, boundary, composition, conformance, evaluation, fixtures, process-global, support) plus colocated `*.test.ts` |
| Docs               | VitePress site (`docs/`), i18n READMEs (20 languages), ~80 design documents                                                                                 |
| Dependencies       | 40 runtime deps, 24 dev deps, 523 packages installed by `npm ci`                                                                                            |
| Native/bridge code | `bridge/` (Ghidra Java, Hopper/Cutter Python, LLDB + Swift, JADX, mitmproxy, pwndbg)                                                                        |
| CI                 | 25 GitHub Actions workflows (CI, mutation, release, real-provider verification)                                                                             |

### Capability areas that already work

The tool analyses binaries, applications and runtime behaviour through provider
adapters: Ghidra, IDA, Hopper, Cutter, JADX, JEB, Kuna, Frida, LLDB/pwndbg,
Playwright (browser), Electron, JavaScript/TypeScript static analysis, .NET,
WASM, EVM/Solidity, PCAP, firmware, SQLite, Android/ADB, HarmonyOS and Flutter.

Engineering conventions are unusually strict and worth preserving:

- dependencies flow inward (domain → adapters → application → CLI/MCP);
- expected failures are modelled with a tagged `Result` algebra;
- Evidence provenance, uncertainty and ownership rules are explicit
  (`AGENTS.md`, `docs/tool-design.md`);
- architecture guards and module-boundary checks run in CI.

## 2. What already works (verified in this session)

| Check                                                    | Result                                                                                                                                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci`                                                 | ✅ Completed, 523 packages in 13 s                                                                                                                                                                                             |
| `npm run build:cached`                                   | ⏸ Not run in this session (see §4)                                                                                                                                                                                             |
| Platform typecheck (`npx tsc -p platform/tsconfig.json`) | ✅ Passes                                                                                                                                                                                                                      |
| Platform tests (`vitest`, 59 tests)                      | ✅ Passes                                                                                                                                                                                                                      |
| Platform server boot + API (`curl`)                      | ✅ Verified                                                                                                                                                                                                                    |
| Full-repo `npx tsc --noEmit`                             | ⛔ **Blocked by sandbox memory** — the compiler reached 95 % of the 3.9 GB VM and entered swap-thrash with no swap configured; the process was killed after 8 minutes. Not a repository defect; it is a limit of this sandbox. |
| Full-repo lint/tests                                     | ⏸ Not run: they depend on the same large TypeScript graph and on generated artifacts.                                                                                                                                          |

The REA project's own checks are designed for 8 GB+ CI runners with caches and
sharding. This sandbox has 2 vCPUs and 3.9 GB RAM (see [BUILD_AND_TEST.md](BUILD_AND_TEST.md)).

## 3. What is missing for the requested mission

The user's mission is a macOS-like operating system and desktop platform. The
repository has **none** of the following:

- bootloader, kernel, scheduler, virtual memory manager, device drivers;
- display/windowing server, compositor, desktop shell, dock, launcher;
- system settings, file manager, terminal UI, GUI applications;
- capability/permission model for GUI applications;
- software installation/update mechanism.

It also contains nothing that should be thrown away: REA is a valuable,
independent product with its own release process, tests and governance
(`CONTRIBUTING.md`, `SECURITY.md`, `DISCLAIMER.md`). Replacing it with an
unrelated starter template would destroy a working product.

## 4. Recommended direction

**Build ReaOS as a new, clearly separated platform module inside this
repository, on top of a proven host kernel — do not write a bootloader/kernel
from scratch inside this repository.**

Rationale:

1. **The repository is a userspace TypeScript project.** Bootstrapping real
   hardware requires a bootloader, firmware interactions, a scheduler, drivers
   and a graphics stack — years of systems work with no relationship to the
   existing code, and none of it verifiable in this environment (no QEMU, no
   KVM check, no cross-compiler toolchain, 2 vCPU sandbox).
2. **The fastest credible path to a real, testable product is a platform layer**
   that owns its own namespace, capability model, services, shell and
   applications while inheriting the host kernel. This is the same architecture
   modern "OS-like" products use (ChromeOS's Linux base, Windows Subsystem, and
   indeed macOS's own Darwin/XNU inheritance).
3. **It is honest.** We can state precisely which components are inherited
   (host kernel, CPU, storage device, network stack) and which are original
   (everything under `platform/`).
4. **REA stays intact.** No existing file was deleted, renamed or rewritten. The
   only edit to an existing file is a short pointer in `README.md`.

A genuine kernel track remains documented as **PLANNED** in
[ROADMAP.md](ROADMAP.md) with its prerequisites, rather than pretended.

## 5. Decision log

| Decision                                                         | Reason                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New module `platform/` rather than edits to `src/`               | Preserves REA's module-boundary guards; keeps the desktop platform independently runnable and testable.                                                       |
| Backend in TypeScript, strict mode, native `.ts` execution       | Matches repository language and strictness conventions; no build step for the platform (Node ≥22.19 strips types natively), so what runs is what is reviewed. |
| Desktop shell as plain ES modules served by the platform process | One origin, no bundler, no framework dependency, deterministic review.                                                                                        |
| Reuse the repository's `Result` algebra and error philosophy     | Consistency with `src/domain`, and no exceptions crossing service boundaries.                                                                                 |
| Filesystem namespace rooted at `~/.reaos-home`                   | Real isolation boundary that can be tested; avoids touching host files.                                                                                       |
