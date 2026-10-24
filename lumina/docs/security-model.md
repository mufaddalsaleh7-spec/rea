# Lumina — security model

Lumina's claim is narrow and testable: **the boundary between a program and the
machine is small, typed, declared and audited.** This document states the model,
the code that enforces it, and what it does not cover.

## Trust boundaries

```
┌─────────────────────────── untrusted ────────────────────────────┐
│ terminal input · paths taken from the UI · agent manifests       │
└───────────────────────────────┬──────────────────────────────────┘
                                │ validate at the boundary
┌───────────────────────────────▼──────────────────────────────────┐
│ ring 3: broker (tools/lumina/sysd.py)                            │
│  · path confinement   · budgets   · read-only policy   · audit   │
└───────────────────────────────┬──────────────────────────────────┘
                                │ 24 typed calls
┌───────────────────────────────▼──────────────────────────────────┐
│ ring 0: kernel (kernel/src/syscall.rs)                           │
│  · number validation  · capability check  · counters             │
└──────────────────────────────────────────────────────────────────┘
```

Nothing else crosses. The C++ shell is a *client* of the surface; it holds no
privilege of its own — it draws surfaces, reads the clock and asks the broker.

## Controls

| Control | Where | Behaviour on violation |
| --- | --- | --- |
| Sandbox confinement | `Broker.resolve` | `EACCES`, audited, path echoed |
| Read-only mode | `Broker.read_only` | `EPERM` for `open(w)` / `write_fd` |
| Frame budget | `Broker.max_frames` | `ENOMEM` |
| Surface budget | 128 handles / 64 MiB | `ENOSPC` / `ENOMEM` |
| IPC queue bound | 256 messages per channel | `EAGAIN` |
| Read bound | 1 MiB per read | `EINVAL` |
| Unknown call | kernel + broker | `ENOSYS`, counted as denied |
| Bad arguments | Python type check | `EINVAL`, audited |
| Capability declaration | `agents/manifest.json` + `orchestrator --check` | pipeline check fails |
| Fatal exception | `idt::isr_dispatch` | panic screen + serial dump, machine halted |

## Audit trail

Every call is recorded before the result is returned:

```json
{"seq":7,"at":11.204,"call":"surface_create","domain":"gfx",
 "args":{"w":8192,"h":8192},"verdict":"denied","errno":12,"error":"ENOMEM"}
```

Properties the tests assert:

- sequence numbers are strictly increasing with no gaps;
- denials record `errno`, `error` and a reason;
- allowed calls record the result;
- the record is written before the caller can observe the effect.

## Least privilege in the build

Agents declare capabilities, and the orchestrator refuses a manifest that asks
for something the surface does not expose. Two examples:

- `qa-engineer` may `fs.read`, `proc.info`, `time.read` — it cannot allocate
  surfaces or spawn threads.
- `security-reviewer` may only read files and ask for process info.

## What this model does not cover

Stated plainly so nobody over-trusts it:

1. **This is a single-address-space demonstrator.** The kernel prepares ring 3
   descriptors (DPL 3 entries for user code/data, TSS with `rsp0`) and the
   `int 0x80` gate is DPL 3, but the shipped boot path enters the desktop as a
   kernel thread. User-mode isolation is wired, not yet exercised end to end.
2. **No MMU protection between apps.** Surfaces are sized and accounted for, not
   paged with per-app permissions.
3. **No signature or provenance verification** of programs yet. The pipeline is
   reproducible from the manifest, but nothing cryptographically attests it.
4. **No network stack**, therefore no remote attack surface — and no network
   hardening claims either.
5. **The broker is not a security kernel.** If an attacker already executes
   arbitrary code inside the Python process, the audit log is advisory. The log
   is tamper-evident only by sequence ordering, not by chaining or signing.
6. **Timing side channels** are not addressed.

## Recommended posture

For evaluation, run with `--read-only`, keep `--audit` on, and treat the desktop
as a UI shell over a broker you can read in one sitting. The value proposition is
inspectability: every privileged action has one place to look.
