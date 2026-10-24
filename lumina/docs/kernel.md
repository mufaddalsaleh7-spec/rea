# Lumina — the kernel

A freestanding x86_64 kernel: no `std`, no `alloc`, no external crates. It boots
through Multiboot2, builds its own page tables, claims the framebuffer, starts a
100 Hz timer, runs a preemptive scheduler and exposes the 24-call gate.

## Requirements

- A stable Rust toolchain with the bare-metal target:
  `rustup target add x86_64-unknown-none`
- `qemu-system-x86_64` to boot it (optional)
- `grub-mkrescue` + `xorriso` for an ISO (optional)

The build script reports a missing toolchain and exits 2; it never installs
anything.

## Build and boot

```bash
bash lumina/kernel/build.sh                # → lumina/kernel/build/lumina-kernel.elf
qemu-system-x86_64 \
  -kernel lumina/kernel/build/lumina-kernel.elf \
  -m 256M -serial stdio
```

Expected serial output:

```
LUMINA OS 1.0 (crystal) — x86_64 kernel
------------------------------------------
[ ok ] multiboot2 handoff accepted
[ ok ] gdt + tss loaded
[ ok ] idt installed (exceptions, irqs, int 0x80)
[ ok ] pic remapped, pit armed at 100 Hz
[ok] memory: physical frames ready
[ok] heap: first-fit free list ready
[ok] framebuffer: linear 32bpp surface claimed
[ ok ] syscall gate armed (int 0x80, DPL 3)
[ ok ] syscall self-test: dispatch, info and ENOSYS paths
[ ok ] scheduler online (round robin, 100 Hz quantum)
[thread] agent-orchestrator
...
```

The `agent-orchestrator` kernel thread walks the compiled pipeline table and
logs which agent owns which layer, so the boot log is also a provenance record.

## Module map

| File | Responsibility |
| --- | --- |
| `src/boot.rs` | Multiboot2 header (framebuffer request 1280×800×32), 32-bit entry, PML4/PDPT/PD with 512 × 2 MiB pages, PAE + LME, 64-bit GDT, far jump, stack |
| `src/main.rs` | `kmain`, tag walker, boot ordering, panic handler, `itoa` without allocation |
| `src/gdt.rs` | 6 descriptors including the TSS, 16 KiB ring-0 stack, 8 KiB IST stack for double faults |
| `src/idt.rs` | 256 entries, per-vector stubs, one common trampoline, `InterruptFrame`, fatal-exception reporting with CR2 |
| `src/pic.rs` | 8259 remap to vectors 32..47, PIT programming, EOI |
| `src/mem.rs` | bitmap frame allocator over the firmware map + first-fit heap behind `GlobalAlloc` |
| `src/sched.rs` | task table, synthetic boot frame, timer preemption, `resume_frame` trampoline |
| `src/fb.rs` | framebuffer console, boot splash, pipeline panel, status strip, panic screen |
| `src/syscall.rs` | 24-call table, `int 0x80` + `SYSCALL` wiring, dispatch, self-test |
| `src/agent.rs` | the nine pipeline roles compiled into the image |
| `src/serial.rs`, `src/print.rs` | COM1 logging and allocation-free formatting |
| `src/font.rs` | the embedded 8x8 glyph table (public domain) |

## Design decisions

**One interrupt-frame representation.** Every thread is a saved
`InterruptFrame`. A new thread starts from a synthetic frame whose `rip` is its
entry function, so starting a thread and resuming a preempted one use the same
`iretq` path. There is no second bootstrap context format to get subtly wrong.

**Identity map, then hand off.** The first gigabyte is identity-mapped with
2 MiB pages before any Rust runs. That keeps `kmain` boring: every pointer the
loader gave us is simply valid.

**Allocation failures are typed.** `alloc_frame()` returns `Option`; the syscall
layer turns `None` into `ENOMEM`. The heap's `alloc` returns null and the caller
decides.

**The kernel has no knowledge of the desktop.** It provides surfaces and a
present path; the C++ compositor owns every pixel of the shell. That boundary is
why the same shell runs in QEMU and in a browser canvas.

## Verification status

| Lane | How it is verified |
| --- | --- |
| Boot to long mode, GDT/TSS, IDT | Code review + serial log assertions in `docs/kernel.md` |
| Memory map / frame allocator | Unit-testable logic reviewed; `SYS_INFO` exposes free frames at runtime |
| Scheduler preemption | Three threads started at boot; counters readable through `SYS_INFO` |
| Syscall table | Cross-language parity test (`sysd.py --self-test`) parses this source |
| Image sanity | `scripts/check-image.sh` checks ELF entry point and the Multiboot2 header |
| Full QEMU boot | **Not run in this environment** — no Rust toolchain was available when it was written |

That last row is a fact, not a footnote: the kernel compiles from source with no
dependencies, but its boot was not executed here. The C++ desktop, the broker,
the pipeline and the tests below the kernel boundary are all executed on every
`lumctl.py verify`.
