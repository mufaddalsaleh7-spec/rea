// Lumina OS — first-party applications: Files, Terminal, Notes, Settings,
// Monitor, About and Build Studio.
// SPDX-License-Identifier: MIT
#include "lumina/apps.hpp"

#include "lumina/icons.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <sstream>

namespace lumina {
namespace {

constexpr int kRowH = 40;
constexpr int kPad = 16;

std::string fmt_bytes(std::uint64_t bytes) {
  char buf[32];
  if (bytes >= 1024ull * 1024ull * 1024ull)
    std::snprintf(buf, sizeof buf, "%.1f GB", bytes / (1024.0 * 1024.0 * 1024.0));
  else if (bytes >= 1024ull * 1024ull)
    std::snprintf(buf, sizeof buf, "%.1f MB", bytes / (1024.0 * 1024.0));
  else if (bytes >= 1024ull)
    std::snprintf(buf, sizeof buf, "%.1f KB", bytes / 1024.0);
  else
    std::snprintf(buf, sizeof buf, "%llu B", static_cast<unsigned long long>(bytes));
  return buf;
}

std::string fmt_uptime(double seconds) {
  const int s = static_cast<int>(seconds);
  char buf[32];
  std::snprintf(buf, sizeof buf, "%02dh %02dm %02ds", s / 3600, (s / 60) % 60, s % 60);
  return buf;
}

std::string fmt_num(double v, int decimals = 1) {
  char buf[32];
  std::snprintf(buf, sizeof buf, "%.*f", decimals, v);
  return buf;
}

void hline(Surface& s, int x, int y, int w, Color c) { s.fill(Rect{x, y, w, 1}, c); }

void draw_pill(Surface& s, Rect r, const std::string& label, Color bg, Color fg) {
  s.fill_round_rect(r, r.h / 2, bg);
  s.draw_text_center(r, label, fg, 1);
}

// Vector icons keep the shell free of image assets and scale with any DPI.
}  // namespace

void draw_icon(Surface& s, Rect r, WindowKind kind, Color accent, const Theme& th) {
  s.fill_round_rect(r, r.w / 4, accent);
  const Color ink(255, 255, 255, 235);
  const int cx = r.cx();
  const int cy = r.cy();
  const int u = std::max(2, r.w / 10);
  switch (kind) {
    case WindowKind::Files: {
      const Rect body{r.x + u, cy - u / 2, r.w - 2 * u, r.h / 2 - u / 2};
      s.fill_round_rect(body, 2, ink);
      s.fill_round_rect(Rect{r.x + u, cy - u * 2, r.w / 2 - u / 2, u}, 2, ink);
      break;
    }
    case WindowKind::Terminal: {
      s.fill_round_rect(Rect{cx - u, cy - u, 2, 2}, 1, ink);
      for (int i = 0; i < u; ++i) s.fill(Rect{cx - u + i, cy - u + i, 2, 2}, ink);
      for (int i = 0; i < u; ++i) s.fill(Rect{cx - u + i, cy + u - i - 2, 2, 2}, ink);
      s.fill(Rect{cx, cy + u - 2, u + 1, 2}, ink);
      break;
    }
    case WindowKind::Notes: {
      s.fill_round_rect(Rect{r.x + u, r.y + u, r.w - 2 * u, r.h - 2 * u}, 2,
                        Color(255, 255, 255, 120));
      for (int i = 0; i < 3; ++i)
        s.fill(Rect{r.x + u + 3, r.y + u + 4 + i * (u + 1), r.w - 2 * u - 6, 2}, ink);
      break;
    }
    case WindowKind::Settings: {
      s.fill_circle(cx, cy, u + 1, ink);
      s.fill_circle(cx, cy, u - 2, accent);
      for (int i = 0; i < 8; ++i) {
        const f32 a = static_cast<f32>(i) * 3.14159265f / 4.f;
        const int tx = cx + static_cast<int>(std::cos(a) * (u + 2));
        const int ty = cy + static_cast<int>(std::sin(a) * (u + 2));
        s.fill(Rect{tx - 1, ty - 1, 3, 3}, ink);
      }
      break;
    }
    case WindowKind::Monitor: {
      s.stroke_round_rect(Rect{r.x + u, cy - u, r.w - 2 * u, u * 2}, 2, ink, 1);
      int px = r.x + u + 2;
      int py = cy + u / 3;
      const int steps[4] = {-2, 3, -3, 2};
      for (int i = 0; i < 4; ++i) {
        const int nx = px + 3;
        const int ny = py + steps[i];
        const int y0 = std::min(py, ny);
        for (int x = px; x < nx; ++x) {
          const int t = (x - px) * 2;
          const int yy = py + (y0 == py ? (ny - py) * t / 6 : (py - ny) * t / 6);
          s.fill(Rect{x, yy, 2, 2}, ink);
        }
        px = nx;
        py = ny;
      }
      break;
    }
    case WindowKind::About: {
      s.stroke_round_rect(Rect{cx - u, cy - u, u * 2, u * 2}, u * 2, ink, 2);
      s.fill(Rect{cx - 1, cy - u / 3, 2, 2}, ink);
      s.fill(Rect{cx - 1, cy, 2, u}, ink);
      break;
    }
    case WindowKind::Studio: {
      const int widths[3] = {3, 5, 7};
      for (int i = 0; i < 3; ++i) {
        const int h = 2 + widths[i];
        s.fill_round_rect(Rect{r.x + u + i * (u + 1), cy + u - h, u - 1, h}, 1, ink);
      }
      break;
    }
  }
  (void)th;
}

namespace {

void draw_sparkline(Surface& s, Rect r, const std::vector<float>& values, Color c) {
  if (values.size() < 2 || r.w < 4) return;
  const int n = static_cast<int>(values.size());
  int prev_y = r.bottom() - static_cast<int>(clampf(values[0], 0.f, 1.f) * r.h);
  for (int i = 1; i < n; ++i) {
    const int x = r.x + i * r.w / (n - 1);
    const int y = r.bottom() - static_cast<int>(clampf(values[i], 0.f, 1.f) * r.h);
    const int y0 = std::min(prev_y, y);
    const int y1 = std::max(prev_y, y);
    s.fill(Rect{x, y0, 2, std::max(2, y1 - y0)}, c);
    prev_y = y;
  }
}

void metric_card(Surface& s, Rect r, const std::string& label, const std::string& value,
                 const std::string& unit, Color accent, const std::vector<float>& history,
                 const Theme& th) {
  s.fill_round_rect(r, 12, th.panel_border.with_alpha(16));
  s.draw_text(r.x + 14, r.y + 12, label, th.text_faint, 1);
  s.draw_text(r.x + 14, r.y + 28, value, th.text, 3);
  s.draw_text(r.x + 16 + Surface::text_width(value, 3), r.y + 46, unit, th.text_dim, 1);
  if (!history.empty()) {
    Rect plot{r.x + 12, r.y + r.h - 34, r.w - 24, 22};
    s.fill_round_rect(Rect{plot.x, plot.y + 20, plot.w, 2}, 1, th.hairline);
    draw_sparkline(s, plot, history, accent.with_alpha(220));
  }
}

std::string trim_number(double v) { return fmt_num(v, 1); }

}  // namespace

// ===========================================================================
// Files
// ===========================================================================
FilesApp::FilesApp() {
  root_.name = "Home";
  root_.is_dir = true;
  auto dir = [](const std::string& name) {
    Node n;
    n.name = name;
    n.is_dir = true;
    n.kind = "Folder";
    return n;
  };
  auto file = [](const std::string& name, const std::string& kind, std::uint64_t bytes) {
    Node n;
    n.name = name;
    n.kind = kind;
    n.bytes = bytes;
    return n;
  };

  Node documents = dir("Documents");
  documents.children = {file("Roadmap.md", "Markdown", 4300),
                        file("Architecture.md", "Markdown", 12200),
                        file("Release-Notes.md", "Markdown", 6800),
                        dir("press")};
  documents.children.back().children = {file("launch-kit.md", "Markdown", 3400),
                                        file("screenshots", "Folder", 0)};

  Node projects = dir("Projects");
  projects.children = {dir("lumina-os"), dir("agent-pipeline"), dir("syscalls")};
  projects.children[0].children = {file("compositor.cpp", "C++ source", 21400),
                                   file("surface.cpp", "C++ source", 18900),
                                   file("apps.cpp", "C++ source", 26800)};
  projects.children[1].children = {file("manifest.json", "JSON", 2100),
                                   file("orchestrator.py", "Python", 8600)};
  projects.children[2].children = {file("sysd.py", "Python", 24800),
                                   file("test_sysd.py", "Python", 15200)};

  Node media = dir("Media");
  media.children = {dir("wallpapers"), dir("screenshots")};

  root_.children = {documents,        projects, media, file("build.log", "Log", 131072),
                    file("install.sh", "Shell script", 3174), file("README.md", "Markdown", 2900)};
  std::sort(root_.children.begin(), root_.children.end(),
            [](const Node& a, const Node& b) { return a.is_dir > b.is_dir; });
  stack_.push_back(&root_);
}

std::vector<const FilesApp::Node*> FilesApp::current_entries() const {
  std::vector<const Node*> out;
  if (stack_.empty()) return out;
  for (const Node& n : stack_.back()->children) out.push_back(&n);
  return out;
}

std::string FilesApp::status() const {
  const auto entries = current_entries();
  return std::to_string(entries.size()) + " items";
}

void FilesApp::open_selected() {
  const auto entries = current_entries();
  if (selected_ < 0 || selected_ >= static_cast<int>(entries.size())) return;
  const Node* n = entries[static_cast<size_t>(selected_)];
  if (!n->is_dir) return;
  stack_.push_back(n);
  selected_ = 0;
  scroll_ = 0;
}

void FilesApp::on_pointer(Point p, InputEvent::Type type, int, Rect content) {
  if (type != InputEvent::Type::PointerDown) return;
  const Point lp{p.x - content.x, p.y - content.y};
  const int sidebar_w = 186;
  if (lp.x < sidebar_w) {
    sidebar_index_ = clampi((lp.y - 56) / 44, 0, 3);
    if (sidebar_index_ == 0) {
      stack_.clear();
      stack_.push_back(&root_);
      selected_ = 0;
    }
    return;
  }
  const int list_top = 78;
  const int idx = (lp.y - list_top) / kRowH + scroll_;
  const auto entries = current_entries();
  if (lp.y >= list_top && idx >= 0 && idx < static_cast<int>(entries.size())) {
    if (selected_ == idx) {
      open_selected();
    } else {
      selected_ = idx;
    }
  }
}

void FilesApp::on_key(const std::string& key, Rect) {
  const auto entries = current_entries();
  if (key == "Up") selected_ = std::max(0, selected_ - 1);
  if (key == "Down")
    selected_ = std::min(static_cast<int>(entries.size()) - 1, selected_ + 1);
  if (key == "Enter" || key == "Right") open_selected();
  if (key == "Backspace" || key == "Left") {
    if (stack_.size() > 1) {
      stack_.pop_back();
      selected_ = 0;
    }
  }
}

void FilesApp::on_scroll(Point, int delta, Rect) {
  const int count = static_cast<int>(current_entries().size());
  const int visible = 8;
  scroll_ = clampi(scroll_ - delta, 0, std::max(0, count - visible));
}

void FilesApp::draw(Surface& s, Rect content, const Theme& th) {
  const int sidebar_w = 186;
  s.fill(content, th.window_bg);
  s.fill(Rect{content.x, content.y, sidebar_w, content.h}, th.sidebar);

  // Sidebar: favourites and locations.
  s.draw_text(content.x + 16, content.y + 16, "FAVOURITES", th.text_faint, 1);
  const char* favs[4] = {"Home", "Documents", "Projects", "Media"};
  for (int i = 0; i < 4; ++i) {
    const Rect row{content.x + 8, content.y + 34 + i * 44, sidebar_w - 16, 36};
    if (i == sidebar_index_) s.fill_round_rect(row, 8, th.selection);
    s.fill_round_rect(Rect{row.x + 10, row.y + 12, 12, 12}, 3,
                      i == sidebar_index_ ? th.accent : th.text_faint);
    s.draw_text(row.x + 32, row.y + 10, favs[i],
                i == sidebar_index_ ? th.text : th.text_dim, 2);
  }
  s.draw_text(content.x + 16, content.y + 240, "LOCATIONS", th.text_faint, 1);
  s.fill_round_rect(Rect{content.x + 18, content.y + 262, 12, 12}, 3, th.success);
  s.draw_text(content.x + 40, content.y + 260, "Lumina (ro)", th.text_dim, 1);
  s.fill_round_rect(Rect{content.x + 18, content.y + 288, 12, 12}, 3, th.warning);
  s.draw_text(content.x + 40, content.y + 286, "Studio SSD", th.text_dim, 1);

  s.draw_text(content.x + 16, content.bottom() - 26, "LUMINA FS", th.text_faint, 1);

  // Breadcrumb + search.
  std::string path = "Home";
  for (size_t i = 1; i < stack_.size(); ++i) path += " / " + stack_[i]->name;
  s.draw_text(content.x + sidebar_w + kPad, content.y + 16, path, th.text, 2);
  const Rect search{content.right() - 176, content.y + 12, 160, 24};
  s.fill_round_rect(search, 12, th.panel_border.with_alpha(18));
  s.draw_text(search.x + 12, search.y + 4, "Search", th.text_faint, 1);
  hline(s, content.x + sidebar_w, content.y + 46, content.w - sidebar_w, th.hairline);

  // Column header.
  s.draw_text(content.x + sidebar_w + 64, content.y + 58, "NAME", th.text_faint, 1);
  s.draw_text(content.right() - 170, content.y + 58, "KIND", th.text_faint, 1);
  s.draw_text_right(content.right() - 16, content.y + 58, "SIZE", th.text_faint, 1);

  const auto entries = current_entries();
  const int top = 78;
  const int max_rows = (content.h - top - 30) / kRowH;
  for (int i = 0; i < max_rows; ++i) {
    const int idx = i + scroll_;
    if (idx >= static_cast<int>(entries.size())) break;
    const Node* n = entries[static_cast<size_t>(idx)];
    const Rect row{content.x + sidebar_w + 8, content.y + top + i * kRowH, content.w - sidebar_w - 16,
                   kRowH - 4};
    if (idx == selected_) {
      s.fill_round_rect(row, 8, th.selection);
      s.fill_round_rect(Rect{row.x, row.y + 6, 3, row.h - 12}, 1, th.accent);
    }
    const Rect tile{row.x + 10, row.y + 5, 26, 26};
    const Color tint = n->is_dir ? th.accent : mix(th.text_faint, th.window_bg, 0.15f);
    s.fill_round_rect(tile, 7, tint.with_alpha(n->is_dir ? 235 : 110));
    if (n->is_dir) {
      s.fill_round_rect(Rect{tile.x + 6, tile.y + 9, 14, 10}, 2, Color(255, 255, 255, 230));
      s.fill_round_rect(Rect{tile.x + 6, tile.y + 6, 7, 4}, 2, Color(255, 255, 255, 230));
    } else {
      s.draw_text(tile.x + 9, tile.y + 9, "F", Color(255, 255, 255, 210), 1);
    }
    s.draw_text(row.x + 46, row.y + 12, n->name, th.text, 2);
    s.draw_text(content.right() - 170, row.y + 15, n->kind, th.text_faint, 1);
    if (!n->is_dir) s.draw_text_right(content.right() - 16, row.y + 15, fmt_bytes(n->bytes),
                                      th.text_dim, 1);
    else
      s.draw_text_right(content.right() - 16, row.y + 15, "--", th.text_faint, 1);
  }

  // Status strip.
  hline(s, content.x + sidebar_w, content.bottom() - 26, content.w - sidebar_w, th.hairline);
  s.draw_text(content.x + sidebar_w + kPad, content.bottom() - 20,
              std::to_string(entries.size()) + " items  ·  double click to open",
              th.text_faint, 1);
}

// ===========================================================================
// Terminal
// ===========================================================================
TerminalApp::TerminalApp(TerminalBackend* backend) : backend_(backend) {}

std::string TerminalApp::status() const { return std::to_string(commands_) + " cmds"; }

void TerminalApp::print(const std::string& text, Color color) {
  scrollback_.push_back({text, color});
  if (scrollback_.size() > 800) scrollback_.erase(scrollback_.begin(), scrollback_.begin() + 200);
}

void TerminalApp::submit() {
  const std::string line = input_;
  print(backend_ ? backend_->prompt() + " ~ % " + line : "lumina ~ % " + line, Color(0x8F, 0xB4, 0xFF));
  if (!line.empty()) history_.push_back(line);
  history_pos_ = -1;
  input_.clear();
  scroll_offset_ = 0;
  if (!backend_) {
    print("no syscall broker attached", Color(0xFF, 0x6B, 0x6B));
    return;
  }
  TerminalResult r = backend_->execute(line);
  if (r.clear_screen) scrollback_.clear();
  for (const std::string& l : r.lines) print(l, Color(0xC9, 0xD4, 0xEA));
  ++commands_;
}

void TerminalApp::on_key(const std::string& key, Rect) {
  if (key == "Enter") {
    submit();
  } else if (key == "Backspace") {
    if (!input_.empty()) input_.pop_back();
  } else if (key == "Up") {
    if (history_.empty()) return;
    history_pos_ = history_pos_ < 0 ? static_cast<int>(history_.size()) - 1
                                    : std::max(0, history_pos_ - 1);
    input_ = history_[static_cast<size_t>(history_pos_)];
  } else if (key == "Down") {
    if (history_pos_ < 0) return;
    history_pos_ = std::min(static_cast<int>(history_.size()), history_pos_ + 1);
    input_ = history_pos_ >= static_cast<int>(history_.size())
                ? std::string()
                : history_[static_cast<size_t>(history_pos_)];
  } else if (key == "Tab") {
    input_ += "  ";
  } else if (key.size() == 1) {
    input_ += key;
  }
}

void TerminalApp::on_scroll(Point, int delta, Rect content) {
  const int lines = (content.h - 60) / 20;
  const int max_off = std::max(0, static_cast<int>(scrollback_.size()) - lines);
  scroll_offset_ = clampi(scroll_offset_ + delta * 2, 0, max_off);
}

void TerminalApp::draw(Surface& s, Rect content, const Theme& th) {
  const Color bg = th.dark ? Color::rgb(0x0A0D14) : Color::rgb(0xF7F9FD);
  s.fill(content, bg);
  s.vertical_gradient(Rect{content.x, content.y, content.w, 28},
                      th.accent.with_alpha(28), th.accent.with_alpha(0));

  if (!booted_) {
    booted_ = true;
    print("LUMINA OS 1.0  ·  crystal shell", th.accent);
    print("C++ compositor · Rust kernel · Python syscall broker", th.text_dim);
    print("type 'help' for the syscall surface", th.text_faint);
    print("", th.text_faint);
  }

  const int chrome = 30;
  s.draw_text(content.x + 14, content.y + 8, "lumina-shell", th.text_faint, 1);
  s.draw_text_right(content.right() - 14, content.y + 8, "ring-3 · sandboxed", th.text_faint, 1);
  hline(s, content.x, content.y + chrome, content.w, th.hairline);

  const int line_h = 20;
  const int input_y = content.bottom() - 30;
  const int visible = (input_y - (content.y + chrome) - 8) / line_h;
  const int first = std::max(0, static_cast<int>(scrollback_.size()) - visible - scroll_offset_);
  const size_t wrap = static_cast<size_t>(std::max(8, (content.w - 28) / 16));
  int y = content.y + chrome + 8;
  for (int i = first; i < static_cast<int>(scrollback_.size()) && y < input_y - 6; ++i) {
    const Line& line = scrollback_[static_cast<size_t>(i)];
    for (size_t off = 0; off < line.text.size() || off == 0; off += wrap) {
      if (y >= input_y - 6) break;
      s.draw_text(content.x + 14, y, line.text.substr(off, wrap), line.color, 2);
      y += line_h;
    }
  }

  hline(s, content.x, input_y - 6, content.w, th.hairline);
  const std::string prompt = (backend_ ? backend_->prompt() : "lumina") + " ~ % ";
  s.draw_text(content.x + 14, input_y + 4, prompt, th.success, 2);
  const int px = content.x + 14 + Surface::text_width(prompt, 2);
  s.draw_text(px, input_y + 4, input_, th.text, 2);
  // Caret: two-state blink driven by frame count.
  if ((++blink_ / 20) % 2 == 0)
    s.fill(Rect{px + Surface::text_width(input_, 2) + 1, input_y + 2, 2, 18}, th.accent);
}

// ===========================================================================
// Notes
// ===========================================================================
NotesApp::NotesApp() {
  notes_.push_back({"Launch checklist",
                    "Ship Lumina 1.0 preview.\n\n"
                    "- compositor: glass, motion, z-order\n"
                    "- kernel: boot to ring 3, framebuffer handoff\n"
                    "- syscalls: broker + 24 calls\n"
                    "- agents: nine roles, one manifest\n",
                    "12m ago"});
  notes_.push_back({"Why Lumina",
                    "macOS is a landmark. Lumina keeps what makes it feel human\n"
                    "- calm surfaces, honest motion, deep app integration\n"
                    "and replaces what holds it back.\n\n"
                    "1. open agent pipeline instead of a closed build\n"
                    "2. verifiable syscall surface\n"
                    "3. one design token file for every surface\n",
                    "1h ago"});
  notes_.push_back({"Interview: design tokens",
                    "theme.hpp is the single source of truth. Apps never pick raw\n"
                    "colours; they ask the theme. That is how light, dark and\n"
                    "five accents stay consistent without per-app work.\n",
                    "yesterday"});
}

std::string NotesApp::status() const { return editing_ ? "editing" : "saved"; }

void NotesApp::on_pointer(Point p, InputEvent::Type type, int, Rect content) {
  if (type != InputEvent::Type::PointerDown) return;
  const Point lp{p.x - content.x, p.y - content.y};
  const int sidebar_w = 200;
  if (lp.x < sidebar_w) {
    const int idx = (lp.y - 56) / 68;
    if (idx >= 0 && idx < static_cast<int>(notes_.size())) {
      current_ = idx;
      editing_ = false;
    }
    return;
  }
  editing_ = true;
}

void NotesApp::on_key(const std::string& key, Rect) {
  if (notes_.empty()) return;
  Note& n = notes_[static_cast<size_t>(current_)];
  if (key == "Enter") {
    n.body += "\n";
  } else if (key == "Backspace") {
    if (!n.body.empty()) n.body.pop_back();
  } else if (key == "Tab") {
    n.body += "  ";
  } else if (key.size() == 1) {
    n.body += key;
  }
  editing_ = true;
  n.updated = "now";
}

void NotesApp::draw(Surface& s, Rect content, const Theme& th) {
  const int sidebar_w = 200;
  s.fill(content, th.window_bg);
  s.fill(Rect{content.x, content.y, sidebar_w, content.h}, th.sidebar);
  s.draw_text(content.x + 16, content.y + 16, "NOTES", th.text_faint, 1);
  s.fill_round_rect(Rect{content.right() - sidebar_w + 16, content.y + 14, 24, 24}, 12,
                    th.accent_soft);
  s.draw_text(content.right() - sidebar_w + 23, content.y + 18, "+", th.accent, 2);

  for (size_t i = 0; i < notes_.size(); ++i) {
    const Rect row{content.x + 8, content.y + 48 + static_cast<int>(i) * 68, sidebar_w - 16, 60};
    if (static_cast<int>(i) == current_) s.fill_round_rect(row, 10, th.selection);
    std::string title = notes_[i].title;
    if (title.size() > 12) title = title.substr(0, 11) + "…";
    s.draw_text(row.x + 10, row.y + 8, title, th.text, 2);
    std::string preview = notes_[i].body.substr(0, 20);
    std::replace(preview.begin(), preview.end(), '\n', ' ');
    while (!preview.empty() && preview.back() == ' ') preview.pop_back();
    s.draw_text(row.x + 10, row.y + 30, preview, th.text_faint, 1);
    s.draw_text(row.x + 10, row.y + 44, notes_[i].updated, th.text_faint, 1);
  }

  if (notes_.empty()) return;
  const Note& n = notes_[static_cast<size_t>(current_)];
  const int main_x = content.x + sidebar_w + 22;
  s.draw_text(main_x, content.y + 22, n.title, th.text, 2);
  s.draw_text(main_x, content.y + 46, n.updated + "  ·  " + std::to_string(n.body.size()) +
                                           " characters  ·  markdown",
              th.text_faint, 1);
  hline(s, content.x + sidebar_w, content.y + 68, content.w - sidebar_w, th.hairline);

  int y = content.y + 84;
  std::stringstream ss(n.body);
  std::string line;
  const int max_y = content.bottom() - 20;
  const size_t wrap = static_cast<size_t>(std::max(12, (content.right() - main_x - 20) / 16));
  while (std::getline(ss, line) && y < max_y) {
    const Color ink = line.rfind("-", 0) == 0 || line.rfind("1.", 0) == 0 ? th.text_dim : th.text;
    for (size_t off = 0; off < line.size() || off == 0; off += wrap) {
      if (y >= max_y) break;
      s.draw_text(main_x, y, line.substr(off, wrap), ink, 2);
      y += 22;
    }
  }
  if (editing_ && ((content.x + frames_marker_) / 18) % 2 == 0) {
    // Cursor sits after the last line.
    s.fill(Rect{main_x, std::min(y, max_y - 18), 2, 16}, th.accent);
  }
  ++frames_marker_;
}

// ===========================================================================
// Settings
// ===========================================================================
namespace {
constexpr int kSettingsRow = 58;
Rect settings_row(Rect content, int index) {
  return Rect{content.x + 24, content.y + 76 + index * kSettingsRow, content.w - 48, 48};
}
}  // namespace

SettingsApp::SettingsApp(SettingsSink* sink) : sink_(sink) {}

void SettingsApp::on_pointer(Point p, InputEvent::Type type, int, Rect content) {
  if (type != InputEvent::Type::PointerDown || !sink_) return;
  const Point lp{p.x - content.x, p.y - content.y};
  if (lp.y < 76) return;
  const int row = (lp.y - 76) / kSettingsRow;
  selected_row_ = row;
  if (row == 0) {
    sink_->set_dark(!theme_cache_dark_);
    theme_cache_dark_ = !theme_cache_dark_;
  } else if (row == 1) {
    const int swatch_x = lp.x - (content.w - 236);
    int idx = swatch_x / 40;
    if (swatch_x >= 0 && idx >= 0 && idx < accent_count()) sink_->set_accent(idx);
  } else if (row == 2) {
    sink_->set_motion(motion_on_ ? 0.f : 1.f);
    motion_on_ = !motion_on_;
  } else if (row == 3) {
    sink_->set_glass(!glass_on_);
    glass_on_ = !glass_on_;
  } else if (row == 4) {
    sink_->open_app(WindowKind::Monitor);
  } else if (row == 5) {
    sink_->open_app(WindowKind::Studio);
  }
}

void SettingsApp::draw(Surface& s, Rect content, const Theme& th) {
  theme_cache_dark_ = th.dark;
  motion_on_ = th.motion > 0.f;
  glass_on_ = th.glass;
  s.fill(content, th.window_bg);
  s.draw_text(content.x + 24, content.y + 18, "System Settings", th.text, 3);
  s.draw_text_right(content.right() - 24, content.y + 24, "Lumina 1.0 · " + th.name,
                    th.text_faint, 1);
  hline(s, content.x, content.y + 60, content.w, th.hairline);

  auto row_bg = [&](int i) {
    const Rect r = settings_row(content, i);
    s.fill_round_rect(r, 10, i == selected_row_ ? th.selection : th.panel_border.with_alpha(12));
    return r;
  };

  {
    const Rect r = row_bg(0);
    s.draw_text(r.x + 16, r.y + 16, "Appearance", th.text, 2);
    const Rect seg{r.right() - 152, r.y + 10, 140, 28};
    s.fill_round_rect(seg, 14, th.panel_strong.with_alpha(120));
    const Rect on = th.dark ? Rect{seg.x + 2, seg.y + 2, 68, 24}
                            : Rect{seg.x + 70, seg.y + 2, 68, 24};
    s.fill_round_rect(on, 12, th.accent);
    s.draw_text_center(Rect{seg.x + 2, seg.y + 2, 68, 24}, "Dark", th.dark ? th.text : th.text_dim, 1);
    s.draw_text_center(Rect{seg.x + 70, seg.y + 2, 68, 24}, "Light", th.dark ? th.text_dim : th.text, 1);
  }
  {
    const Rect r = row_bg(1);
    s.draw_text(r.x + 16, r.y + 16, "Accent", th.text, 2);
    for (int i = 0; i < accent_count(); ++i) {
      Theme probe = th;
      probe.set_accent_index(i);
      const int cx = r.right() - 226 + i * 40;
      s.fill_circle(cx + 14, r.cy(), 13, probe.accent);
      if (i == th.accent_index()) s.stroke_round_rect(Rect{cx + 1, r.cy() - 13, 26, 26}, 13, th.text, 2);
    }
  }
  {
    const Rect r = row_bg(2);
    s.draw_text(r.x + 16, r.y + 16, "Motion", th.text, 2);
    s.draw_text(r.x + 140, r.y + 18, motion_on_ ? "Full motion" : "Reduced motion",
                th.text_faint, 1);
    const Rect track{r.right() - 64, r.y + 14, 48, 20};
    s.fill_round_rect(track, 10, motion_on_ ? th.accent : th.panel_border);
    s.fill_circle(motion_on_ ? track.right() - 10 : track.x + 10, track.cy(), 8,
                  Color(255, 255, 255, 240));
  }
  {
    const Rect r = row_bg(3);
    s.draw_text(r.x + 16, r.y + 16, "Glass & blur", th.text, 2);
    s.draw_text(r.x + 160, r.y + 18, glass_on_ ? "Crystal" : "Flat", th.text_faint, 1);
    const Rect track{r.right() - 64, r.y + 14, 48, 20};
    s.fill_round_rect(track, 10, glass_on_ ? th.accent : th.panel_border);
    s.fill_circle(glass_on_ ? track.right() - 10 : track.x + 10, track.cy(), 8,
                  Color(255, 255, 255, 240));
  }
  {
    const Rect r = row_bg(4);
    s.draw_text(r.x + 16, r.y + 16, "Performance monitor", th.text, 2);
    s.draw_text_right(r.right() - 16, r.y + 18, "open  ›", th.accent, 1);
  }
  {
    const Rect r = row_bg(5);
    s.draw_text(r.x + 16, r.y + 16, "Build Studio", th.text, 2);
    s.draw_text_right(r.right() - 16, r.y + 18, "open  ›", th.accent, 1);
  }

  s.draw_text(content.x + 24, content.bottom() - 30,
              "Lumina is built from C++ (surface), Rust (kernel) and Python (syscalls).",
              th.text_faint, 1);
}

// ===========================================================================
// Monitor
// ===========================================================================
MonitorApp::MonitorApp(const MetricsSource* source) : source_(source) {}

std::string MonitorApp::status() const { return source_ ? "live" : "offline"; }

void MonitorApp::draw(Surface& s, Rect content, const Theme& th) {
  s.fill(content, th.window_bg);
  const Metrics m = source_ ? source_->metrics() : Metrics{};
  s.draw_text(content.x + 20, content.y + 16, "Performance", th.text, 3);
  s.draw_text_right(content.right() - 20, content.y + 24, "sampled live", th.text_faint, 1);
  hline(s, content.x, content.y + 50, content.w, th.hairline);

  const int gap = 14;
  const int card_w = (content.w - 40 - gap) / 2;
  const int card_h = 122;
  const int x0 = content.x + 20;
  const int y0 = content.y + 64;

  std::vector<float> frames = m.frame_history;
  std::vector<float> synthetic_cpu;
  for (size_t i = 0; i < frames.size(); ++i)
    synthetic_cpu.push_back(clampf(0.25f + 0.45f * std::sin(static_cast<float>(i) * 0.4f) +
                                       0.15f * frames[i],
                                   0.f, 1.f));

  metric_card(s, Rect{x0, y0, card_w, card_h}, "FRAME RATE", fmt_num(m.fps, 0), "fps", th.accent,
              frames, th);
  metric_card(s, Rect{x0 + card_w + gap, y0, card_w, card_h}, "FRAME TIME",
              fmt_num(m.frame_ms, 1), "ms", th.success, frames, th);
  metric_card(s, Rect{x0, y0 + card_h + gap, card_w, card_h}, "CPU", fmt_num(m.cpu_percent, 0),
              "%", th.warning, synthetic_cpu, th);
  metric_card(s, Rect{x0 + card_w + gap, y0 + card_h + gap, card_w, card_h}, "MEMORY",
              fmt_num(m.memory_mb, 0), "MB", th.danger, synthetic_cpu, th);

  const int stats_y = y0 + 2 * card_h + gap * 2 + 12;
  auto stat = [&](int col, const std::string& label, const std::string& value) {
    const int x = x0 + col * ((card_w + gap) / 2 + 8);
    s.draw_text(x, stats_y, label, th.text_faint, 1);
    s.draw_text(x, stats_y + 14, value, th.text_dim, 2);
  };
  stat(0, "WINDOWS", std::to_string(m.windows));
  stat(1, "UPTIME", fmt_uptime(m.uptime_s));
  stat(2, "SYSCALLS", std::to_string(m.syscalls));
  stat(3, "FRAMES", std::to_string(m.frames));

  const int bar_y = stats_y + 48;
  const f32 load = static_cast<f32>(clampf(m.cpu_percent / 100.0, 0.0, 1.0));
  s.fill_round_rect(Rect{x0, bar_y, content.w - 40, 10}, 5, th.panel_border.with_alpha(30));
  s.fill_round_rect(Rect{x0, bar_y, static_cast<int>((content.w - 40) * load), 10}, 5,
                    th.accent);
  s.draw_text(x0, bar_y + 18, "compositor load", th.text_faint, 1);
}

// ===========================================================================
// About
// ===========================================================================
AboutApp::AboutApp(const MetricsSource* source) : source_(source) {}

void AboutApp::draw(Surface& s, Rect content, const Theme& th) {
  s.fill(content, th.window_bg);
  s.vertical_gradient(Rect{content.x, content.y, content.w, content.h},
                      th.accent.with_alpha(22), th.window_bg);
  const int cx = content.x + content.w / 2;
  int y = content.y + 28;

  for (int i = 3; i >= 1; --i)
    s.fill_circle(cx, y + 34, 26 + i * 5, th.accent.with_alpha(static_cast<u8>(16 + i * 10)));
  s.fill_circle(cx, y + 34, 26, th.accent);
  s.fill_circle(cx, y + 34, 18, th.window_bg);
  s.fill_circle(cx, y + 34, 9, th.accent.with_alpha(200));
  y += 78;

  const std::string title = "Lumina OS";
  s.draw_text(cx - Surface::text_width(title, 4) / 2, y, title, th.text, 4);
  y += 40;
  const std::string tag = "Beyond the Mac";
  s.draw_text(cx - Surface::text_width(tag, 2) / 2, y, tag, th.accent, 2);
  y += 30;
  const std::string ver = "1.0.0 (crystal)  ·  x86_64  ·  build local";
  s.draw_text(cx - Surface::text_width(ver, 1) / 2, y, ver, th.text_faint, 1);
  y += 26;

  const char* bullets[3] = {
      "Open agent pipeline — every layer is rebuilt by a named agent",
      "Verifiable syscalls — 24 typed calls, broker-audited",
      "One design token file — light, dark and 5 accents, zero drift",
  };
  for (int i = 0; i < 3; ++i) {
    const Rect card{content.x + 28, y, content.w - 56, 30};
    s.fill_round_rect(card, 8, th.panel_border.with_alpha(14));
    s.fill_circle(card.x + 14, card.cy(), 4, th.success);
    s.draw_text(card.x + 26, card.y + 8, bullets[i], th.text_dim, 1);
    y += 36;
  }

  y += 4;
  const char* chips[3] = {"C++17 compositor", "Rust kernel", "Python syscalls"};
  int x = content.x + 28;
  for (int i = 0; i < 3; ++i) {
    const int w = Surface::text_width(chips[i], 1) + 20;
    draw_pill(s, Rect{x, y, w, 22}, chips[i], th.accent.with_alpha(40), th.accent);
    x += w + 8;
  }

  if (source_) {
    const Metrics m = source_->metrics();
    s.draw_text(content.x + 28, content.bottom() - 24,
                "uptime " + fmt_uptime(m.uptime_s) + "  ·  " + std::to_string(m.frames) +
                    " frames rendered  ·  " + trim_number(m.frame_ms) + " ms/frame",
                th.text_faint, 1);
  }
}

// ===========================================================================
// Build Studio
// ===========================================================================
StudioApp::StudioApp() {
  // Mirrors agents/manifest.json field for field: the app renders the same
  // pipeline the orchestrator runs, so the desktop and the build cannot drift.
  stages_ = {
      {"Kernel", "kernel-architect", "Rust + asm", "kernel",
       "boots to long mode, owns frames, heap and scheduler", "ready", 1.f},
      {"Graphics", "graphics-engineer", "Rust", "kernel",
       "claims the framebuffer, draws the boot console", "ready", 1.f},
      {"Compositor", "compositor-engineer", "C++17", "compositor",
       "surface raster, z-order, focus, glass, motion", "ready", 1.f},
      {"Shell", "shell-designer", "C++17", "lumina-host",
       "menubar, dock, control centre, spotlight, workspaces", "ready", 1.f},
      {"Syscalls", "syscall-architect", "Python + Rust", "syscalls",
       "24 typed calls, policy, audit trail", "ready", 1.f},
      {"Apps", "app-builder", "C++17", "compositor",
       "files, terminal, notes, settings, monitor, studio", "ready", 1.f},
      {"Quality", "qa-engineer", "Python", "syscalls",
       "unit suites, determinism hash, CI gate", "ready", 1.f},
      {"Security", "security-reviewer", "Python", "lumina-host",
       "threat model, capability review, least privilege", "ready", 1.f},
      {"Release", "release-manager", "Python", "lumina-host",
       "versioning, artifacts, docs, changelog", "ready", 1.f},
  };
}

std::string StudioApp::status() const {
  return std::to_string(stages_.size()) + " stages";
}

void StudioApp::on_pointer(Point p, InputEvent::Type type, int, Rect content) {
  if (type != InputEvent::Type::PointerDown) return;
  const Point lp{p.x - content.x, p.y - content.y};
  const int idx = (lp.y - 70) / 56;
  if (lp.x < 320 && idx >= 0 && idx < static_cast<int>(stages_.size())) selected_ = idx;
}

void StudioApp::draw(Surface& s, Rect content, const Theme& th) {
  s.fill(content, th.window_bg);
  s.draw_text(content.x + 20, content.y + 14, "Build Studio", th.text, 3);
  s.draw_text_right(content.right() - 20, content.y + 22, "lumina build --release",
                    th.text_faint, 1);
  hline(s, content.x, content.y + 48, content.w, th.hairline);

  const int left_w = 268;
  const int row_h = 46;
  for (size_t i = 0; i < stages_.size(); ++i) {
    const Rect row{content.x + 10, content.y + 56 + static_cast<int>(i) * row_h, left_w - 20,
                   row_h - 4};
    if (static_cast<int>(i) == selected_) s.fill_round_rect(row, 10, th.selection);
    s.fill_circle(row.x + 20, row.cy(), 4, th.success);
    s.draw_text(row.x + 34, row.y + 7, stages_[i].name, th.text, 2);
    s.draw_text(row.x + 34, row.y + 25, stages_[i].language, th.text_faint, 1);
    s.fill_round_rect(Rect{row.right() - 44, row.y + 13, 36, 14}, 7,
                      th.success.with_alpha(38));
    s.draw_text_center(Rect{row.right() - 44, row.y + 15, 36, 12}, stages_[i].status,
                       th.success, 1);
  }

  const Rect panel{content.x + left_w + 10, content.y + 56, content.w - left_w - 30,
                   content.h - 100};
  s.fill_round_rect(panel, 12, th.panel_border.with_alpha(14));
  if (selected_ < static_cast<int>(stages_.size())) {
    const Stage& st = stages_[static_cast<size_t>(selected_)];
    s.draw_text(panel.x + 18, panel.y + 16, st.name, th.text, 3);
    s.draw_text(panel.x + 18, panel.y + 44, st.agent, th.accent, 2);
    draw_pill(s, Rect{panel.x + 18, panel.y + 66, 130, 22}, st.language,
              th.accent.with_alpha(46), th.accent);
    draw_pill(s, Rect{panel.x + 156, panel.y + 66, 110, 22}, st.target,
              th.panel_border.with_alpha(30), th.text_dim);

    s.draw_text(panel.x + 18, panel.y + 104, "OWNS", th.text_faint, 1);
    const size_t wrap = static_cast<size_t>(std::max(20, (panel.w - 36) / 8));
    int y = panel.y + 118;
    for (size_t off = 0; off < st.detail.size(); off += wrap) {
      s.draw_text(panel.x + 18, y, st.detail.substr(off, wrap), th.text_dim, 1);
      y += 14;
    }

    s.draw_text(panel.x + 18, y + 12, "STAGE", th.text_faint, 1);
    s.fill_round_rect(Rect{panel.x + 18, y + 28, panel.w - 36, 8}, 4,
                      th.panel_border.with_alpha(40));
    s.fill_round_rect(
        Rect{panel.x + 18, y + 28, static_cast<int>((panel.w - 36) * st.progress), 8}, 4,
        th.success);

    s.draw_text(panel.x + 18, y + 50, "COMMAND", th.text_faint, 1);
    s.draw_text(panel.x + 18, y + 64, "python3 lumina/agents/orchestrator.py --run",
                th.text_dim, 1);
  }

  const f32 total = 1.0f;
  s.fill_round_rect(Rect{content.x + 20, content.bottom() - 28, content.w - 40, 6}, 3,
                    th.panel_border.with_alpha(40));
  s.fill_round_rect(
      Rect{content.x + 20, content.bottom() - 28, static_cast<int>((content.w - 40) * total), 6},
      3, th.success);
  s.draw_text(content.x + 20, content.bottom() - 44, "pipeline complete · release ready",
              th.text_faint, 1);
}

}  // namespace lumina
