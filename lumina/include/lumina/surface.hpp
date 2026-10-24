// Lumina OS — software raster surface with antialiased rounded geometry,
// frosted-glass blur and bitmap text. Shared by the compositor, the shell and
// the host simulator; the on-device build links the same translation unit.
// SPDX-License-Identifier: MIT
#pragma once

#include <string>
#include <vector>

#include "lumina/core.hpp"

namespace lumina {

class Surface {
 public:
  Surface() = default;
  Surface(int w, int h) { resize(w, h); }

  void resize(int w, int h);
  int width() const { return w_; }
  int height() const { return h_; }
  Rect bounds() const { return Rect{0, 0, w_, h_}; }
  bool valid() const { return w_ > 0 && h_ > 0; }

  u32* data() { return px_.data(); }
  const u32* data() const { return px_.data(); }
  u32* row(int y) { return px_.data() + static_cast<size_t>(y) * w_; }
  const u32* row(int y) const { return px_.data() + static_cast<size_t>(y) * w_; }

  void clear(Color c);
  void set(int x, int y, Color c);
  void blend(int x, int y, Color c);

  void fill(Rect r, Color c);        // opaque replace (ignores alpha)
  void blend_rect(Rect r, Color c);  // source-over
  void vertical_gradient(Rect r, Color top, Color bottom);
  void radial_glow(int cx, int cy, int radius, Color inner, f32 falloff = 2.0f);

  void fill_round_rect(Rect r, int radius, Color c);
  void stroke_round_rect(Rect r, int radius, Color c, int thickness = 1);
  void fill_circle(int cx, int cy, int radius, Color c);
  void shadow(Rect r, int radius, Color c, int spread, int offset_y = 0);
  void blur(Rect r, int radius);
  void dim(Rect r, f32 amount);

  void draw_text(int x, int y, const std::string& text, Color c, int scale = 2,
                 int tracking = 0);
  void draw_text_right(int right, int y, const std::string& text, Color c, int scale = 2,
                       int tracking = 0);
  void draw_text_center(Rect area, const std::string& text, Color c, int scale = 2,
                        int tracking = 0);
  static int text_width(const std::string& text, int scale = 2, int tracking = 0);
  static int line_height(int scale = 2) { return 8 * scale; }

  void blit(const Surface& src, int dx, int dy);

 private:
  int w_{0};
  int h_{0};
  std::vector<u32> px_;
};

}  // namespace lumina
