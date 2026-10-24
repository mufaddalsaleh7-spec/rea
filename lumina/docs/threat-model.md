# Lumina — threat model

Scope: the desktop runtime (`lumina-host`), the syscall broker and the agent
pipeline. The kernel is assessed for its own boundary only; full hardware
attacks are out of scope.

## Assets

| Asset | Why it matters |
| --- | --- |
| The sandbox tree | documents, notes, build artifacts |
| The audit log | the only record of privileged actions |
| The agent manifest | defines what may touch which layer |
| Framebuffer contents | everything the user sees, including notes |
| Build reproducibility | the claim that the shipped system matches the sources |

## Actors

| Actor | Capability assumed |
| --- | --- |
| Curious user | types any string into the terminal; clicks anything |
| Malicious document | content only, no code execution |
| Malicious agent definition | controls a manifest entry, not the code |
| Local process | can read files it owns, cannot attach to the broker |
| Remote attacker | **no network surface exists** |

## Threats and mitigations

### T1 — Path escape through the terminal or an app
*Vector:* `cat ../../etc/passwd`, `ls /`, a symlink inside the sandbox pointing
out of it.
*Mitigation:* `Broker.resolve()` normalises with `Path.resolve()` (which follows
symlinks) and then requires the result to be relative to the root; otherwise
`EACCES`. Covered by `test_traversal_is_denied`,
`test_absolute_escape_is_denied`, `test_home_prefix_stays_inside`.
*Residual:* a race between resolve and open (TOCTOU). Mitigation today: the
sandbox is single-process and calls are serialised. Fix planned with directory
file descriptors.

### T2 — Resource exhaustion
*Vector:* allocate thousands of surfaces or frames; fill every IPC channel.
*Mitigation:* explicit budgets, typed errors, no unbounded growth. Covered by
`BudgetTests`.
*Residual:* the broker itself keeps the audit list unbounded in memory; a long
session can consume memory. Mitigation: `--audit` writes to disk; rotate the log.

### T3 — Silent privilege
*Vector:* a tool performs an action no one declared.
*Mitigation:* capabilities are declared per agent and validated against the
surface; `orchestrator --check` fails on an unknown capability.
*Residual:* the check validates names, not behaviour. A review step is required
for new capabilities.

### T4 — Audit tampering
*Vector:* edit the log to hide a denial.
*Mitigation:* monotonic sequence numbers make truncation visible; denials carry
errno and reason.
*Residual:* no chaining/hashing, so an attacker with write access to the log can
rewrite history consistently. Planned: hash-chained records.

### T5 — Malicious input to the renderer
*Vector:* oversized strings, Unicode the font lacks, negative geometry.
*Mitigation:* every draw call clips against the surface; `fold_utf8` maps unknown
codepoints to `?` and known typography to ASCII; text width is computed by the
same function that draws. Covered by surface and determinism tests.
*Residual:* extremely long single lines cost CPU proportional to length; the
terminal wraps at the content width.

### T6 — Kernel faults
*Vector:* bad pointer from a driver, an unexpected exception.
*Mitigation:* every exception has a stub; fatal ones print vector, `rip` and
`cr2` to serial and paint a panic screen, then halt. Double faults use a
dedicated IST stack.
*Residual:* a fault inside the panic path triple-faults and reboots.

### T7 — Supply chain
*Vector:* a dependency introduces code.
*Mitigation:* zero third-party runtime dependencies; the only embedded asset is a
public-domain font; build-time tools are listed in `THIRD_PARTY_NOTICES.md`.
*Residual:* the toolchain itself is trusted.

## Non-goals

- Defending against a compromised kernel or hypervisor.
- Multi-user isolation and file permissions.
- Network attacks (no network stack).
- Physical attacks, DMA attacks, firmware implants.
- Covert channels and timing side channels.

## Review checklist for a new capability

1. Which domain does it belong to, and why does an existing call not cover it?
2. What is the failure mode when arguments are hostile?
3. What budget bounds it, and what error signals exhaustion?
4. Which agents may use it, and does `manifest.json` say so?
5. What does the audit record show, and can a denial be distinguished from a
   success?
6. Which test proves the boundary holds?
