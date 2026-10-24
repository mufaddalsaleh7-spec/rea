# Lumina OS — architecture

Lumina is an operating system built in three languages with strict ownership
between them. The layering is the product: each layer can be replaced, tested
and built on its own.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Apps        Files · Terminal · Notes · Settings · Monitor · About   │  C++17
│              Build Studio                                            │
├──────────────────────────────────────────────────────────────────────┤
│  Shell       menubar · dock · control centre · spotlight · spaces    │  C++17
├──────────────────────────────────────────────────────────────────────┤
│  Compositor  Surface raster · Window/z-order · focus · motion        │  C++17
├──────────────────────────────────────────────────────────────────────┤
│  Host        clock · input transport · /proc probe · preview server  │  C++17
├──────────────────────────────────────────────────────────────────────┤
│  Syscalls    24 typed calls · policy · audit · capability table      │  Python + Rust
├──────────────────────────────────────────────────────────────────────┤
│  Kernel      boot · long mode · frames · heap · scheduler · IRQs     │  Rust + asm
└──────────────────────────────────────────────────────────────────────┘
```

## Layers and their contracts

### 1. Kernel (Rust + assembly) — `kernel/`

| Module | Owns | Key invariant |
| --- | --- | --- |
| `boot.rs` | 32→64-bit transition, page tables, GDT, stack | Identity-maps 1 GiB with 2 MiB pages before any Rust runs |
| `gdt.rs` | descriptors, TSS, ring-0 stack | A ring-3 interrupt always finds a valid privileged stack |
| `idt.rs` | 256 vectors, one common trampoline, dispatch | Every path returns a frame; nothing returns "by accident" |
| `pic.rs` | PIC remap to 32..47, PIT at 100 Hz | Exception vectors and IRQ vectors never overlap |
| `mem.rs` | bitmap frame allocator, first-fit heap | Never hands out the kernel image or firmware-reserved RAM |
| `sched.rs` | round-robin, one frame representation | A new thread and a preempted thread resume through the same `iretq` |
| `fb.rs` | framebuffer console, boot screen, panic screen | Pixels are written only inside `width × height` |
| `syscall.rs` | the 24-call table and `int 0x80` gate | Unknown numbers return `ENOSYS` and are counted |
| `agent.rs` | the compiled pipeline manifest | The running system can name the agent that built each layer |

### 2. Compositor (C++) — `src/compositor/`

- `surface.cpp` — the rasteriser: antialiased rounded rectangles from a signed
  distance field, strokes, gradients, cached shadow masks, separable box blur
  for frosted glass, alpha compositing, and the bitmap font renderer.
  `fill()` is alpha-correct: translucent fills route through `blend_rect`, so a
  veil never blanks the screen.
- `compositor.cpp` — window lifetime (`Window`), z-order, focus, hit-testing
  (titlebar, traffic lights, resize edges), drag with magnetic edges, zoom,
  minimise, and the open/close animations. Apps implement `Application`; the
  compositor decides *when* and *where* they draw.
- `theme.cpp` — design tokens, five accents, light/dark. Changing appearance
  preserves accent, motion and glass preferences.

### 3. Shell (C++) — `src/shell/`

- `shell.cpp` — menubar, dock with proximity magnification, control centre,
  spotlight, three workspaces, boot sequence, cursor. It implements
  `SettingsSink`, `MetricsSource` and `TerminalBackend`, which is how the apps
  reach the outside world without knowing about the OS.
- `apps.cpp` — the seven first-party apps. Each one is a pure `Application`:
  `draw(Surface&, Rect, Theme&)` plus input callbacks. No app touches pixels
  outside its content rectangle.

### 4. Host runtime (C++) — `host/`

The host is the device: it supplies the clock, machine telemetry from `/proc`,
the input transport and a zero-dependency PNG writer. Two modes:

- `--scenario tour` renders deterministic stills (used for docs and review).
- `--scenario serve` streams raw RGBA frames to a browser canvas and accepts
  pointer/keyboard events, so the real shell can be driven live.

### 5. Syscalls (Python + Rust) — `tools/lumina/sysd.py`, `kernel/src/syscall.rs`

`SYS_TABLE` in the kernel and `SYSCALLS` in the broker must agree. That is not a
convention: `sysd.py --self-test` parses the Rust source and fails if the two
lists diverge. See [syscalls.md](syscalls.md).

## Boot sequence

```
loader ──▶ _start (32-bit) ──▶ build PML4/PDPT/PD ──▶ PAE + LME ──▶ far jump
                                                                    │
        ┌───────────────────────────────────────────────────────────┘
        ▼
   kmain: serial → GDT/TSS → IDT → PIC/PIT → memory map → heap
          → framebuffer claim + boot screen → syscall gate + self-test
          → 3 kernel threads → scheduler start
```

The C++ desktop receives the framebuffer through the same `Surface` abstraction
the host build uses, which is why the shell code is identical in both
environments.

## Data flow for one click

```
browser/QEMU input
      │  /input?type=down&x=..&y=..
      ▼
Shell::pointer_down ──▶ overlay? (spotlight/control centre/menu)
      │ no
      ▼
Compositor::pointer_down ──▶ hit-test zone
      │                            │ chrome      → move/close/zoom
      ▼ content                    │
Window::app()->on_pointer ──▶ app state change
      │
      ▼
Compositor::render ──▶ draw_desktop ──▶ paint_window(app->draw) ──▶ blit_rounded
```

## Determinism and testing

- Rendering is a pure function of state: no wall-clock reads inside the shell
  (the clock string is injected), no RNG, no unordered iteration.
- `tests/test_core.cpp` renders a scene twice and compares a 64-bit hash of the
  framebuffer, so a stray change to the rasteriser is caught.
- The still tour always walks the same input script, so screenshots are
  reproducible on any machine that has a C++17 compiler.
