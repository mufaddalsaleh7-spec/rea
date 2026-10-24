// Lumina OS — window model and compositor (C++17).
//
// The compositor owns the framebuffer, z-order, focus and the animation clock.
// It is deliberately free of scene knowledge: apps hand it a draw callback and
// the compositor decides *when* and *where* pixels land. The same object runs
// inside the kernel-backed root compositor and inside the host simulator.
// SPDX-License-Identifier: MIT
#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

#include "lumina/core.hpp"
#include "lumina/surface.hpp"
#include "lumina/theme.hpp"

namespace lumina {

enum class WindowKind {
  Files,
  Terminal,
  Notes,
  Settings,
  Monitor,
  About,
  Studio,
};

struct WindowSpec {
  WindowKind kind{WindowKind::Notes};
  std::string title;
  Rect frame{120, 120, 640, 420};
  int min_width{360};
  int min_height{220};
  bool resizable{true};
  int corner_radius{14};
};

struct RectChange {
  Rect before;
  Rect after;
  bool operator==(const RectChange& o) const { return before == o.before && after == o.after; }
};

// Input events travel in surface coordinates (already de-normalised by the
// caller). The compositor handles chrome, the app handles content.
struct InputEvent {
  enum class Type { PointerDown, PointerMove, PointerUp, Key, Scroll, WindowClose } type{
      Type::PointerMove};
  Point pos;
  int button{0};
  int wheel{0};
  std::string key;
};

class Application {
 public:
  virtual ~Application() = default;
  virtual void draw(Surface& s, Rect content, const Theme& theme) = 0;
  virtual void on_pointer(Point /*p*/, InputEvent::Type /*type*/, int /*button*/,
                          Rect /*content*/) {}
  virtual void on_key(const std::string& /*key*/, Rect /*content*/) {}
  virtual void on_scroll(Point /*p*/, int /*delta*/, Rect /*content*/) {}
  virtual std::string status() const { return {}; }
};

class Window {
 public:
  Window(int id, WindowSpec spec, Application* app);
  ~Window();

  int id() const { return id_; }
  const WindowSpec& spec() const { return spec_; }
  WindowSpec& spec() { return spec_; }
  Application* app() const { return app_; }
  Rect frame() const { return frame_; }
  void set_frame(Rect r);
  Rect content_rect() const;
  Rect titlebar_rect() const;
  bool visible() const { return visible_; }
  void set_visible(bool v) { visible_ = v; }
  bool focused() const { return focused_; }
  void set_focused(bool f) { focused_ = f; }
  f32 opacity() const { return opacity_; }
  void set_opacity(f32 v) { opacity_ = clampf(v, 0.f, 1.f); }
  bool closing() const { return closing_; }
  void begin_close();
  // 0 = fully open, 1 = fully closed. Drives the close animation.
  f32 close_progress() const { return close_t_; }
  void animate(f32 dt_ms);
  RectChange advance_open_animation(f32 dt_ms);
  void begin_open();
  bool opening() const { return open_t_ < 1.f; }
  bool minimised() const { return minimised_; }
  void set_minimised(bool m) { minimised_ = m; }
  void set_anim_scale(Rect from_rect);

  // Hit testing against chrome, in z-ordered surface space.
  enum class Zone { None, Titlebar, Content, Close, Minimise, Zoom, ResizeSE, ResizeE, ResizeS };
  Zone zone_at(Point p) const;

 private:
  int id_{0};
  WindowSpec spec_{};
  Application* app_{nullptr};
  Rect frame_{};
  Rect open_from_{};
  f32 open_t_{1.f};
  f32 close_t_{0.f};
  f32 opacity_{1.f};
  bool visible_{true};
  bool focused_{false};
  bool closing_{false};
  bool minimised_{false};
};

struct DockItem {
  std::string label;
  WindowKind kind;
  Color tint;
  bool running{false};
};

class Compositor {
 public:
  Compositor(int width, int height);

  void resize(int width, int height);
  Surface& canvas() { return canvas_; }
  const Surface& canvas() const { return canvas_; }
  int width() const { return canvas_.width(); }
  int height() const { return canvas_.height(); }

  Theme& theme() { return theme_; }
  const Theme& theme() const { return theme_; }
  void set_appearance(bool dark);

  Window& add_window(WindowSpec spec, Application* app);
  void close_window(int id);
  void focus_window(int id);
  Window* find(int id);
  const std::vector<Window*>& windows() const { return z_order_; }
  std::vector<Window*> windows_snapshot() const { return z_order_; }
  // Every live window, front-to-back order irrelevant (used for bulk actions).
  std::vector<Window*> owned_snapshot() const { return owned_; }
  Window* topmost_at(Point p);
  Window* focused_window() const;

  // Pointer routing. Returns the id of the window that consumed the event or -1.
  int pointer_down(Point p);
  int pointer_move(Point p);
  int pointer_up(Point p);
  int key_press(const std::string& key);
  int scroll(Point p, int delta);

  void tick(f32 dt_ms);
  void render();

  // Menubar metrics are shared with the shell so hit-testing and drawing agree.
  Rect menubar_rect() const { return Rect{0, 0, width(), 32}; }
  Rect dock_rect() const;

  u64 frames_rendered() const { return frames_; }
  bool animating() const;

 private:
  // Paints one window's chrome + app content into `dst` at frame `f`.
  // `alpha_mul` scales every alpha channel (used by the close fade).
  void paint_window(Surface& dst, Window& w, Rect f, f32 alpha_mul);
  void drop_dead_windows();

  Surface canvas_;
  Theme theme_{Theme::dark_theme()};
  int next_id_{1};
  int focused_id_{-1};
  std::vector<Window*> z_order_;   // back to front
  std::vector<Window*> owned_;     // lifetime container
  int drag_window_{-1};
  Window::Zone drag_zone_{Window::Zone::None};
  Point drag_origin_{};
  Rect drag_start_frame_{};
  u64 frames_{0};
  f32 clock_ms_{0.f};
};

}  // namespace lumina
