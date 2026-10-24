// Lumina OS — minimal PNG writer (stored deflate blocks, no dependencies).
// SPDX-License-Identifier: MIT
#pragma once

#include <string>

#include "lumina/surface.hpp"

namespace lumina {
// Writes an 8-bit RGBA PNG. Returns false if the file could not be opened.
bool write_png(const Surface& surface, const std::string& path);
}  // namespace lumina
