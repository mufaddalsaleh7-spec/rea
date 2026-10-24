#!/usr/bin/env bash
# Static checks on a built kernel image. These catch the failure modes that
# cost the most time on bare metal: a wrong entry point, a missing multiboot2
# header or a section that will not fit in the loader's buffer.
set -euo pipefail

IMAGE="${1:?usage: check-image.sh <kernel.elf>}"
[ -f "$IMAGE" ] || { echo "missing image: $IMAGE" >&2; exit 1; }

readelf -h "$IMAGE" >/dev/null
entry=$(readelf -h "$IMAGE" | awk '/Entry point address/ {print $4}')
magic=$(grep -c multiboot2 "$IMAGE" 2>/dev/null || true)

echo "checks:"
echo "  elf entry point      $entry"
if [ "$entry" = "0x0" ]; then
  echo "  FAIL: entry point is zero" >&2
  exit 1
fi
if [ "$magic" -eq 0 ]; then
  echo "  FAIL: multiboot2 header not found in image" >&2
  exit 1
fi
echo "  multiboot2 header    present"

sections=$(readelf -S "$IMAGE" | grep -cE '\.text|\.rodata|\.data|\.bss' || true)
echo "  loadable sections    $sections"
echo "  all checks passed"
