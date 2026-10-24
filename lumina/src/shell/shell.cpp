// Lumina OS — desktop shell implementation.
// SPDX-License-Identifier: MIT
#include "lumina/shell.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "lumina/icons.hpp"

namespace lumina {
namespace {

constexpr int kMenubarH = 32;
constexpr int kDockItemW = 62;
constexpr int kDockIcon = 44;

inline f32 sd_round_box(f32 px, f32 py, f32 half_w, f32 half_h, f32 radius) {
  const f32 qx = std::fabs(px) - half_w + radius;
  const f32 qy = std::fabs(py) - half_h + radius;
  const f32 ax = qx > 0.f ? qx : 0.f;
  const f32 ay = qy > 0.f ? qy : 0.f;
  return std::sqrt(ax * ax + ay * ay) + std::min(std::max(qx, qy), 0.f) - radius;
}

std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return s;
}

bool contains_ci(const std::string& haystack, const std::string& needle) {
  if (needle.empty()) return true;
  return lower(haystack).find(lower(needle)) != std::string::npos;
}

std::string kind_name(WindowKind kind) {
  switch (kind) {
    case WindowKind::Files: return "Files";
    case WindowKind::Terminal: return "Terminal";
    case WindowKind::Notes: return "Notes";
    case WindowKind::Settings: return "Settings";
    case WindowKind::Monitor: return "Monitor";
    case WindowKind::About: return "About Lumina";
    case WindowKind::Studio: return "Build Studio";
  }
  return "Lumina";
}

std::string fmt_seconds(double s) {
  const int total = static_cast<int>(s);
  char buf[32];
  std::snprintf(buf, sizeof buf, "%02d:%02d:%02d", total / 3600, (total / 60) % 60, total % 60);
  return buf;
}

}  // namespace

// ---------------------------------------------------------------------------
Shell::Shell(int width, int height) : comp_(width, height) {
  theme().set_accent_index(0);
  dock_items_ = {
      {"Files", WindowKind::Files, Color::rgb(0x4C8DFF), false},
      {"Terminal", WindowKind::Terminal, Color::rgb(0x2ED3A8), false},
      {"Notes", WindowKind::Notes, Color::rgb(0xF5B23C), false},
      {"Settings", WindowKind::Settings, Color::rgb(0x92A0BD), false},
      {"Monitor", WindowKind::Monitor, Color::rgb(0xFF6F6A), false},
      {"Studio", WindowKind::Studio, Color::rgb(0xA46BFF), false},
      {"About", WindowKind::About, Color::rgb(0x6FA0FF), false},
  };
  for (int i = 0; i < 24; ++i) frame_history_.push_back(0.f);
}

