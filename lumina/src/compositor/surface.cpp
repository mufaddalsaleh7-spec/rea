// Lumina OS — software rasteriser implementation.
// SPDX-License-Identifier: MIT
#include "lumina/surface.hpp"

#include <cmath>
#include <cstring>
#include <map>
#include <tuple>

#include "lumina/font8x8.hpp"

namespace lumina {
namespace {

inline int div255(int v) { return (v + 127) / 255; }

// Signed distance from a rounded box centred at the origin.
inline f32 sd_round_box(f32 px, f32 py, f32 half_w, f32 half_h, f32 radius) {
  const f32 qx = std::fabs(px) - half_w + radius;
  const f32 qy = std::fabs(py) - half_h + radius;
  const f32 ax = qx > 0.f ? qx : 0.f;
  const f32 ay = qy > 0.f ? qy : 0.f;
  return std::sqrt(ax * ax + ay * ay) + std::min(std::max(qx, qy), 0.f) - radius;
}

// The bitmap font is 7-bit ASCII. Fold the handful of typographic characters
// the shell uses into honest ASCII equivalents so no caller has to care.
std::string fold_utf8(const std::string& in) {
  bool plain = true;
  for (unsigned char c : in) {
    if (c >= 0x80) {
      plain = false;
      break;
    }
  }
  if (plain) return in;

  std::string out;
  out.reserve(in.size());
  for (size_t i = 0; i < in.size();) {
    const unsigned char c = static_cast<unsigned char>(in[i]);
    if (c < 0x80) {
      out += static_cast<char>(c);
      ++i;
      continue;
    }
    std::uint32_t cp = 0;
    size_t len = 0;
    if ((c & 0xE0) == 0xC0) {
      cp = c & 0x1F;
      len = 2;
    } else if ((c & 0xF0) == 0xE0) {
      cp = c & 0x0F;
      len = 3;
    } else if ((c & 0xF8) == 0xF0) {
      cp = c & 0x07;
      len = 4;
    } else {
      out += '?';
      ++i;
      continue;
    }
    if (i + len > in.size()) {
      out += '?';
      break;
    }
    for (size_t k = 1; k < len; ++k) cp = (cp << 6) | (static_cast<unsigned char>(in[i + k]) & 0x3F);
    i += len;
    switch (cp) {
      case 0x00B7: out += '|'; break;    // middle dot
      case 0x2026: out += "..."; break;  // ellipsis
      case 0x2318: out += "cmd"; break;  // command
      case 0x21E7: out += "^"; break;    // shift
      case 0x2303: out += "^"; break;    // control
      case 0x21B5: out += "ent"; break;  // return
      case 0x203A: out += '>'; break;    // chevron
      case 0x25C8: out += '*'; break;    // diamond
      case 0x2014: out += '-'; break;    // em dash
      case 0x2013: out += '-'; break;    // en dash
      case 0x201C:
      case 0x201D: out += '"'; break;
      case 0x2018:
      case 0x2019: out += '\''; break;
      case 0x00D7: out += 'x'; break;
      case 0x00A0: out += ' '; break;
      default: out += '?'; break;
    }
  }
  return out;
}

inline u8 alpha_scale(u8 a, f32 k) {
  f32 v = static_cast<f32>(a) * k;
  return static_cast<u8>(clampf(v + 0.5f, 0.f, 255.f));
}

}  // namespace

void Surface::resize(int w, int h) {
  w_ = w > 0 ? w : 0;
  h_ = h > 0 ? h : 0;
  px_.assign(static_cast<size_t>(w_) * static_cast<size_t>(h_), 0xFF000000u);
}

void Surface::clear(Color c) {
  u32 v = c.argb();
  std::fill(px_.begin(), px_.end(), v);
}

void Surface::set(int x, int y, Color c) {
  if (x < 0 || y < 0 || x >= w_ || y >= h_) return;
  px_[static_cast<size_t>(y) * w_ + x] = c.argb();
}

void Surface::blend(int x, int y, Color c) {
  if (x < 0 || y < 0 || x >= w_ || y >= h_ || c.a == 0) return;
  u32& d = px_[static_cast<size_t>(y) * w_ + x];
  if (c.a == 255) {
    d = c.argb();
    return;
  }
  const int sa = c.a;
  const int ia = 255 - sa;
  const int da = static_cast<int>((d >> 24) & 0xFF);
  const int dr = static_cast<int>((d >> 16) & 0xFF);
  const int dg = static_cast<int>((d >> 8) & 0xFF);
  const int db = static_cast<int>(d & 0xFF);
  const int r = div255(c.r * sa + dr * ia);
  const int g = div255(c.g * sa + dg * ia);
  const int b = div255(c.b * sa + db * ia);
  const int a = sa + div255(da * ia);
  d = (static_cast<u32>(a) << 24) | (static_cast<u32>(r) << 16) |
      (static_cast<u32>(g) << 8) | static_cast<u32>(b);
}

void Surface::fill(Rect r, Color c) {
  r = intersect(r, bounds());
  if (r.empty()) return;
  if (c.a != 255) {
    blend_rect(r, c);
    return;
  }
  const u32 v = c.argb();
  for (int y = r.y; y < r.bottom(); ++y) {
    u32* p = row(y);
    std::fill(p + r.x, p + r.right(), v);
  }
}

void Surface::blend_rect(Rect r, Color c) {
  r = intersect(r, bounds());
  if (r.empty() || c.a == 0) return;
  if (c.a == 255) {
    fill(r, c);
    return;
  }
  for (int y = r.y; y < r.bottom(); ++y)
    for (int x = r.x; x < r.right(); ++x) blend(x, y, c);
}

void Surface::vertical_gradient(Rect r, Color top, Color bottom) {
  r = intersect(r, bounds());
  if (r.empty()) return;
  const f32 denom = r.h > 1 ? static_cast<f32>(r.h - 1) : 1.f;
  for (int y = r.y; y < r.bottom(); ++y) {
    const Color c = mix(top, bottom, static_cast<f32>(y - r.y) / denom);
    if (c.a != 255) {
      blend_rect(Rect{r.x, y, r.w, 1}, c);
      continue;
    }
    u32* p = row(y);
    std::fill(p + r.x, p + r.right(), c.argb());
  }
}

void Surface::radial_glow(int cx, int cy, int radius, Color inner, f32 falloff) {
  if (radius <= 0) return;
  Rect r = intersect(Rect{cx - radius, cy - radius, radius * 2, radius * 2}, bounds());
  for (int y = r.y; y < r.bottom(); ++y) {
    for (int x = r.x; x < r.right(); ++x) {
      const f32 dx = static_cast<f32>(x - cx);
      const f32 dy = static_cast<f32>(y - cy);
      const f32 d = std::sqrt(dx * dx + dy * dy) / static_cast<f32>(radius);
      if (d >= 1.f) continue;
      const f32 k = std::pow(1.f - d, falloff);
      blend(x, y, inner.with_alpha(alpha_scale(inner.a, k)));
    }
  }
}

void Surface::fill_round_rect(Rect r, int radius, Color c) {
  if (r.empty() || c.a == 0) return;
  const Rect clipped = intersect(r, bounds());
  if (clipped.empty()) return;
  const f32 hw = r.w * 0.5f;
  const f32 hh = r.h * 0.5f;
  const f32 rad = static_cast<f32>(clampi(radius, 0, static_cast<int>(std::min(hw, hh))));
  const f32 ccx = r.x + hw;
  const f32 ccy = r.y + hh;
  for (int y = clipped.y; y < clipped.bottom(); ++y) {
    const f32 py = (y + 0.5f) - ccy;
    for (int x = clipped.x; x < clipped.right(); ++x) {
      const f32 px = (x + 0.5f) - ccx;
      const f32 cov = clampf(0.5f - sd_round_box(px, py, hw, hh, rad), 0.f, 1.f);
      if (cov <= 0.f) continue;
      blend(x, y, c.with_alpha(alpha_scale(c.a, cov)));
    }
  }
}

void Surface::stroke_round_rect(Rect r, int radius, Color c, int thickness) {
  if (r.empty() || c.a == 0 || thickness <= 0) return;
  const Rect clipped = intersect(r, bounds());
  if (clipped.empty()) return;
  const f32 hw = r.w * 0.5f;
  const f32 hh = r.h * 0.5f;
  const f32 rad = static_cast<f32>(clampi(radius, 0, static_cast<int>(std::min(hw, hh))));
  const f32 ccx = r.x + hw;
  const f32 ccy = r.y + hh;
  const f32 t = static_cast<f32>(thickness);
  for (int y = clipped.y; y < clipped.bottom(); ++y) {
    const f32 py = (y + 0.5f) - ccy;
    for (int x = clipped.x; x < clipped.right(); ++x) {
      const f32 px = (x + 0.5f) - ccx;
      const f32 d = sd_round_box(px, py, hw, hh, rad);
      // 1px-wide antialiased band centred on the outline.
      const f32 cov = clampf(t * 0.5f - std::fabs(d) + 0.5f, 0.f, 1.f);
      if (cov <= 0.f) continue;
      blend(x, y, c.with_alpha(alpha_scale(c.a, cov)));
    }
  }
}

void Surface::fill_circle(int cx, int cy, int radius, Color c) {
  fill_round_rect(Rect{cx - radius, cy - radius, radius * 2, radius * 2}, radius, c);
}

void Surface::blur(Rect r, int radius) {
  r = intersect(r, bounds());
  if (r.empty() || radius < 1) return;
  const int rad = std::min(radius, std::min(r.w, r.h) / 2);
  if (rad < 1) return;
  const size_t count = static_cast<size_t>(r.w) * static_cast<size_t>(r.h);
  std::vector<u32> tmp(count);
  const int win = rad * 2 + 1;

  for (int pass = 0; pass < 2; ++pass) {
    // Horizontal pass: px_ -> tmp
    for (int y = r.y; y < r.bottom(); ++y) {
      const u32* src = row(y) + r.x;
      u32* dst = tmp.data() + static_cast<size_t>(y - r.y) * r.w;
      u32 sa = 0, sr = 0, sg = 0, sb = 0;
      for (int i = -rad; i <= rad; ++i) {
        const u32 p = src[clampi(i, 0, r.w - 1)];
        sa += (p >> 24) & 0xFF;
        sr += (p >> 16) & 0xFF;
        sg += (p >> 8) & 0xFF;
        sb += p & 0xFF;
      }
      for (int x = 0; x < r.w; ++x) {
        dst[x] = ((sa / win) << 24) | ((sr / win) << 16) | ((sg / win) << 8) | (sb / win);
        const u32 add = src[clampi(x + rad + 1, 0, r.w - 1)];
        const u32 sub = src[clampi(x - rad, 0, r.w - 1)];
        sa += ((add >> 24) & 0xFF) - ((sub >> 24) & 0xFF);
        sr += ((add >> 16) & 0xFF) - ((sub >> 16) & 0xFF);
        sg += ((add >> 8) & 0xFF) - ((sub >> 8) & 0xFF);
        sb += (add & 0xFF) - (sub & 0xFF);
      }
    }
    // Vertical pass: tmp -> px_
    for (int x = r.x; x < r.right(); ++x) {
      u32 sa = 0, sr = 0, sg = 0, sb = 0;
      for (int i = -rad; i <= rad; ++i) {
        const u32 p = tmp[static_cast<size_t>(clampi(i, 0, r.h - 1)) * r.w + (x - r.x)];
        sa += (p >> 24) & 0xFF;
        sr += (p >> 16) & 0xFF;
        sg += (p >> 8) & 0xFF;
        sb += p & 0xFF;
      }
      for (int y = 0; y < r.h; ++y) {
        row(r.y + y)[x] = ((sa / win) << 24) | ((sr / win) << 16) | ((sg / win) << 8) | (sb / win);
        const u32 add = tmp[static_cast<size_t>(clampi(y + rad + 1, 0, r.h - 1)) * r.w + (x - r.x)];
        const u32 sub = tmp[static_cast<size_t>(clampi(y - rad, 0, r.h - 1)) * r.w + (x - r.x)];
        sa += ((add >> 24) & 0xFF) - ((sub >> 24) & 0xFF);
        sr += ((add >> 16) & 0xFF) - ((sub >> 16) & 0xFF);
        sg += ((add >> 8) & 0xFF) - ((sub >> 8) & 0xFF);
        sb += (add & 0xFF) - (sub & 0xFF);
      }
    }
  }
}

void Surface::dim(Rect r, f32 amount) {
  r = intersect(r, bounds());
  if (r.empty()) return;
  const Color veil = Color(0, 0, 0, alpha_scale(255, clampf(amount, 0.f, 1.f)));
  for (int y = r.y; y < r.bottom(); ++y)
    for (int x = r.x; x < r.right(); ++x) blend(x, y, veil);
}

void Surface::shadow(Rect r, int radius, Color c, int spread, int offset_y) {
  if (r.empty() || spread <= 0 || c.a == 0) return;
  using Key = std::tuple<int, int, int, int>;
  const Key key{r.w, r.h, radius, spread};
  static std::map<Key, Surface> cache;
  auto it = cache.find(key);
  if (it == cache.end()) {
    Surface mask(r.w + spread * 2, r.h + spread * 2);
    mask.clear(Color(255, 255, 255, 0));
    // Opaque core; the blur below produces the penumbra.
    for (int y = 0; y < mask.height(); ++y) {
      for (int x = 0; x < mask.width(); ++x) {
        const f32 cov = clampf(
            0.5f - sd_round_box(static_cast<f32>(x) - (spread + r.w * 0.5f),
                                static_cast<f32>(y) - (spread + r.h * 0.5f),
                                r.w * 0.5f, r.h * 0.5f,
                                static_cast<f32>(clampi(radius, 0, std::min(r.w, r.h) / 2))),
            0.f, 1.f);
        mask.set(x, y, Color(255, 255, 255, alpha_scale(255, cov)));
      }
    }
    mask.blur(mask.bounds(), std::max(2, spread / 2));
    it = cache.emplace(key, std::move(mask)).first;
  }
  const Surface& mask = it->second;
  const int ox = r.x - spread;
  const int oy = r.y - spread + offset_y;
  for (int y = 0; y < mask.height(); ++y) {
    const int ty = oy + y;
    if (ty < 0 || ty >= h_) continue;
    for (int x = 0; x < mask.width(); ++x) {
      const int tx = ox + x;
      if (tx < 0 || tx >= w_) continue;
      const u32 p = mask.data()[static_cast<size_t>(y) * mask.width() + x];
      const u8 a = static_cast<u8>((p >> 24) & 0xFF);
      if (a == 0) continue;
      blend(tx, ty, c.with_alpha(alpha_scale(c.a, a / 255.f)));
    }
  }
}

int Surface::text_width(const std::string& raw, int scale, int tracking) {
  const std::string text = fold_utf8(raw);
  int best = 0;
  int line = 0;
  const int advance = 8 * scale + tracking;
  for (char ch : text) {
    if (ch == '\n') {
      best = std::max(best, line);
      line = 0;
      continue;
    }
    line += advance;
  }
  best = std::max(best, line);
  return best > 0 ? best - tracking : 0;
}

void Surface::draw_text(int x, int y, const std::string& raw, Color c, int scale,
                        int tracking) {
  if (scale < 1) scale = 1;
  const std::string text = fold_utf8(raw);
  const int advance = 8 * scale + tracking;
  int cx = x;
  int cy = y;
  for (unsigned char ch : text) {
    if (ch == '\n') {
      cx = x;
      cy += 8 * scale + 2;
      continue;
    }
    if (ch == '\t') {
      cx += advance * 2;
      continue;
    }
    if (ch < kGlyphFirst || ch >= kGlyphFirst + kGlyphCount) {
      cx += advance;
      continue;
    }
    const std::uint8_t* glyph = kGlyphs[ch - kGlyphFirst];
    for (int gy = 0; gy < 8; ++gy) {
      const std::uint8_t bits = glyph[gy];
      if (!bits) continue;
      for (int gx = 0; gx < 8; ++gx) {
        if (!(bits & (1u << gx))) continue;
        if (scale == 1) {
          blend(cx + gx, cy + gy, c);
        } else {
          const Rect px{cx + gx * scale, cy + gy * scale, scale, scale};
          const Rect clipped = intersect(px, bounds());
          if (clipped.empty()) continue;
          for (int py = clipped.y; py < clipped.bottom(); ++py)
            for (int pxx = clipped.x; pxx < clipped.right(); ++pxx) blend(pxx, py, c);
        }
      }
    }
    cx += advance;
  }
}

void Surface::draw_text_right(int right, int y, const std::string& text, Color c, int scale,
                              int tracking) {
  draw_text(right - text_width(text, scale, tracking), y, text, c, scale, tracking);
}

void Surface::draw_text_center(Rect area, const std::string& text, Color c, int scale,
                               int tracking) {
  const int w = text_width(text, scale, tracking);
  const int h = 8 * scale;
  draw_text(area.x + (area.w - w) / 2, area.y + (area.h - h) / 2, text, c, scale, tracking);
}

void Surface::blit(const Surface& src, int dx, int dy) {
  for (int y = 0; y < src.height(); ++y) {
    const int ty = dy + y;
    if (ty < 0 || ty >= h_) continue;
    const int x0 = std::max(0, -dx);
    const int x1 = std::min(src.width(), w_ - dx);
    if (x1 <= x0) continue;
    std::memcpy(row(ty) + dx + x0, src.data() + static_cast<size_t>(y) * src.width() + x0,
                static_cast<size_t>(x1 - x0) * sizeof(u32));
  }
}

}  // namespace lumina
