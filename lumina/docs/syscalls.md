# Lumina — the syscall surface

Lumina exposes exactly **24 typed calls across 8 domains**. The kernel
(`kernel/src/syscall.rs`, `SYS_TABLE`) and the ring-3 broker
(`tools/lumina/sysd.py`, `SYSCALLS`) hold the same list, and the broker's
self-test parses the Rust source so the two cannot drift.

| # | Call | Domain | Arguments | Returns | Capability |
| --- | --- | --- | --- | --- | --- |
| 1 | `write` | io | fd, buf, len | bytes | `io.write` |
| 2 | `exit` | proc | code | never | `proc.exit` |
| 3 | `yield` | proc | – | 0 | `proc.yield` |
| 4 | `time` | time | – | ticks | `time.read` |
| 5 | `brk` | mem | addr | break | `mem.alloc` |
| 6 | `mmap` | mem | len, prot | addr | `mem.alloc` |
| 7 | `munmap` | mem | addr, len | 0 | `mem.free` |
| 8 | `surface_create` | gfx | w, h | handle | `gfx.surface` |
| 9 | `surface_present` | gfx | handle | 0 | `gfx.present` |
| 10 | `surface_blit` | gfx | dst, src, rect | 0 | `gfx.blit` |
| 11 | `open` | fs | path, flags | fd | `fs.read` |
| 12 | `close` | fs | fd | 0 | `fs.read` |
| 13 | `read` | fs | fd, buf, len | bytes | `fs.read` |
| 14 | `write_fd` | fs | fd, buf, len | bytes | `fs.write` |
| 15 | `stat` | fs | path, out | 0 | `fs.read` |
| 16 | `spawn` | proc | entry, arg | pid | `proc.spawn` |
| 17 | `wait` | proc | pid | status | `proc.spawn` |
| 18 | `signal` | ipc | pid, sig | 0 | `ipc.signal` |
| 19 | `ipc_send` | ipc | channel, msg | 0 | `ipc.send` |
| 20 | `ipc_recv` | ipc | channel, out | bytes | `ipc.recv` |
| 21 | `agent_query` | agent | role, out | 0 | `agent.query` |
| 22 | `uptime` | time | – | millis | `time.read` |
| 23 | `sleep` | time | ms | 0 | `time.sleep` |
| 24 | `info` | proc | field | value | `proc.info` |

## Calling convention

`int 0x80` (the canonical gate, DPL 3):

| Register | Meaning |
| --- | --- |
| `rax` | syscall number (1..24) |
| `rdi`, `rsi`, `rdx`, `r10` | arguments 1..4 |
| `rax` (out) | result, or a negative errno |

`SYSCALL`/`SYSRET` is armed through MSRs `STAR`, `LSTAR` and `SFMASK` and routes
into the same dispatcher; `int 0x80` remains the documented user entry.

## Errors

Errors are negative values in `rax`; the broker raises `SyscallError` with the
same code and a human-readable reason. Every failure is audited.

| Errno | Symbol | When |
| --- | --- | --- |
| 1 | `EPERM` | mutation attempted on a read-only sandbox |
| 2 | `ENOENT` | path or pid does not exist |
| 11 | `EAGAIN` | channel empty, queue full, thread table full |
| 12 | `ENOMEM` | frame or surface budget exhausted |
| 13 | `EACCES` | path escapes the sandbox |
| 16 | `EBUSY` | resource owned elsewhere |
| 22 | `EINVAL` | argument failed validation |
| 28 | `ENOSPC` | fixed-size table full |
| 38 | `ENOSYS` | unknown call number |

## Policy (ring 3)

The broker enforces four rules before any effect happens:

1. **Confinement.** Every path is resolved and must stay under the sandbox root;
   `..` and absolute paths that escape are `EACCES`.
2. **Read-only mode.** `open(flags="w")` and `write_fd` return `EPERM` when the
   broker runs with `--read-only` (the default for shell commands that only
   inspect the tree).
3. **Budgets.** Frames (4096 × 4 KiB), surfaces (128 handles, 64 MiB total),
   IPC queues (256 messages) and read sizes (1 MiB) are all bounded. Exhaustion
   is a typed error, never an allocation failure.
4. **Capability declaration.** Every agent in `agents/manifest.json` lists the
   capabilities it uses; `orchestrator.py --check` fails if any agent asks for a
   capability the surface does not expose.

## Audit

Every call produces one record, allowed or denied:

```json
{"seq":12,"at":42.518,"call":"open","domain":"fs",
 "args":{"path":"agents/manifest.json"},"verdict":"allowed","result":3}
{"seq":13,"at":42.519,"call":"open","domain":"fs",
 "args":{"path":"../../etc/passwd"},"verdict":"denied",
 "errno":13,"error":"EACCES","reason":"path escapes the sandbox: ../../etc/passwd"}
```

Pass `--audit path.jsonl` to append to a file. Sequence numbers are strictly
increasing and are asserted by the test suite.

## Using it

```bash
python3 lumina/tools/lumina/sysd.py --list
python3 lumina/tools/lumina/sysd.py --describe            # JSON manifest
python3 lumina/tools/lumina/sysd.py --call open path=agents/manifest.json
python3 lumina/tools/lumina/sysd.py --exec "agents"       # one shell line
python3 lumina/tools/lumina/sysd.py --self-test
```

From C++, the Terminal app routes unknown commands through
`lumina/tools/lumina/sysd.py`, so a typed command in the desktop exercises the
same broker the CLI uses. From Rust, `syscall::dispatch` is the kernel half and
`syscall::self_test()` runs three real calls before the scheduler starts.

## Why so few calls

24 is enough to build a desktop and small enough to reason about:

- every call is *typed*: arguments and return shape are declared, not implied by
  a pointer cast;
- every call has exactly one owner (kernel) and one policy point (broker);
- every capability maps to a small number of calls, so an agent's declared
  capabilities are a readable summary of what it can do;
- the surface fits on one screen, which is the point — an interface you cannot
  inspect is not an interface.

Adding a call means updating the kernel table, the broker table, the manifest
capabilities, this document and the tests. `--self-test` refuses to pass
otherwise.
