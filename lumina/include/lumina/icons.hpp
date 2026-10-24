// Lumina OS — vector icon set shared by the dock, menubar and window chrome.
// Drawn from primitives so there are no image assets to ship or theme.
// SPDX-License-Identifier: MIT
#pragma once

#include "lumina/compositor.hpp"

namespace lumina {

// Draws a themed app icon inside `r` (square, 20px+). `accent` fills the tile.
void draw_icon(Surface& s, Rect r, WindowKind kind, Color accent, const Theme& theme);

}  // namespace lumina