void Shell::resize(int width, int height) {
  comp_.resize(width, height);
  cursor_.x = clampi(cursor_.x, 0, width - 1);
  cursor_.y = clampi(cursor_.y, 0, height - 1);
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------
int Shell::window_for_kind(WindowKind kind) const {
  for (const Window* w : comp_.windows()) {
    auto it = window_apps_.find(w->id());
    if (it != window_apps_.end() && it->second == kind) return w->id();
  }
  return -1;
}

bool Shell::needs_frame() const { return true; }

void Shell::focus_existing(WindowKind kind) {
  const int id = window_for_kind(kind);
  if (id < 0) return;
  if (Window* w = comp_.find(id)) {
    w->set_minimised(false);
    if (window_workspace_[id] != workspace_) {
      window_workspace_[id] = workspace_;
      apply_workspaces();
    }
  }
  comp_.focus_window(id);
}

void Shell::open_app(WindowKind kind) {
  const bool singleton = kind == WindowKind::Settings || kind == WindowKind::Monitor ||
                         kind == WindowKind::About || kind == WindowKind::Studio;
  if (singleton && window_for_kind(kind) >= 0) {
    focus_existing(kind);
    return;
  }
  if (kind != WindowKind::Files && kind != WindowKind::Terminal && kind != WindowKind::Notes) {
    if (window_for_kind(kind) >= 0) {
      focus_existing(kind);
      return;
    }
  }

  WindowSpec spec;
  spec.kind = kind;
  spec.title = kind_name(kind);
  const int n = static_cast<int>(apps_.size());
  const int ox = (n % 5) * 26;
  const int oy = (n % 5) * 22;

  std::unique_ptr<Application> app;
  switch (kind) {
    case WindowKind::Files:
      spec.frame = Rect{120 + ox, 80 + oy, 700, 440};
      spec.min_width = 460;
      spec.min_height = 300;
      app = std::make_unique<FilesApp>();
      break;
    case WindowKind::Terminal:
      spec.frame = Rect{220 + ox, 140 + oy, 660, 410};
      spec.min_width = 420;
      spec.min_height = 260;
      app = std::make_unique<TerminalApp>(static_cast<TerminalBackend*>(this));
      break;
    case WindowKind::Notes:
      spec.frame = Rect{300 + ox, 110 + oy, 700, 470};
      spec.min_width = 480;
      spec.min_height = 320;
      app = std::make_unique<NotesApp>();
      break;
    case WindowKind::Settings:
      spec.frame = Rect{320 + ox, 120 + oy, 680, 480};
      spec.min_width = 540;
      spec.min_height = 400;
      app = std::make_unique<SettingsApp>(static_cast<SettingsSink*>(this));
      break;
    case WindowKind::Monitor:
      spec.frame = Rect{360 + ox, 110 + oy, 660, 560};
      spec.min_width = 560;
      spec.min_height = 520;
      app = std::make_unique<MonitorApp>(static_cast<MetricsSource*>(this));
      break;
    case WindowKind::About:
      spec.frame = Rect{420 + ox, 150 + oy, 540, 530};
      spec.min_width = 460;
      spec.min_height = 440;
      app = std::make_unique<AboutApp>(static_cast<MetricsSource*>(this));
      break;
    case WindowKind::Studio:
      spec.frame = Rect{130 + ox, 76 + oy, 820, 560};
      spec.min_width = 640;
      spec.min_height = 500;
      app = std::make_unique<StudioApp>();
      break;
  }
  spec.frame.w = std::min(spec.frame.w, width() - 60);
  spec.frame.h = std::min(spec.frame.h, height() - kMenubarH - 110);
  spec.frame.x = clampi(spec.frame.x, 20, std::max(20, width() - spec.frame.w - 20));
  spec.frame.y = clampi(spec.frame.y, kMenubarH + 12,
                        std::max(kMenubarH + 12, height() - spec.frame.h - 100));

  Application* raw = app.get();
  apps_.push_back(std::move(app));
  Window& w = comp_.add_window(spec, raw);
  window_apps_[w.id()] = kind;
  window_workspace_[w.id()] = workspace_;
  apply_workspaces();
}

void Shell::open_app_named(const std::string& name) {
  for (const DockItem& item : dock_items_) {
    if (contains_ci(item.label, name)) {
      set_dark(theme().dark);
      open_app(item.kind);
      return;
    }
  }
}

Window* Shell::window(WindowKind kind) {
  const int id = window_for_kind(kind);
  return id < 0 ? nullptr : comp_.find(id);
}

void Shell::close_all_windows() {
  for (Window* w : comp_.owned_snapshot()) comp_.close_window(w->id());
}

void Shell::apply_workspaces() {
  for (Window* w : comp_.windows()) {
    auto it = window_workspace_.find(w->id());
    const int ws = it == window_workspace_.end() ? workspace_ : it->second;
    w->set_visible(ws == workspace_);
  }
}

void Shell::set_workspace(int index) {
  workspace_ = clampi(index, 0, workspace_count_ - 1);
  workspace_hud_ = 1.f;
  apply_workspaces();
  if (Window* w = comp_.focused_window()) {
    if (!w->visible()) {
      for (auto it = comp_.windows().rbegin(); it != comp_.windows().rend(); ++it) {
        if ((*it)->visible()) {
          comp_.focus_window((*it)->id());
          break;
        }
      }
    }
  }
}

void Shell::cycle_workspace(int delta) {
  set_workspace((workspace_ + delta + workspace_count_) % workspace_count_);
}

void Shell::close_focused() {
  if (Window* w = comp_.focused_window()) comp_.close_window(w->id());
}

void Shell::toggle_control_centre() {
  cc_open_ = !cc_open_;
  if (cc_open_) {
    spotlight_open_ = false;
    menu_open_ = false;
  }
}

void Shell::toggle_spotlight() {
  spotlight_open_ = !spotlight_open_;
  spotlight_query_.clear();
  if (spotlight_open_) {
    cc_open_ = false;
    menu_open_ = false;
  }
}

void Shell::launch_from_spotlight() {
  if (spotlight_results_.empty()) {
    spotlight_open_ = false;
    return;
  }
  const std::string name = spotlight_results_.front();
  spotlight_open_ = false;
  open_app_named(name);
}

std::vector<int> Shell::window_kinds() const {
  std::vector<int> out;
  for (const Window* w : comp_.windows()) {
    auto it = window_apps_.find(w->id());
    if (it != window_apps_.end()) out.push_back(static_cast<int>(it->second));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Settings / metrics / terminal
// ---------------------------------------------------------------------------
void Shell::set_dark(bool dark) {
  const bool keep = theme().glass;
  const f32 motion = theme().motion;
  theme().set_appearance(dark);
  theme().glass = keep;
  theme().motion = motion;
}

void Shell::set_accent(int index) { theme().set_accent_index(index); }

void Shell::set_motion(float scale) { theme().motion = clampf(scale, 0.f, 1.f); }

void Shell::set_glass(bool enabled) { theme().glass = enabled; }

Metrics Shell::metrics() const {
  Metrics m;
  m.fps = fps_;
  m.frame_ms = last_frame_ms_;
  m.windows = static_cast<int>(comp_.windows().size());
  m.uptime_s = clock_ms_ / 1000.0;
  m.syscalls = syscalls_;
  m.frames = frames_;
  m.frame_history.assign(frame_history_.begin(), frame_history_.end());
  if (system_probe_) {
    const auto probe = system_probe_();
    m.cpu_percent = probe.first;
    m.memory_mb = probe.second;
  }
  return m;
}

TerminalResult Shell::execute(const std::string& line) {
  TerminalResult result;
  const std::string trimmed = line;
  std::string cmd = trimmed;
  std::string arg;
  const size_t sp = trimmed.find(' ');
  if (sp != std::string::npos) {
    cmd = trimmed.substr(0, sp);
    arg = trimmed.substr(sp + 1);
  }
  auto push = [&](const std::string& s) { result.lines.push_back(s); };
  ++syscalls_;

  if (cmd.empty()) {
    return result;
  } else if (cmd == "help") {
    push("lumina shell — commands");
    push("  help              this list");
    push("  lumina            system overview");
    push("  ls [path]         list the virtual file system");
    push("  cat <file>        print a document");
    push("  agents            list the agent pipeline");
    push("  sysinfo           live metrics");
    push("  theme dark|light  switch appearance");
    push("  accent <0..4>      change accent");
    push("  open <app>        files | terminal | notes | settings | monitor | studio");
    push("  workspace <1..3>  switch workspace");
    push("  syscalls          syscall surface summary");
    push("  clear             clear the screen");
  } else if (cmd == "lumina" || cmd == "neofetch") {
    const Metrics m = metrics();
    push("        ◈        lumina@crystal");
    push("      ◈ ◈ ◈      -------------");
    push("        ◈        OS       Lumina 1.0 (crystal)");
    push("                 Kernel   rust 1.0 · x86_64 · preempt");
    push("                 Shell    c++17 · " + std::to_string(width()) + "x" +
         std::to_string(height()) + " software compositor");
    push("                 Broker   python 3 · " + std::to_string(m.syscalls) + " syscalls");
    push("                 Uptime   " + fmt_seconds(m.uptime_s));
    push("                 Theme    " + theme().name +
         " · accent " + std::to_string(theme().accent_index()));
    push("                 Windows  " + std::to_string(m.windows) + " · frames " +
         std::to_string(m.frames));
  } else if (cmd == "ls") {
    const std::string path = arg.empty() ? "~" : arg;
    if (path == "~" || path == "/" || path == "home") {
      push("Documents/   Projects/   Media/   build.log   install.sh   README.md");
    } else if (path.find("Projects") != std::string::npos) {
      push("lumina-os/   agent-pipeline/   syscalls/");
    } else if (path.find("lumina-os") != std::string::npos) {
      push("compositor.cpp   surface.cpp   apps.cpp   shell.cpp   theme.cpp");
    } else if (path.find("agent") != std::string::npos) {
      push("manifest.json   orchestrator.py   roles/");
    } else if (path.find("syscall") != std::string::npos) {
      push("sysd.py   test_sysd.py   audit.jsonl");
    } else if (path.find("Documents") != std::string::npos) {
      push("Roadmap.md   Architecture.md   Release-Notes.md   press/");
    } else {
      push("ls: " + path + ": no such directory");
      result.exit_code = 2;
    }
  } else if (cmd == "cat") {
    if (arg.empty()) {
      push("usage: cat <file>");
      result.exit_code = 64;
    } else if (arg.find("README") != std::string::npos) {
      push("# Lumina OS");
      push("");
      push("An operating system built as a native answer to the Mac, not a skin.");
      push("C++ composes pixels, Rust owns the machine, Python owns the syscalls.");
    } else if (arg.find("Roadmap") != std::string::npos) {
      push("1.0  preview shell: menubar, dock, workspaces, spotlight");
      push("1.1  multi-surface: second display, mirroring, per-app DPI");
      push("1.2  agent rebuilds: every layer reproducible from the manifest");
      push("2.0  ring-3 userspace ABI freeze + package signatures");
    } else {
      push("cat: " + arg + ": permission denied (read-only demo mount)");
      result.exit_code = 13;
    }
  } else if (cmd == "agents") {
    push("agent pipeline — 9 roles, 1 manifest (lumina/agents/manifest.json)");
    push("  kernel-architect     builds/rust_app      boot, memory, sched   ready");
    push("  graphics-engineer    builds/rust_app      framebuffer, present ready");
    push("  compositor-engineer  builds/compositor    z-order, glass       ready");
    push("  shell-designer       builds/lumina-host   menubar, dock        ready");
    push("  syscall-architect    builds/syscalls      broker, policy       ready");
    push("  app-builder          builds/compositor    files/notes/terminal ready");
    push("  qa-engineer          builds/syscalls      tests, goldens       ready");
    push("  security-reviewer    builds/lumina-host   threat model         ready");
    push("  release-manager      builds/lumina-host   versioning, docs     ready");
  } else if (cmd == "sysinfo") {
    const Metrics m = metrics();
    push("fps          " + std::to_string(static_cast<int>(m.fps)));
    push("frame time   " + std::to_string(m.frame_ms).substr(0, 5) + " ms");
    push("cpu          " + std::to_string(static_cast<int>(m.cpu_percent)) + " %");
    push("memory       " + std::to_string(static_cast<int>(m.memory_mb)) + " MB");
    push("windows      " + std::to_string(m.windows));
    push("frames       " + std::to_string(m.frames));
    push("syscalls     " + std::to_string(m.syscalls));
  } else if (cmd == "theme") {
    if (arg == "dark") {
      set_dark(true);
      push("appearance: dark");
    } else if (arg == "light") {
      set_dark(false);
      push("appearance: light");
    } else {
      push("usage: theme dark|light");
    }
  } else if (cmd == "accent") {
    if (!arg.empty()) {
      const int idx = std::atoi(arg.c_str());
      set_accent(idx);
      push("accent: " + std::to_string(theme().accent_index()));
    } else {
      push("usage: accent <0..4>");
    }
  } else if (cmd == "open") {
    if (arg.empty()) {
      push("usage: open <app>");
    } else {
      open_app_named(arg);
      push("launching " + arg);
    }
  } else if (cmd == "workspace") {
    set_workspace(std::atoi(arg.c_str()) - 1);
    push("workspace " + std::to_string(workspace_ + 1) + " of " +
         std::to_string(workspace_count_));
  } else if (cmd == "syscalls") {
    push("24 calls across 6 domains");
    push("  fs    open close read write stat unlink mkdir readdir");
    push("  mem   mmap munmap mprotect brk");
    push("  proc  spawn exit wait signal yield");
    push("  ipc   pipe shm send recv");
    push("  gfx   surface_create surface_present surface_blit");
    push("  time  now sleep");
    push("every call is brokered, typed and audited by tools/lumina/sysd.py");
  } else if (cmd == "clear") {
    result.clear_screen = true;
  } else if (cmd == "date") {
    push(clock_.empty() ? "clock unavailable" : clock_);
  } else if (cmd == "whoami") {
    push("lumina@crystal (ring 3, sandboxed)");
  } else if (cmd == "uname") {
    push("Lumina crystal 1.0.0 x86_64 rust-kernel c++compositor python-broker");
  } else if (cmd == "echo") {
    push(arg);
  } else if (terminal_proxy_) {
    TerminalResult proxied = terminal_proxy_(trimmed);
    result.lines = proxied.lines;
    result.exit_code = proxied.exit_code;
    return result;
  } else {
    push(cmd + ": command not found — try 'help'");
    result.exit_code = 127;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------
void Shell::tick(f32 dt_ms) {
  const f32 scaled = theme().motion > 0.f ? dt_ms : dt_ms * 0.35f;
  clock_ms_ += dt_ms;
  if (boot_t_ < 1.f) boot_t_ = clampf(boot_t_ + dt_ms / 1900.f, 0.f, 1.f);
  workspace_hud_ = std::max(0.f, workspace_hud_ - dt_ms / 1400.f);

  comp_.tick(dt_ms);
  // Reap bookkeeping for windows the compositor destroyed.
  for (auto it = window_apps_.begin(); it != window_apps_.end();) {
    if (!comp_.find(it->first))
      it = window_apps_.erase(it);
    else
      ++it;
  }
  for (auto it = window_workspace_.begin(); it != window_workspace_.end();) {
    if (!comp_.find(it->first))
      it = window_workspace_.erase(it);
    else
      ++it;
  }

  if (dt_ms > 0.f) {
    last_frame_ms_ = static_cast<double>(dt_ms);
    frame_accum_ += dt_ms;
    ++frame_count_;
    if (frame_accum_ >= 250.f) {
      fps_ = frame_count_ * 1000.0 / frame_accum_;
      frame_accum_ = 0.f;
      frame_count_ = 0;
      frame_history_.push_back(static_cast<float>(clampf(fps_ / 60.0, 0.0, 1.0)));
      if (frame_history_.size() > 48) frame_history_.pop_front();
    }
  }
  (void)scaled;
}

void Shell::render() {
  ++frames_;
  for (DockItem& item : dock_items_) item.running = window_for_kind(item.kind) >= 0;

  draw_desktop();
  comp_.render();

  if (boot_t_ < 1.f) {
    draw_boot();
    draw_cursor();
    return;
  }

  draw_menubar();
  draw_dock();
  if (menu_open_) draw_menubar_menu();
  if (workspace_hud_ > 0.01f) draw_workspace_hud();
  draw_control_centre();
  draw_spotlight();
  if (pointer_inside_) draw_cursor();

  if (brightness_ < 0.999f) {
    const f32 veil = (1.f - brightness_) * 0.85f;
    canvas().dim(canvas().bounds(), veil);
  }
}

// ---------------------------------------------------------------------------
// Painting helpers
// ---------------------------------------------------------------------------
void Shell::frost_panel(Rect r, int radius, Color tint, int blur_radius) {
  const Rect box = intersect(r, canvas().bounds());
  if (box.empty()) return;
  if (radius > 0) canvas().shadow(r, radius, theme().shadow, 22, 6);
  if (!theme().glass || blur_radius <= 0) {
    canvas().fill_round_rect(r, radius, tint);
    return;
  }
  Surface backdrop(r.w, r.h);
  backdrop.blit(canvas(), -r.x, -r.y);
  backdrop.blur(backdrop.bounds(), blur_radius);

  const f32 hw = r.w * 0.5f;
  const f32 hh = r.h * 0.5f;
  const f32 rad = static_cast<f32>(clampi(radius, 0, std::min(r.w, r.h) / 2));
  const f32 k = static_cast<f32>(tint.a) / 255.f;
  for (int y = box.y; y < box.bottom(); ++y) {
    for (int x = box.x; x < box.right(); ++x) {
      f32 cov = 1.f;
      if (radius > 0) {
        cov = clampf(0.5f - sd_round_box(static_cast<f32>(x) + 0.5f - (r.x + hw),
                                         static_cast<f32>(y) + 0.5f - (r.y + hh), hw, hh, rad),
                     0.f, 1.f);
        if (cov <= 0.f) continue;
      }
      const u32 p =
          backdrop.data()[static_cast<size_t>(y - r.y) * r.w + static_cast<size_t>(x - r.x)];
      const Color base = Color::from_argb(p);
      const Color out = mix(base, tint, k);
      canvas().blend(x, y, out.with_alpha(static_cast<u8>(cov * 255.f)));
    }
  }
}

void Shell::draw_desktop() {
  Surface& s = canvas();
  const Theme& th = theme();
  s.vertical_gradient(s.bounds(), th.desktop_top, th.desktop_bottom);

  const f32 t = clock_ms_ / 1000.f;
  const int w = width();
  const int h = height();
  const struct {
    f32 cx, cy, r, phase;
    Color color;
  } blobs[3] = {
      {0.22f, 0.18f, 0.55f, 0.f, th.aura_a},
      {0.82f, 0.28f, 0.48f, 1.7f, th.aura_b},
      {0.55f, 0.92f, 0.60f, 3.1f, th.aura_c},
  };
  for (const auto& b : blobs) {
    const int cx = static_cast<int>(w * (b.cx + 0.03f * std::sin(t * 0.11f + b.phase)));
    const int cy = static_cast<int>(h * (b.cy + 0.03f * std::cos(t * 0.09f + b.phase)));
    const int radius = static_cast<int>(std::min(w, h) * b.r);
    s.radial_glow(cx, cy, radius, b.color.with_alpha(th.dark ? 54 : 42), 2.4f);
  }

  // Vignette keeps focus in the middle of the canvas.
  for (int i = 0; i < 70; ++i) {
    const u8 a = static_cast<u8>((70 - i) * 0.9f);
    s.blend_rect(Rect{0, i, w, 1}, Color(0, 0, 0, static_cast<u8>(a * 0.35f)));
    s.blend_rect(Rect{0, h - 1 - i, w, 1}, Color(0, 0, 0, static_cast<u8>(a * 0.55f)));
  }

  // Workspace indicator watermark.
  if (workspace_hud_ > 0.01f) {
    const std::string label = "0" + std::to_string(workspace_ + 1);
    const int scale = 10;
    const int tw = Surface::text_width(label, scale);
    s.draw_text(w / 2 - tw / 2, h / 2 - 60, label,
                th.text.with_alpha(static_cast<u8>(28 * workspace_hud_)), scale);
  }
}

void Shell::draw_boot() {
  Surface& s = canvas();
  const Theme& th = theme();
  const int w = width();
  const int h = height();
  s.vertical_gradient(s.bounds(), Color::rgb(0x05070E), Color::rgb(0x0B1020));
  s.radial_glow(w / 2, static_cast<int>(h * 0.30f), static_cast<int>(h * 0.62f),
                th.accent.with_alpha(30), 2.1f);

  // Mark
  const int cx = w / 2;
  const int mark_y = static_cast<int>(h * 0.24f);
  const f32 breathe = 1.f + 0.045f * std::sin(boot_t_ * 22.f);
  const int outer = static_cast<int>(30 * breathe);
  for (int i = 4; i >= 1; --i)
    s.fill_circle(cx, mark_y, outer + i * 7, th.accent.with_alpha(static_cast<u8>(10 + i * 6)));
  s.fill_circle(cx, mark_y, outer, th.accent.with_alpha(110));
  s.fill_circle(cx, mark_y, outer - 8, Color(0x05, 0x07, 0x0E));
  s.fill_circle(cx, mark_y, 12, th.accent);

  const std::string title = "LUMINA";
  s.draw_text(cx - Surface::text_width(title, 7, 12) / 2, mark_y + 56, title, th.text, 7, 12);
  const std::string sub = "B E Y O N D   T H E   M A C";
  s.draw_text(cx - Surface::text_width(sub, 1) / 2, mark_y + 124, sub, th.text_faint, 1);

  const int bar_w = std::min(560, w - 200);
  const Rect track{cx - bar_w / 2, mark_y + 162, bar_w, 5};
  s.fill_round_rect(track, 3, Color(255, 255, 255, 28));
  const int filled = static_cast<int>(bar_w * ease_in_out_cubic(boot_t_));
  s.fill_round_rect(Rect{track.x, track.y, filled, 5}, 3, th.accent);
  const std::string pct = std::to_string(static_cast<int>(boot_t_ * 100)) + "%";
  s.draw_text_right(track.right(), track.y - 20, pct, th.text_faint, 1);

  struct BootLine {
    f32 at;
    const char* tag;
    const char* text;
  };
  const BootLine lines[] = {
      {0.06f, "kernel", "rust 1.0 · long mode · paging · preemptive scheduler"},
      {0.24f, "graphics", "c++17 · linear 32bpp framebuffer · double buffered"},
      {0.46f, "shell", "glass compositor · spring motion · 3 workspaces"},
      {0.68f, "syscalls", "python 3 · 24 typed calls · broker audit on"},
      {0.88f, "agents", "manifest verified · 9 roles · reproducible build"},
  };
  const int stats_top = track.y + 40;
  for (size_t i = 0; i < sizeof(lines) / sizeof(lines[0]); ++i) {
    const BootLine& line = lines[i];
    const int y = stats_top + static_cast<int>(i) * 34;
    if (boot_t_ + 0.02f < line.at) continue;
    const f32 a = clampf((boot_t_ - line.at) * 10.f + 0.35f, 0.f, 1.f);
    const Rect row{cx - bar_w / 2, y - 8, bar_w, 30};
    s.fill_round_rect(row, 7, Color(255, 255, 255, static_cast<u8>(10 * a)));
    s.draw_text(row.x + 12, y - 1, line.tag, th.accent.with_alpha(static_cast<u8>(255 * a)), 2);
    s.draw_text(row.x + 122, y - 1, line.text, th.text_dim.with_alpha(static_cast<u8>(235 * a)), 2);
    s.draw_text_right(row.right() - 12, y + 1, "ok", th.success.with_alpha(static_cast<u8>(255 * a)), 1);
  }

  const std::string foot = "lumina 1.0 · crystal · x86_64";
  s.draw_text(cx - Surface::text_width(foot, 1) / 2, h - 48, foot, th.text_faint, 1);
  s.draw_text(cx - Surface::text_width("press any key to continue", 1) / 2, h - 32,
              "press any key to continue", th.text_faint.with_alpha(0).with_alpha(0), 1);
}

std::vector<std::pair<std::string, int>> Shell::menu_titles() const {
  std::vector<std::pair<std::string, int>> out;
  const char* names[5] = {"File", "Edit", "View", "Window", "Help"};
  const Window* focused_win = comp_.focused_window();
  const std::string app_label = focused_win ? focused_win->spec().title : "Lumina";
  int x = 34 + Surface::text_width(app_label, 2) + 30;
  for (const char* n : names) {
    out.emplace_back(n, x);
    x += Surface::text_width(n, 2) + 24;
  }
  return out;
}

void Shell::draw_menubar() {
  Surface& s = canvas();
  const Theme& th = theme();
  const int w = width();
  const Rect bar{0, 0, w, kMenubarH};
  frost_panel(bar, 0, th.panel, 10);
  s.fill(Rect{0, kMenubarH - 1, w, 1}, th.hairline);

  int right = 0;  // right cluster width, so the left side never collides

  // ---- right cluster (drawn first, measured) ----
  int rx = w - 14;
  const std::string clock = clock_;
  const int clock_w = Surface::text_width(clock, 2);
  s.draw_text(rx - clock_w, 9, clock, th.text, 2);
  rx -= clock_w + 16;

  const Rect cc{rx - 28, 3, 28, kMenubarH - 6};
  if (cc_open_) s.fill_round_rect(cc, 7, th.accent_soft);
  s.stroke_round_rect(Rect{cc.x + 7, cc.y + 8, 12, 3}, 2, th.text_dim, 2);
  s.stroke_round_rect(Rect{cc.x + 7, cc.y + 16, 12, 3}, 2, th.text_dim, 2);
  s.fill_circle(cc.x + 11, cc.y + 9, 1, th.text);
  s.fill_circle(cc.x + 16, cc.y + 17, 1, th.text);
  rx -= 34;

  const Rect search{rx - 28, 3, 28, kMenubarH - 6};
  if (spotlight_open_) s.fill_round_rect(search, 7, th.accent_soft);
  s.stroke_round_rect(Rect{search.x + 8, search.y + 8, 10, 10}, 5, th.text_dim, 2);
  s.fill(Rect{search.x + 16, search.y + 18, 6, 2}, th.text_dim);
  rx -= 34;

  const int pills_w = workspace_count_ * 18;
  for (int i = 0; i < workspace_count_; ++i) {
    const Rect pill{rx - pills_w + i * 18, kMenubarH / 2 - 3, 12, 6};
    s.fill_round_rect(pill, 3, i == workspace_ ? th.accent : th.text_faint.with_alpha(130));
  }
  rx -= pills_w + 14;

  const std::string badge = "sys " + std::to_string(syscalls_);
  const int badge_w = Surface::text_width(badge, 1) + 18;
  s.fill_round_rect(Rect{rx - badge_w, 8, badge_w, 16}, 8, th.success.with_alpha(36));
  s.fill_circle(rx - badge_w + 8, 16, 3, th.success);
  s.draw_text(rx - badge_w + 14, 12, badge, th.success, 1);
  rx -= badge_w + 14;

  const std::string net = wifi_ ? "wifi" : "offline";
  const int net_w = Surface::text_width(net, 1) + 14;
  s.draw_text(rx - net_w + 4, 12, net, th.text_faint, 1);
  rx -= net_w + 12;
  right = w - rx;

  // ---- left cluster: crystal mark, app name, menus ----
  s.fill_circle(19, kMenubarH / 2, 7, th.accent);
  s.fill_circle(19, kMenubarH / 2, 3, th.panel_strong);

  const Window* focused = comp_.focused_window();
  const std::string app_name = focused ? focused->spec().title : "Lumina";
  s.draw_text(34, 9, app_name, th.text, 2);

  const int menu_limit = w - right - 24;
  const auto titles = menu_titles();
  for (size_t i = 0; i < titles.size(); ++i) {
    const int tw = Surface::text_width(titles[i].first, 2);
    if (titles[i].second + tw > menu_limit) break;
    const bool hot = menu_open_ && static_cast<int>(i) == menu_index_;
    const bool hover = static_cast<int>(i) == hover_menu_;
    if (hot || hover)
      s.fill_round_rect(Rect{titles[i].second - 8, 5, tw + 16, kMenubarH - 10}, 6,
                        hot ? th.accent_soft : Color(255, 255, 255, 22));
    s.draw_text(titles[i].second, 9, titles[i].first, hot ? th.text : th.text_dim, 2);
  }
  (void)bluetooth_;
  (void)focus_mode_;
}

std::vector<Shell::MenuEntry> Shell::build_menu(const std::string& title) {
  std::vector<MenuEntry> out;
  if (title == "File") {
    out.push_back({"New Files Window", "⌘N", false, false, [this] { open_app(WindowKind::Files); }});
    out.push_back({"New Terminal", "⌘T", false, false, [this] { open_app(WindowKind::Terminal); }});
    out.push_back({"", "", true, false, nullptr});
    out.push_back({"Close Window", "⌘W", false, false, [this] { close_focused(); }});
    out.push_back({"Close All", "⇧⌘W", false, false, [this] {
                     for (Window* w : comp_.windows()) comp_.close_window(w->id());
                   }});
  } else if (title == "Edit") {
    out.push_back({"Undo", "⌘Z", false, false, nullptr});
    out.push_back({"Redo", "⇧⌘Z", false, false, nullptr});
    out.push_back({"", "", true, false, nullptr});
    out.push_back({"Copy", "⌘C", false, false, nullptr});
    out.push_back({"Paste", "⌘V", false, false, nullptr});
  } else if (title == "View") {
    out.push_back({"Dark Appearance", "", false, theme().dark, [this] { set_dark(true); }});
    out.push_back({"Light Appearance", "", false, !theme().dark, [this] { set_dark(false); }});
    out.push_back({"", "", true, false, nullptr});
    out.push_back({"Glass & Blur", "", false, theme().glass,
                   [this] { set_glass(!theme().glass); }});
    out.push_back({"Reduce Motion", "", false, theme().motion == 0.f,
                   [this] { set_motion(theme().motion == 0.f ? 1.f : 0.f); }});
    out.push_back({"", "", true, false, nullptr});
    out.push_back({"Next Accent", "⌘A", false, false,
                   [this] { set_accent(theme().accent_index() + 1); }});
  } else if (title == "Window") {
    out.push_back({"Minimise", "⌘M", false, false, [this] {
                     if (Window* w = comp_.focused_window()) w->set_minimised(true);
                   }});
    out.push_back({"Zoom", "⌃⌘Z", false, false, [this] {
                     if (Window* w = comp_.focused_window())
                       w->set_frame(Rect{40, 52, width() - 80, height() - 162});
                   }});
    out.push_back({"", "", true, false, nullptr});
    out.push_back({"Workspace 1", "⌘1", false, workspace_ == 0, [this] { set_workspace(0); }});
    out.push_back({"Workspace 2", "⌘2", false, workspace_ == 1, [this] { set_workspace(1); }});
    out.push_back({"Workspace 3", "⌘3", false, workspace_ == 2, [this] { set_workspace(2); }});
  } else {
    out.push_back({"About Lumina", "", false, false, [this] { open_app(WindowKind::About); }});
    out.push_back({"Build Studio", "", false, false, [this] { open_app(WindowKind::Studio); }});
    out.push_back({"", "", true, false, nullptr});
    out.push_back({"System Monitor", "", false, false, [this] { open_app(WindowKind::Monitor); }});
    out.push_back({"Terminal", "", false, false, [this] { open_app(WindowKind::Terminal); }});
  }
  return out;
}

void Shell::draw_menubar_menu() {
  const auto titles = menu_titles();
  if (menu_index_ < 0 || menu_index_ >= static_cast<int>(titles.size())) return;
  const auto entries = build_menu(titles[static_cast<size_t>(menu_index_)].first);
  const int item_h = 26;
  int widest = 180;
  for (const MenuEntry& e : entries) {
    const int tw = Surface::text_width(e.label, 2) + Surface::text_width(e.shortcut, 1) + 90;
    widest = std::max(widest, tw);
  }
  int height = 12;
  for (const MenuEntry& e : entries) height += e.separator ? 9 : item_h;
  const Rect panel{titles[static_cast<size_t>(menu_index_)].second - 10, kMenubarH + 4, widest,
                   height};
  frost_panel(panel, 10, theme().panel_strong, 12);
  canvas().stroke_round_rect(panel, 10, theme().panel_border, 1);

  int y = panel.y + 6;
  int index = 0;
  for (const MenuEntry& e : entries) {
    if (e.separator) {
      canvas().fill(Rect{panel.x + 10, y + 4, panel.w - 20, 1}, theme().hairline);
      y += 9;
    } else {
      const Rect row{panel.x + 4, y, panel.w - 8, item_h - 2};
      if (index == active_menu_item_) canvas().fill_round_rect(row, 6, theme().selection);
      canvas().draw_text(row.x + 12, row.y + 5, e.label, theme().text, 2);
      if (!e.shortcut.empty())
        canvas().draw_text_right(row.right() - 12, row.y + 8, e.shortcut, theme().text_faint, 1);
      if (e.checked) canvas().fill_circle(row.right() - 18, row.cy(), 4, theme().accent);
      y += item_h;
      ++index;
    }
  }
}

void Shell::run_menu_action(int item_index) {
  const auto titles = menu_titles();
  if (menu_index_ < 0 || menu_index_ >= static_cast<int>(titles.size())) return;
  const auto entries = build_menu(titles[static_cast<size_t>(menu_index_)].first);
  int index = 0;
  for (const MenuEntry& e : entries) {
    if (e.separator) continue;
    if (index == item_index) {
      if (e.action) e.action();
      menu_open_ = false;
      return;
    }
    ++index;
  }
  menu_open_ = false;
}

Rect Shell::dock_item_rect(int index, bool magnified) const {
  const Rect dock = comp_.dock_rect();
  const int base_x = dock.x + 14 + index * kDockItemW;
  const int cx = base_x + kDockIcon / 2;
  f32 scale = 1.f;
  if (magnified && pointer_inside_ && !cc_open_ && !spotlight_open_) {
    const f32 d = static_cast<f32>(cursor_.x - cx);
    scale = 1.f + 0.30f * std::exp(-(d * d) / (52.f * 52.f));
  }
  const int size = static_cast<int>(kDockIcon * scale);
  const int x = cx - size / 2;
  const int bottom = dock.bottom() - 12;
  return Rect{x, bottom - size, size, size};
}

void Shell::draw_dock() {
  const Rect dock = comp_.dock_rect();
  frost_panel(dock, 24, theme().panel, 16);
  canvas().stroke_round_rect(dock, 24, theme().panel_border, 1);

  for (size_t i = 0; i < dock_items_.size(); ++i) {
    const DockItem& item = dock_items_[i];
    const Rect icon = dock_item_rect(static_cast<int>(i), true);
    const bool hovered = static_cast<int>(i) == hover_dock_;
    if (hovered) canvas().fill_circle(icon.cx(), icon.bottom() - 6, 16,
                                      item.tint.with_alpha(40));
    draw_icon(canvas(), icon, item.kind, item.tint, theme());
    if (item.running) canvas().fill_circle(icon.cx(), dock.bottom() - 7, 3, theme().text_dim);
    if (hovered) {
      const int tw = Surface::text_width(item.label, 1) + 18;
      const Rect tip{icon.cx() - tw / 2, dock.y - 26, tw, 20};
      frost_panel(tip, 8, theme().panel_strong, 8);
      canvas().draw_text_center(tip, item.label, theme().text, 1);
    }
  }
}

void Shell::draw_control_centre() {
  if (!cc_open_) return;
  const int w = 348;
  const Rect panel{width() - w - 14, kMenubarH + 10, w, 368};
  frost_panel(panel, 20, theme().panel_strong, 18);
  canvas().stroke_round_rect(panel, 20, theme().panel_border, 1);

  canvas().draw_text(panel.x + 18, panel.y + 16, "Control Centre", theme().text, 2);
  canvas().draw_text_right(panel.right() - 18, panel.y + 21, "Lumina 1.0", theme().text_faint, 1);

  struct Toggle {
    const char* label;
    const char* detail;
    bool on;
    Color tint;
  };
  Toggle toggles[4] = {
      {"Wi-Fi", wifi_ ? "Lumina-5G" : "off", wifi_, theme().accent},
      {"Bluetooth", bluetooth_ ? "2 devices" : "off", bluetooth_, theme().accent},
      {"Dark", theme().dark ? "on" : "off", theme().dark, theme().accent},
      {"Glass", theme().glass ? "on" : "off", theme().glass, theme().accent},
  };
  for (int i = 0; i < 4; ++i) {
    const Rect tile{panel.x + 16 + (i % 2) * ((w - 44) / 2 + 8), panel.y + 46 + (i / 2) * 62,
                    (w - 44) / 2, 54};
    const Color bg = toggles[i].on ? toggles[i].tint.with_alpha(52) : theme().panel_border.with_alpha(18);
    canvas().fill_round_rect(tile, 12, bg);
    canvas().fill_circle(tile.x + 18, tile.y + 20, 9,
                         toggles[i].on ? toggles[i].tint : theme().text_faint);
    canvas().draw_text(tile.x + 34, tile.y + 12, toggles[i].label, theme().text, 2);
    canvas().draw_text(tile.x + 34, tile.y + 32, toggles[i].detail, theme().text_faint, 1);
  }

  auto slider = [&](int y, const std::string& label, f32 value) {
    canvas().draw_text(panel.x + 18, y - 16, label, theme().text_dim, 1);
    const Rect track{panel.x + 18, y, w - 36, 8};
    canvas().fill_round_rect(track, 4, theme().panel_border.with_alpha(40));
    canvas().fill_round_rect(Rect{track.x, track.y, static_cast<int>(track.w * value), 8}, 4,
                             theme().accent);
    canvas().fill_circle(track.x + static_cast<int>(track.w * value), track.cy(), 7,
                         Color(255, 255, 255, 245));
  };
  slider(panel.y + 194, "BRIGHTNESS", (brightness_ - 0.3f) / 0.7f);
  slider(panel.y + 232, "VOLUME", volume_);

  canvas().draw_text(panel.x + 18, panel.y + 258, "ACCENT", theme().text_faint, 1);
  for (int i = 0; i < accent_count(); ++i) {
    Theme probe = theme();
    probe.set_accent_index(i);
    const int cx = panel.x + 30 + i * 38;
    canvas().fill_circle(cx, panel.y + 284, 12, probe.accent);
    if (i == theme().accent_index())
      canvas().stroke_round_rect(Rect{cx - 15, panel.y + 269, 30, 30}, 15, theme().text, 2);
  }

  const Rect focus_tile{panel.x + 16, panel.y + 306, w - 32, 38};
  canvas().fill_round_rect(focus_tile, 12,
                           focus_mode_ ? theme().success.with_alpha(50)
                                       : theme().panel_border.with_alpha(18));
  canvas().fill_circle(focus_tile.x + 18, focus_tile.cy(), 5,
                       focus_mode_ ? theme().success : theme().text_faint);
  canvas().draw_text(focus_tile.x + 34, focus_tile.y + 6, "Focus mode",
                     theme().text, 2);
  canvas().draw_text_right(focus_tile.right() - 12, focus_tile.cy() - 4,
                           focus_mode_ ? "on" : "off", theme().text_faint, 1);
}

void Shell::draw_spotlight() {
  if (!spotlight_open_) return;
  const int w = std::min(560, width() - 80);
  const int rows_h = static_cast<int>(spotlight_results_.size()) * 40;
  const int rows_top = 72;
  const Rect panel{width() / 2 - w / 2, 96, w, rows_top + rows_h + 34};
  canvas().dim(canvas().bounds(), 0.22f);
  frost_panel(panel, 18, theme().panel_strong, 18);
  canvas().stroke_round_rect(panel, 18, theme().panel_border, 1);

  const Rect field{panel.x + 16, panel.y + 14, panel.w - 32, 44};
  canvas().fill_round_rect(field, 12, theme().panel_border.with_alpha(20));
  canvas().stroke_round_rect(Rect{field.x + 14, field.y + 15, 12, 12}, 6, theme().text_dim, 2);
  canvas().fill(Rect{field.x + 24, field.y + 27, 7, 2}, theme().text_dim);
  const std::string shown = spotlight_query_.empty() ? "Search apps and commands" : spotlight_query_;
  canvas().draw_text(field.x + 40, field.y + 14, shown,
                     spotlight_query_.empty() ? theme().text_faint : theme().text, 2);
  if ((frames_ / 18) % 2 == 0) {
    const int cx = field.x + 40 + Surface::text_width(shown, 2);
    canvas().fill(Rect{cx + 2, field.y + 12, 2, 20}, theme().accent);
  }

  int y = panel.y + rows_top;
  for (size_t i = 0; i < spotlight_results_.size(); ++i) {
    const Rect row{panel.x + 8, y, panel.w - 16, 36};
    if (i == 0) canvas().fill_round_rect(row, 10, theme().selection);
    WindowKind kind = WindowKind::About;
    Color tint = theme().accent;
    for (const DockItem& item : dock_items_) {
      if (item.label == spotlight_results_[i]) {
        kind = item.kind;
        tint = item.tint;
      }
    }
    draw_icon(canvas(), Rect{row.x + 12, row.y + 6, 24, 24}, kind, tint, theme());
    canvas().draw_text(row.x + 46, row.y + 9, spotlight_results_[i], theme().text, 2);
    canvas().draw_text_right(row.right() - 12, row.y + 10, "open", theme().text_faint, 1);
    y += 40;
  }
  if (spotlight_results_.empty()) {
    canvas().draw_text(panel.x + 24, panel.y + rows_top + 8, "No matches", theme().text_faint, 2);
  }
  canvas().draw_text(panel.x + 18, panel.bottom() - 22, "↵ open    esc dismiss",
                     theme().text_faint, 1);
}

void Shell::draw_workspace_hud() {
  const std::string label = "Workspace " + std::to_string(workspace_ + 1) + " of " +
                            std::to_string(workspace_count_);
  const int tw = Surface::text_width(label, 2) + 36;
  const Rect pill{width() / 2 - tw / 2, 64, tw, 34};
  frost_panel(pill, 17, theme().panel_strong, 10);
  canvas().draw_text_center(pill, label, theme().text, 2);
}

void Shell::draw_cursor() {
  const int x = cursor_.x;
  const int y = cursor_.y;
  // Classic pointer: a solid wedge plus a tail, outlined for any backdrop.
  const int height = 18;
  const Rect clip = intersect(Rect{x, y, 18, height}, canvas().bounds());
  for (int row = 0; row < height; ++row) {
    int w;
    if (row < 12) {
      w = (row * 2) / 3 + 1;
    } else if (row < 15) {
      w = 6 + (row - 12) * 2;
    } else {
      w = 12 - (row - 15) * 3;
    }
    if (w <= 0) continue;
    const int px = x + 1 + (row >= 12 ? 0 : 0);
    const int py = y + row;
    if (py < clip.y || py >= clip.bottom()) continue;
    canvas().fill(Rect{px - 1, py, w + 2, 1}, Color(6, 9, 18, 190));
    canvas().fill(Rect{px, py, w, 1}, Color(250, 252, 255, 250));
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
void Shell::pointer_move(Point p) {
  cursor_ = p;
  pointer_inside_ = true;

  hover_menu_ = -1;
  if (p.y < kMenubarH) {
    const auto titles = menu_titles();
    for (size_t i = 0; i < titles.size(); ++i) {
      const int tw = Surface::text_width(titles[i].first, 2);
      if (p.x >= titles[i].second - 10 && p.x <= titles[i].second + tw + 10) {
        hover_menu_ = static_cast<int>(i);
        if (menu_open_) menu_index_ = hover_menu_;
      }
    }
  }

  hover_dock_ = -1;
  const Rect dock = comp_.dock_rect();
  if (dock.contains(p)) {
    for (size_t i = 0; i < dock_items_.size(); ++i) {
      if (dock_item_rect(static_cast<int>(i), true).contains(p) ||
          dock_item_rect(static_cast<int>(i), false).contains(p)) {
        hover_dock_ = static_cast<int>(i);
      }
    }
  }

  if (menu_open_) {
    const auto titles = menu_titles();
    const auto entries = build_menu(titles[static_cast<size_t>(std::max(0, menu_index_))].first);
    const Rect panel{titles[static_cast<size_t>(std::max(0, menu_index_))].second - 10,
                     kMenubarH + 4, 220, 0};
    int y = panel.y + 6;
    int index = 0;
    active_menu_item_ = -1;
    (void)entries;
    for (const MenuEntry& e : entries) {
      if (e.separator) {
        y += 9;
        continue;
      }
      if (p.y >= y && p.y < y + 24 && p.x >= panel.x && p.x <= panel.x + 400)
        active_menu_item_ = index;
      y += 26;
      ++index;
    }
  }

  if (comp_.pointer_move(p) < 0 && !cc_open_ && !spotlight_open_ && !menu_open_ &&
      !dock.contains(p) && p.y > kMenubarH) {
    comp_.pointer_move(p);
  }
}

void Shell::pointer_down(Point p) {
  pointer_move(p);

  if (spotlight_open_) {
    const int w = std::min(560, width() - 80);
    const int rows_top = 72;
    const Rect panel{width() / 2 - w / 2, 96, w,
                     rows_top + static_cast<int>(spotlight_results_.size()) * 40 + 34};
    if (panel.contains(p)) {
      const int idx = (p.y - (panel.y + rows_top)) / 40;
      if (p.y >= panel.y + rows_top && idx >= 0 &&
          idx < static_cast<int>(spotlight_results_.size())) {
        const std::string name = spotlight_results_[static_cast<size_t>(idx)];
        spotlight_open_ = false;
        open_app_named(name);
      }
    } else {
      spotlight_open_ = false;
    }
    return;
  }

  if (cc_open_) {
    const int w = 348;
    const Rect panel{width() - w - 14, kMenubarH + 10, w, 368};
    if (panel.contains(p)) {
      const int col = (p.x - panel.x - 16) / ((w - 44) / 2 + 8);
      const int row = (p.y - panel.y - 46) / 62;
      if (row >= 0 && row < 2 && col >= 0 && col < 2 && p.y < panel.y + 168) {
        const int index = row * 2 + col;
        if (index == 0) wifi_ = !wifi_;
        if (index == 1) bluetooth_ = !bluetooth_;
        if (index == 2) set_dark(!theme().dark);
        if (index == 3) set_glass(!theme().glass);
      }
      if (p.y >= panel.y + 186 && p.y <= panel.y + 206) {
        const f32 t = clampf(static_cast<f32>(p.x - panel.x - 18) / (w - 36), 0.f, 1.f);
        brightness_ = 0.3f + t * 0.7f;
      }
      if (p.y >= panel.y + 224 && p.y <= panel.y + 244) {
        volume_ = clampf(static_cast<f32>(p.x - panel.x - 18) / (w - 36), 0.f, 1.f);
      }
      if (p.y >= panel.y + 268 && p.y <= panel.y + 300) {
        const int idx = (p.x - panel.x - 30) / 38;
        if (idx >= 0 && idx < accent_count()) set_accent(idx);
      }
      if (p.y >= panel.y + 306) focus_mode_ = !focus_mode_;
    } else if (p.y > kMenubarH) {
      cc_open_ = false;
    }
    return;
  }

  if (menu_open_) {
    const int idx = active_menu_item_;
    if (idx >= 0) {
      run_menu_action(idx);
      return;
    }
    const auto titles = menu_titles();
    bool over_label = false;
    for (size_t i = 0; i < titles.size(); ++i) {
      const int tw = Surface::text_width(titles[i].first, 2);
      if (p.y < kMenubarH && p.x >= titles[i].second - 10 &&
          p.x <= titles[i].second + tw + 10) {
        over_label = true;
      }
    }
    if (!over_label) menu_open_ = false;
    if (!over_label) return;
  }

  if (p.y < kMenubarH) {
    const auto titles = menu_titles();
    for (size_t i = 0; i < titles.size(); ++i) {
      const int tw = Surface::text_width(titles[i].first, 2);
      if (p.x >= titles[i].second - 10 && p.x <= titles[i].second + tw + 10) {
        menu_open_ = true;
        menu_index_ = static_cast<int>(i);
        active_menu_item_ = -1;
        return;
      }
    }
    // Right cluster.
    int rx = width() - 14 - Surface::text_width(clock_, 2) - 18;
    if (Rect{rx - 26, 0, 26, kMenubarH}.contains(p)) {
      toggle_control_centre();
      return;
    }
    rx -= 34;
    if (Rect{rx - 26, 0, 26, kMenubarH}.contains(p)) {
      toggle_spotlight();
      return;
    }
    rx -= 34;
    const int pills_w = workspace_count_ * 18;
    if (p.x >= rx - pills_w && p.x <= rx) {
      const int idx = (p.x - (rx - pills_w)) / 18;
      set_workspace(idx);
      return;
    }
    return;
  }

  const Rect dock = comp_.dock_rect();
  if (dock.contains(p)) {
    for (size_t i = 0; i < dock_items_.size(); ++i) {
      if (dock_item_rect(static_cast<int>(i), true).contains(p) ||
          dock_item_rect(static_cast<int>(i), false).contains(p)) {
        const WindowKind kind = dock_items_[i].kind;
        if (window_for_kind(kind) >= 0 && window_workspace_[window_for_kind(kind)] == workspace_)
          focus_existing(kind);
        else
          open_app(kind);
        return;
      }
    }
    return;
  }

  comp_.pointer_down(p);
}

void Shell::pointer_up(Point p) {
  comp_.pointer_up(p);
  pointer_inside_ = true;
  cursor_ = p;
}

void Shell::key(const std::string& key_name) {
  if (boot_t_ < 1.f) return;

  if (spotlight_open_) {
    if (key_name == "Escape") {
      spotlight_open_ = false;
      return;
    }
    if (key_name == "Backspace") {
      if (!spotlight_query_.empty()) spotlight_query_.pop_back();
    } else if (key_name == "Enter") {
      launch_from_spotlight();
      return;
    } else if (key_name.size() == 1) {
      spotlight_query_ += key_name;
    }
    spotlight_results_.clear();
    for (const DockItem& item : dock_items_)
      if (contains_ci(item.label, spotlight_query_)) spotlight_results_.push_back(item.label);
    return;
  }

  if (key_name == "Escape") {
    cc_open_ = false;
    menu_open_ = false;
    return;
  }

  if (key_name.rfind("Meta+", 0) == 0) {
    const std::string rest = key_name.substr(5);
    if (rest == "Space") {
      toggle_spotlight();
      return;
    }
    if (rest == "w") {
      close_focused();
      return;
    }
    if (rest == "q") {
      close_focused();
      return;
    }
    if (rest == ",") {
      open_app(WindowKind::Settings);
      return;
    }
    if (rest == "Space") return;
    if (rest == "1") { set_workspace(0); return; }
    if (rest == "2") { set_workspace(1); return; }
    if (rest == "3") { set_workspace(2); return; }
    if (rest == "Tab") {
      const auto windows = comp_.windows();
      if (windows.size() > 1) comp_.focus_window(windows.front()->id());
      return;
    }
    if (rest == "Shift+L") {
      set_dark(!theme().dark);
      return;
    }
    if (rest == "Shift+A") {
      set_accent(theme().accent_index() + 1);
      return;
    }
    if (rest == "m") {
      if (Window* w = comp_.focused_window()) w->set_minimised(!w->minimised());
      return;
    }
  }

  comp_.key_press(key_name);
}

void Shell::scroll(Point p, int delta) {
  if (cc_open_ || spotlight_open_ || menu_open_) return;
  comp_.scroll(p, delta);
}

}  // namespace lumina
