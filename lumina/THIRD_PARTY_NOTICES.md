# Third-party notices — Lumina OS

Lumina ships no runtime third-party libraries. The desktop runtime links only
the C++ standard library and libpthread; the kernel is freestanding Rust with no
crates. What follows is the complete list of borrowed *assets* and build-time
tools.

## Embedded assets

### font8x8 — 8x8 bitmap font
- Source: `font8x8_basic.h`, part of Daniel Hepper's `font8x8` project
  (<https://github.com/dhepper/font8x8>).
- Upstream provenance: derived from the public-domain IBM/Marcel Sondaar VGA
  8x8 font.
- License: **public domain**.
- Used in: `include/lumina/font8x8.hpp` (C++) and `kernel/src/font.rs` (Rust),
  both generated from the same public-domain table.
- Modifications: reformatted into C++/Rust tables; characters are addressed from
  `0x20` to `0x7F` only.

Everything else — icons, wordmark, window chrome, wallpaper — is drawn from
primitives in `src/compositor/surface.cpp` and `src/shell/apps.cpp`. There are no
image files in the runtime.

## Build-time tools (not shipped)

| Tool | Role | License |
| --- | --- | --- |
| GCC / libstdc++ | compiles the C++ runtime | GPLv3 + GCC Runtime Library Exception |
| Rust + cargo | compiles the freestanding kernel | MIT / Apache-2.0 (toolchain) |
| QEMU | boots the kernel image | GPLv2 |
| GRUB + xorriso | optional bootable ISO | GPLv3 / GPLv2 |

## Python

`tools/lumina/*.py` and `agents/*.py` use the standard library only. No packages
are installed or vendored.

## Colour and type

Design tokens in `src/compositor/theme.cpp` are original. The palette is derived
by hand from the Lumina aurora concept; it does not reproduce any other
product's assets, icons, sounds or typography.
