# Beyond the Mac

Lumina is not a theme, a skin or a clone with different colours. It is an answer
to a design question: *if the calm, spatial, keyboard-friendly desktop the Mac
popularised were rebuilt today by an open pipeline, what would change?*

## What we keep

| Quality | How Lumina keeps it |
| --- | --- |
| A menubar that belongs to the focused app | `Shell::draw_menubar` reads `focused_window()->spec().title`; menus are per-context |
| A dock that feels physical | proximity magnification on a Gaussian falloff, running dots, tooltips |
| Windows that explain themselves | 240 ms spring open, 170 ms fade close, magnetic top edge |
| Depth without noise | one soft shadow token, one accent hairline for focus |
| Keyboard-first flow | spotlight, workspaces, per-window close, `Esc` dismisses overlays |
| Typography you can read at a glance | 16 px body, three text tiers, integer-scaled font |
| Settings that do what they say | every control writes a token and is visible on screen immediately |

## What we change

### 1. The build is part of the product
Nine agents, one manifest, one command. `lumctl.py build` walks the same file
that documents ownership:

```
kernel-architect → graphics-engineer → compositor-engineer → shell-designer
   → syscall-architect → app-builder → qa-engineer → security-reviewer
   → release-manager
```

Each agent declares the layer it owns, the outputs it produces and the syscall
capabilities it may use. `--check` fails if any of that is untrue. A closed
system cannot offer this, and it is the single biggest difference.

### 2. Twenty-four syscalls you can read in a minute
The Mac's surface is large, undocumented in places and changes between releases.
Lumina's is 24 calls, typed, with a broker that audits each one and a
cross-language test that keeps the Rust and Python halves identical.

### 3. One source of design truth
`theme.hpp` is the only place a colour is chosen. Five accents, two appearances,
one motion scale. That is why light mode, dark mode and every accent combination
stay consistent without per-app work.

### 4. Motion is a token, not a flourish
`Theme::motion` shortens every animation in the system at once. Accessibility is
a property of the design system, not a checkbox bolted onto three widgets.

### 5. Honest artifacts
A still tour, a determinism test and a live stream are all first-class:

```bash
./build/lumina --scenario tour   # deterministic PNG stills
make test                        # 134 checks, incl. framebuffer hash
./build/lumina --scenario serve  # drive the real shell in a browser
```

## What we deliberately do not do

- **No proprietary assets.** No system sounds, icons, wallpapers or typefaces are
  reproduced. Icons are drawn from primitives; the font is public domain.
- **No retro-fitting.** Lumina does not claim to run Mac applications or read Mac
  disks. It is a new system with a familiar spatial grammar.
- **No overclaiming.** `docs/kernel.md` states exactly which lanes were executed
  when this release was assembled.

## A comparison, honestly

| Dimension | Classic Mac desktop | Lumina 1.0 |
| --- | --- | --- |
| Desktop model | windows, menubar, dock | windows, menubar, dock, 3 workspaces |
| Appearance system | light/dark + accent | light/dark + 5 accents + motion + glass tokens |
| App surface | private frameworks | `Application` interface: one draw, three input hooks |
| Syscall surface | large, partly closed | 24 typed calls, broker, audit, capability table |
| Build | closed | 9 agents, manifest, reproducible commands |
| Verification | not user-visible | C++ suite, broker invariants, manifest check, determinism hash |
| Kernel | XNU | freestanding Rust kernel, 12 modules |
| Status | shipping for years | 1.0 preview, Linux/QEMU hosted today |

The last row is the important one. Lumina is a real, working desktop with a real
kernel source tree and a real pipeline — and a documented path from "runs in
QEMU and in a browser" to "runs on your laptop".
