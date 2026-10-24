// Lumina OS — theme tokens.
// SPDX-License-Identifier: MIT
#include "lumina/theme.hpp"

namespace lumina {
namespace {
struct Accent {
  Color base;
  Color glow;
};
constexpr Accent kAccents[] = {
    {Color::rgb(0x4C8DFF), Color(0x3B, 0x6F, 0xF6, 120)},  // Aurora blue
    {Color::rgb(0xA46BFF), Color(0x9B, 0x5C, 0xF6, 120)},  // Orchid
    {Color::rgb(0x2ED3A8), Color(0x22, 0xC7, 0xA9, 120)},  // Mint
    {Color::rgb(0xF5B23C), Color(0xF5, 0xB2, 0x3C, 120)},  // Amber
    {Color::rgb(0xFF6F6A), Color(0xFF, 0x6F, 0x6A, 120)},  // Coral
};
constexpr int kAccentCount = static_cast<int>(sizeof(kAccents) / sizeof(kAccents[0]));
}  // namespace

Theme Theme::dark_theme() {
  Theme t;
  t.name = "Solstice Dark";
  t.dark = true;
  t.desktop_top = Color::rgb(0x0B1020);
  t.desktop_bottom = Color::rgb(0x151C31);
  t.aura_a = Color::rgb(0x3B6FF6);
  t.aura_b = Color::rgb(0x9B5CF6);
  t.aura_c = Color::rgb(0x22C7A9);
  t.text = Color::rgb(0xF2F5FF);
  t.text_dim = Color::rgb(0xA8B2CC);
  t.text_faint = Color::rgb(0x6C7690);
  t.panel = Color(18, 21, 32, 176);
  t.panel_border = Color(255, 255, 255, 40);
  t.panel_strong = Color(24, 28, 42, 236);
  t.window_bg = Color::rgb(0x161A26);
  t.window_border = Color(255, 255, 255, 30);
  t.titlebar = Color(255, 255, 255, 12);
  t.sidebar = Color(255, 255, 255, 10);
  t.hairline = Color(255, 255, 255, 26);
  t.shadow = Color(0, 0, 0, 160);
  t.selection = Color(0x4C, 0x8D, 0xFF, 46);
  return t;
}

Theme Theme::light_theme() {
  Theme t;
  t.name = "Aurora Light";
  t.dark = false;
  t.desktop_top = Color::rgb(0xDCE6FA);
  t.desktop_bottom = Color::rgb(0xF3F6FE);
  t.aura_a = Color::rgb(0x6FA0FF);
  t.aura_b = Color::rgb(0xC39BFF);
  t.aura_c = Color::rgb(0x63E0C4);
  t.text = Color::rgb(0x131720);
  t.text_dim = Color::rgb(0x525B70);
  t.text_faint = Color::rgb(0x8A93A8);
  t.panel = Color(252, 253, 255, 190);
  t.panel_border = Color(20, 26, 40, 34);
  t.panel_strong = Color(255, 255, 255, 242);
  t.window_bg = Color::rgb(0xFBFCFE);
  t.window_border = Color(20, 26, 40, 40);
  t.titlebar = Color(20, 26, 40, 10);
  t.sidebar = Color(20, 26, 40, 12);
  t.hairline = Color(20, 26, 40, 30);
  t.shadow = Color(18, 26, 48, 70);
  t.selection = Color(0x4C, 0x8D, 0xFF, 38);
  return t;
}

void Theme::set_appearance(bool is_dark) {
  const int keep_accent = accent_index_;
  const f32 keep_motion = motion;
  const bool keep_glass = glass;
  *this = is_dark ? dark_theme() : light_theme();
  motion = keep_motion;
  glass = keep_glass;
  set_accent_index(keep_accent);
}

void Theme::set_accent_index(int index) {
  accent_index_ = ((index % kAccentCount) + kAccentCount) % kAccentCount;
  const Accent& a = kAccents[accent_index_];
  accent = a.base;
  accent_soft = a.glow;
  aura_a = a.base;
  aura_b = mix(a.base, Color::rgb(0xB07BFF), 0.55f);
  selection = a.base.with_alpha(dark ? 60 : 44);
  zoom = Color::rgb(0x28C840);
}

int accent_count() { return kAccentCount; }

}  // namespace lumina
