// Lumina OS — design tokens. One source of truth for both the compositor and
// the shell; themes are data, never hard-coded colours at call sites.
// SPDX-License-Identifier: MIT
#pragma once

#include <string>

#include "lumina/core.hpp"

namespace lumina {

struct Theme {
  std::string name{"Solstice Dark"};
  bool dark{true};
  f32 motion{1.0f};  // 0 = reduce motion (accessibility)
  bool glass{true};  // frosted panels on/off

  // Chrome
  Color desktop_top{Color::rgb(0x0B1020)};
  Color desktop_bottom{Color::rgb(0x131A2E)};
  Color aura_a{Color::rgb(0x3B6FF6)};
  Color aura_b{Color::rgb(0x9B5CF6)};
  Color aura_c{Color::rgb(0x22C7A9)};

  Color text{Color::rgb(0xF2F5FF)};
  Color text_dim{Color::rgb(0xA8B2CC)};
  Color text_faint{Color::rgb(0x6C7690)};

  Color panel{Color(18, 21, 32, 176)};
  Color panel_border{Color(255, 255, 255, 38)};
  Color panel_strong{Color(24, 28, 42, 235)};

  Color window_bg{Color::rgb(0x171A24)};
  Color window_border{Color(255, 255, 255, 28)};
  Color titlebar{Color(255, 255, 255, 12)};
  Color sidebar{Color(255, 255, 255, 10)};
  Color hairline{Color(255, 255, 255, 26)};
  Color shadow{Color(0, 0, 0, 150)};

  Color accent{Color::rgb(0x4C8DFF)};
  Color accent_soft{Color(0x4C, 0x8D, 0xFF, 60)};
  Color selection{Color(0x4C, 0x8D, 0xFF, 46)};

  Color close{Color::rgb(0xFF5F57)};
  Color minimize{Color::rgb(0xFEBC2E)};
  Color zoom{Color::rgb(0x28C840)};

  Color success{Color::rgb(0x38D39F)};
  Color warning{Color::rgb(0xFFC24B)};
  Color danger{Color::rgb(0xFF6B6B)};

  static Theme dark_theme();
  static Theme light_theme();
  void set_appearance(bool is_dark);
  // 0 = Aurora blue, 1 = Orchid, 2 = Mint, 3 = Amber, 4 = Coral
  void set_accent_index(int index);
  int accent_index() const { return accent_index_; }

 private:
  int accent_index_{0};
};

// Number of built-in accent colours (Aurora, Orchid, Mint, Amber, Coral).
int accent_count();

}  // namespace lumina
