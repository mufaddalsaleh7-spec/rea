# Lumina — the agent pipeline

Lumina is built by nine named agents. The manifest is the contract; the
orchestrator is the runner; the report is the evidence.

```bash
python3 lumina/agents/orchestrator.py --check     # is the manifest true?
python3 lumina/agents/orchestrator.py --plan      # what will run, in order
python3 lumina/agents/orchestrator.py --run       # build + report
python3 lumina/agents/orchestrator.py --verify    # build + every verify command
python3 lumina/agents/orchestrator.py --status    # last run, per stage
```

Reports land in `lumina/build/pipeline.json`:

```json
{
  "schema": "lumina.pipeline/1",
  "summary": {"passed": 7, "skipped": 2, "failed": 0, "not_run": 0},
  "stages": [
    {"role": "kernel-architect", "status": "skipped",
     "detail": "toolchain unavailable (source present, not compiled)"}
  ]
}
```

## The nine roles

| # | Agent | Language | Target | Owns |
| --- | --- | --- | --- | --- |
| 1 | `kernel-architect` | Rust | kernel | boot, long mode, frames, heap, scheduler |
| 2 | `graphics-engineer` | Rust | kernel | framebuffer claim, boot console, present path |
| 3 | `compositor-engineer` | C++ | compositor | surface rasteriser, z-order, focus, glass, motion |
| 4 | `shell-designer` | C++ | lumina-host | menubar, dock, control centre, spotlight, workspaces |
| 5 | `syscall-architect` | Python + Rust | syscalls | the 24-call surface, policy, audit |
| 6 | `app-builder` | C++ | compositor | Files, Terminal, Notes, Settings, Monitor, About, Studio |
| 7 | `qa-engineer` | Python | syscalls | unit tests, goldens, determinism, CI gate |
| 8 | `security-reviewer` | Python | lumina-host | threat model, policy, capability review |
| 9 | `release-manager` | Python | lumina-host | versioning, artifacts, docs, changelog |

## Invariants the orchestrator enforces

1. Every layer has exactly one owner.
2. Every build command is reproducible from the manifest alone.
3. An agent may not use a capability the broker does not expose.
4. A stage is not `passed` unless its declared outputs exist on disk.
5. A missing toolchain is `skipped`, never `passed`, and the exit code still
   distinguishes the two.

## Status semantics

| Status | Meaning |
| --- | --- |
| `passed` | every command exited 0 **and** every declared output exists |
| `skipped` | source present, command could not run (e.g. no `cargo`) |
| `failed` | a command failed or an output is missing; downstream stages do not run |

`--run` exits non-zero only for `failed`. A `skipped` Rust lane is reported in
the summary and in `lumctl.py status`, so it can never be mistaken for a build.

## Why a manifest instead of a Makefile

A Makefile encodes *how*. The manifest encodes *who owns what, what it produces,
what it may touch and how it is verified*. That extra structure is what lets a
reviewer answer "which agent introduced the framebuffer blit path?" and what lets
`--check` catch a stale capability list. `make` still exists for the C++ tree;
the pipeline calls it.

## Kernel-side mirror

`kernel/src/agent.rs` compiles the same nine roles into the image, and the
`agent-orchestrator` kernel thread logs each role at boot. `SYS_AGENT_QUERY`
lets ring 3 ask the kernel which agents it was built by — the running system can
state its own provenance.
