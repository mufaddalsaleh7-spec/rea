// Lumina OS — core primitives (userland, host-buildable).
// SPDX-License-Identifier: MIT
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <string>

namespace lumina {

using u8 = std::uint8_t;
using u16 = std::uint16_t;
using u32 = std::uint32_t;
using u64 = std::uint64_t;
using i32 = std::int32_t;
using f32 = float;

// ---------------------------------------------------------------------------
// Color: 8-bit straight-alpha RGBA. Framebuffer words are 0xAARRGGBB.
// ---------------------------------------------------------------------------
struct Color {
  u8 r{0}, g{0}, b{0}, a{255};

  constexpr Color() = default;
  constexpr Color(u8 rr, u8 gg, u8 bb, u8 aa = 255) : r(rr), g(gg), b(bb), a(aa) {}

  static constexpr Color rgb(u32 v, u8 alpha = 255) {
    return Color(static_cast<u8>((v >> 16) & 0xFF), static_cast<u8>((v >> 8) & 0xFF),
                 static_cast<u8>(v & 0xFF), alpha);
  }
  static constexpr Color from_argb(u32 v) {
    return Color(static_cast<u8>((v >> 16) & 0xFF), static_cast<u8>((v >> 8) & 0xFF),
                 static_cast<u8>(v & 0xFF), static_cast<u8>((v >> 24) & 0xFF));
  }
  constexpr Color with_alpha(u8 alpha) const { return Color(r, g, b, alpha); }
  constexpr u32 argb() const {
    return (static_cast<u32>(a) << 24) | (static_cast<u32>(r) << 16) |
           (static_cast<u32>(g) << 8) | static_cast<u32>(b);
  }
  constexpr bool opaque() const { return a == 255; }
};

inline Color mix(Color x, Color y, f32 t) {
  t = t < 0.f ? 0.f : (t > 1.f ? 1.f : t);
  auto c = [t](u8 lo, u8 hi) { return static_cast<u8>(lo + (hi - lo) * t + 0.5f); };
  return Color(c(x.r, y.r), c(x.g, y.g), c(x.b, y.b), c(x.a, y.a));
}

inline f32 clampf(f32 v, f32 lo, f32 hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline f32 lerpf(f32 a, f32 b, f32 t) { return a + (b - a) * t; }
inline int clampi(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline int iround(f32 v) { return static_cast<int>(v >= 0.f ? v + 0.5f : v - 0.5f); }

// Motion curves used by the shell. All are cheap and stateless so the
// compositor can predict frames without keeping animation history.
inline f32 ease_out_cubic(f32 t) { t = clampf(t, 0.f, 1.f); f32 u = 1.f - t; return 1.f - u * u * u; }
inline f32 ease_in_out_cubic(f32 t) {
  t = clampf(t, 0.f, 1.f);
  return t < 0.5f ? 4.f * t * t * t : 1.f - std::pow(-2.f * t + 2.f, 3.f) * 0.5f;
}
inline f32 ease_out_back(f32 t) {
  t = clampf(t, 0.f, 1.f);
  constexpr f32 c1 = 1.70158f, c3 = c1 + 1.f;
  f32 u = t - 1.f;
  return 1.f + c3 * u * u * u + c1 * u * u;
}
// Critically damped spring, normalised to 0..1 for a unit step.
inline f32 spring(f32 t, f32 stiffness = 9.f) {
  t = clampf(t, 0.f, 1.f);
  return 1.f - std::exp(-stiffness * t) * std::cos(t * stiffness * 1.6f);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
struct Point {
  int x{0}, y{0};
};

struct Rect {
  int x{0}, y{0}, w{0}, h{0};

  constexpr int left() const { return x; }
  constexpr int top() const { return y; }
  constexpr int right() const { return x + w; }
  constexpr int bottom() const { return y + h; }
  constexpr int cx() const { return x + w / 2; }
  constexpr int cy() const { return y + h / 2; }
  constexpr bool empty() const { return w <= 0 || h <= 0; }
  constexpr bool contains(int px, int py) const {
    return px >= x && py >= y && px < x + w && py < y + h;
  }
  constexpr bool contains(Point p) const { return contains(p.x, p.y); }
  constexpr Rect inset(int d) const { return Rect{x + d, y + d, w - 2 * d, h - 2 * d}; }
  constexpr Rect offset(int dx, int dy) const { return Rect{x + dx, y + dy, w, h}; }
  constexpr Rect with_height(int nh) const { return Rect{x, y, w, nh}; }
  constexpr bool operator==(const Rect& o) const {
    return x == o.x && y == o.y && w == o.w && h == o.h;
  }
  constexpr bool operator!=(const Rect& o) const { return !(*this == o); }
};

constexpr Rect intersect(Rect a, Rect b) {
  int l = a.x > b.x ? a.x : b.x;
  int t = a.y > b.y ? a.y : b.y;
  int r = a.right() < b.right() ? a.right() : b.right();
  int bt = a.bottom() < b.bottom() ? a.bottom() : b.bottom();
  return Rect{l, t, r - l > 0 ? r - l : 0, bt - t > 0 ? bt - t : 0};
}

constexpr Rect unite(Rect a, Rect b) {
  if (a.empty()) return b;
  if (b.empty()) return a;
  int l = a.x < b.x ? a.x : b.x;
  int t = a.y < b.y ? a.y : b.y;
  int r = a.right() > b.right() ? a.right() : b.right();
  int bt = a.bottom() > b.bottom() ? a.bottom() : b.bottom();
  return Rect{l, t, r - l, bt - t};
}

}  // namespace lumina
