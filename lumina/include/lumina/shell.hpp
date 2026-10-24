// Lumina OS — the desktop shell: menubar, dock, control centre, spotlight,
// workspaces and the boot sequence. The shell owns no pixels of its own; it
// composes the framebuffer through the compositor's canvas.
// SPDX-License-Identifier: MIT
#pragma once

#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "lumina/apps.hpp"
#include "lumina/compositor.hpp"

namespace lumina {

class Shell : public SettingsSink, public MetricsSource, public TerminalBackend {
 public:
  Shell(int width, int height);

  void resize(int width, int height);
  Surface& canvas() { return comp_.canvas(); }
  const Surface& canvas() const { return comp_.canvas(); }
  int width() const { return comp_.width(); }
  int height() const { return comp_.height(); }
  Compositor& compositor() { return comp_; }
  Theme& theme() { return comp_.theme(); }

  // --- Input (canvas coordinates) -----------------------------------------
  void pointer_move(Point p);
  void pointer_down(Point p);
  void pointer_up(Point p);
  void scroll(Point p, int delta);
  void key(const std::string& key);

  // --- Frame ---------------------------------------------------------------
  void tick(f32 dt_ms);
  void render();
  bool needs_frame() const;

  // --- Backends ------------------------------------------------------------
  void set_clock(std::string text) { clock_ = std::move(text); }
  void set_terminal_proxy(std::function<TerminalResult(const std::string&)> proxy) {
    terminal_proxy_ = std::move(proxy);
  }
  void set_system_probe(std::function<std::pair<double, double>()> probe) {
    system_probe_ = std::move(probe);
  }
  void note_syscall() { ++syscalls_; }
  void add_syscalls(unsigned long long n) { syscalls_ += n; }

  // --- SettingsSink / MetricsSource / TerminalBackend ----------------------
  void set_dark(bool dark) override;
  void set_accent(int index) override;
  void set_motion(float scale) override;
  void set_glass(bool enabled) override;
  void open_app(WindowKind kind) override;
  Metrics metrics() const override;
  TerminalResult execute(const std::string& line) override;
  std::string prompt() const override { return "lumina"; }

  // --- Presentation hooks (used by tests and the simulator) ----------------
  void open_app_named(const std::string& name);
  // Presentation hook: the first window hosting `kind`, or nullptr.
  Window* window(WindowKind kind);
  void close_all_windows();
  void set_workspace(int index);
  int workspace() const { return workspace_; }
  void toggle_control_centre();
  void toggle_spotlight();
  void set_cursor(Point p) { cursor_ = p; pointer_inside_ = true; }
  void set_brightness(f32 v) { brightness_ = clampf(v, 0.3f, 1.f); }
  bool booted() const { return boot_t_ >= 1.f; }
  std::vector<int> window_kinds() const;

 private:
  struct MenuEntry {
    std::string label;
    std::string shortcut;
    bool separator{false};
    bool checked{false};
    std::function<void()> action;
  };

  void draw_desktop();
  void draw_boot();
  void draw_menubar();
  void draw_menubar_menu();
  void draw_dock();
  void draw_control_centre();
  void draw_spotlight();
  void draw_workspace_hud();
  void draw_cursor();

  void frost_panel(Rect r, int radius, Color tint, int blur_radius);
  std::vector<std::pair<std::string, int>> menu_titles() const;  // label + x
  Rect dock_item_rect(int index, bool magnified = false) const;
  std::vector<MenuEntry> build_menu(const std::string& title);
  void run_menu_action(int index);
  void focus_existing(WindowKind kind);
  int window_for_kind(WindowKind kind) const;
  void apply_workspaces();
  void close_focused();
  void cycle_workspace(int delta);
  void launch_from_spotlight();

  Compositor comp_;
  std::vector<std::unique_ptr<Application>> apps_;
  std::map<int, WindowKind> window_apps_;
  std::map<int, int> window_workspace_;

  std::vector<DockItem> dock_items_;
  std::vector<std::string> spotlight_results_;

  Point cursor_{640, 400};
  bool pointer_inside_{false};
  int hover_dock_{-1};
  int hover_menu_{-1};

  bool cc_open_{false};
  bool spotlight_open_{false};
  bool menu_open_{false};
  int menu_index_{-1};
  int active_menu_item_{-1};

  int workspace_{0};
  int workspace_count_{3};
  f32 workspace_hud_{0.f};
  std::string spotlight_query_;

  f32 boot_t_{0.f};
  f32 clock_ms_{0.f};
  std::string clock_{"--:--"};

  f32 brightness_{1.f};
  f32 volume_{0.62f};
  bool wifi_{true};
  bool bluetooth_{true};
  bool focus_mode_{false};

  std::deque<float> frame_history_;
  f32 frame_accum_{0.f};
  int frame_count_{0};
  double fps_{0.0};
  double last_frame_ms_{0.0};
  unsigned long long syscalls_{0};
  unsigned long long frames_{0};

  std::function<TerminalResult(const std::string&)> terminal_proxy_;
  std::function<std::pair<double, double>()> system_probe_;
};

}  // namespace lumina
