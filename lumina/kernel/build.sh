#!/usr/bin/env bash
# Lumina OS — kernel build.
#
# Produces a Multiboot2 ELF that QEMU, GRUB and most bare-metal loaders accept:
#
#   qemu-system-x86_64 -kernel build/lumina-kernel.elf -m 256M -serial stdio
#
# If `grub-mkrescue` and `xorriso` are installed, a bootable ISO is produced as
# well (`build/lumina.iso`) for optical/hypervisor boots.
#
# Nothing here installs software. Missing toolchains are reported, not fixed.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$HERE/build"
TARGET=x86_64-unknown-none
ELF="$BUILD/lumina-kernel.elf"

say() { printf '%s\n' "$*"; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v cargo >/dev/null 2>&1 || {
  cat >&2 <<'EOF'
error: cargo (Rust) is not installed.

The kernel is freestanding Rust and needs a stable toolchain with the bare
metal target. Install it yourself, then re-run this script:

  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup target add x86_64-unknown-none

Verify the rest of Lumina without Rust:  make -C lumina && make -C lumina test
EOF
  exit 2
}

if ! rustup target list --installed 2>/dev/null | grep -qx "$TARGET"; then
  say "adding rust target $TARGET"
  rustup target add "$TARGET"
fi

mkdir -p "$BUILD"
say "building kernel ($TARGET)"
( cd "$HERE" && cargo build --release --target "$TARGET" --offline 2>/dev/null \
    || cargo build --release --target "$TARGET" )

ARTIFACT="$HERE/target/$TARGET/release/lumina-kernel"
[ -f "$ARTIFACT" ] || fail "cargo did not produce $ARTIFACT"

cp "$ARTIFACT" "$ELF"
if command -v llvm-objcopy >/dev/null 2>&1; then
  llvm-objcopy --strip-all "$ELF" "$ELF.tmp" && mv "$ELF.tmp" "$ELF"
fi
"${HERE}/scripts/check-image.sh" "$ELF" || true

say ""
say "kernel: $ELF"
say "size:   $(du -h "$ELF" | cut -f1)"
say ""
say "boot it:"
say "  qemu-system-x86_64 -kernel $ELF -m 256M -serial stdio"

if command -v grub-mkrescue >/dev/null 2>&1 && command -v xorriso >/dev/null 2>&1; then
  ISO_ROOT="$BUILD/iso"
  rm -rf "$ISO_ROOT"
  mkdir -p "$ISO_ROOT/boot/grub"
  cp "$ELF" "$ISO_ROOT/boot/lumina-kernel.elf"
  cat > "$ISO_ROOT/boot/grub/grub.cfg" <<'CFG'
set timeout=0
set default=0
menuentry "Lumina OS 1.0 (crystal)" {
    multiboot2 /boot/lumina-kernel.elf
    boot
}
CFG
  grub-mkrescue -o "$BUILD/lumina.iso" "$ISO_ROOT" >/dev/null 2>&1 \
    && say "iso:    $BUILD/lumina.iso"
fi
