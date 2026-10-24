// Lumina OS — compositor: z-order, focus, drag/resize, glass and motion.
// SPDX-License-Identifier: MIT
#include "lumina/compositor.hpp"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <utility>

namespace lumina {
namespace {

constexpr int kTitlebarH = 38;

inline f32 sd_round_box(f32 px, f32 py, f32 half_w, f32 half_h, f32 radius) {
  const f32 qx = std::fabs(px) - half_w + radius;
  const f32 qy = std::fabs(py) - half_h + radius;
  const f32 ax = qx > 0.f ? qx : 0.f;
  const f32 ay = qy > 0.f ? qy : 0.f;
  return std::sqrt(ax * ax + ay * ay) + std::min(std::max(qx, qy), 0.f) - radius;
}

inline u8 fade(u8 a, f32 mul) {
  return static_cast<u8>(clampf(static_cast<f32>(a) * mul + 0.5f, 0.f, 255.f));
}

// Blit an app content surface, masking the four rounded corners so app pixels
// never bleed outside the window silhouette.
void blit_rounded(Surface& dst, const Surface& src, int dx, int dy, Rect win, int radius,
                  f32 alpha_mul = 1.f) {
  const int rad = clampi(radius, 0, std::min(win.w, win.h) / 2);
  for (int y = 0; y < src.height(); ++y) {
    const int wy = dy + y;
    if (wy < 0 || wy >= dst.height()) continue;
    const bool band = wy < win.y + rad || wy >= win.bottom() - rad;
    if (!band && alpha_mul >= 1.f) {
      const int x0 = std::max(0, -dx);
      const int x1 = std::min(src.width(), dst.width() - dx);
      if (x1 <= x0) continue;
      std::memcpy(dst.row(wy) + dx + x0,
                  src.data() + static_cast<size_t>(y) * src.width() + x0,
                  static_cast<size_t>(x1 - x0) * sizeof(u32));
      continue;
    }
    for (int x = 0; x < src.width(); ++x) {
      const int wx = dx + x;
      if (wx < 0 || wx >= dst.width()) continue;
      f32 cov = 1.f;
      if (band) {
        cov = clampf(0.5f - sd_round_box(static_cast<f32>(wx) + 0.5f - (win.x + win.w * 0.5f),
                                         static_cast<f32>(wy) + 0.5f - (win.y + win.h * 0.5f),
                                         win.w * 0.5f, win.h * 0.5f, static_cast<f32>(rad)),
                     0.f, 1.f);
        if (cov <= 0.f) continue;
      }
      const u32 p = src.data()[static_cast<size_t>(y) * src.width() + x];
      const f32 a = ((p >> 24) & 0xFF) * cov * alpha_mul;
      dst.blend(wx, wy, Color::from_argb(p).with_alpha(static_cast<u8>(clampf(a, 0.f, 255.f))));
    }
  }
}

}  // namespace

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
Window::Window(int id, WindowSpec spec, Application* app)
    : id_(id), spec_(std::move(spec)), app_(app), frame_(spec_.frame) {}

Window::~Window() = default;

void Window::set_frame(Rect r) {
  spec_.frame = r;
  frame_ = r;
}

Rect Window::titlebar_rect() const { return Rect{frame_.x, frame_.y, frame_.w, kTitlebarH}; }

Rect Window::content_rect() const {
  const int h = frame_.h - kTitlebarH;
  return Rect{frame_.x, frame_.y + kTitlebarH, frame_.w, h > 0 ? h : 0};
}

void Window::begin_close() {
  if (closing_) return;
  closing_ = true;
  close_t_ = 0.f;
}

void Window::begin_open() {
  open_t_ = 0.f;
  const int w = static_cast<int>(frame_.w * 0.72f);
  const int h = static_cast<int>(frame_.h * 0.72f);
  open_from_ = Rect{frame_.x + (frame_.w - w) / 2, frame_.y + (frame_.h - h) / 2, w, h};
}

void Window::set_anim_scale(Rect from_rect) {
  open_t_ = 0.f;
  open_from_ = from_rect;
}

void Window::animate(f32 dt_ms) {
  if (!closing_) return;
  close_t_ = clampf(close_t_ + dt_ms / 170.f, 0.f, 1.f);
  opacity_ = 1.f - ease_out_cubic(close_t_);
  if (close_t_ >= 1.f) visible_ = false;
}

RectChange Window::advance_open_animation(f32 dt_ms) {
  const Rect before = frame_;
  if (open_t_ >= 1.f) return RectChange{before, before};
  open_t_ = clampf(open_t_ + dt_ms / 240.f, 0.f, 1.f);
  const f32 t = ease_out_back(open_t_);
  auto lerp_i = [t](int a, int b) { return a + iround(static_cast<f32>(b - a) * t); };
  frame_ = Rect{lerp_i(open_from_.x, spec_.frame.x), lerp_i(open_from_.y, spec_.frame.y),
                lerp_i(open_from_.w, spec_.frame.w), lerp_i(open_from_.h, spec_.frame.h)};
  return RectChange{before, frame_};
}

Window::Zone Window::zone_at(Point p) const {
  if (!frame_.contains(p)) return Zone::None;
  constexpr int edge = 8;
  if (p.x >= frame_.right() - edge && p.y >= frame_.bottom() - edge) return Zone::ResizeSE;
  if (p.x >= frame_.right() - edge) return Zone::ResizeE;
  if (p.y >= frame_.bottom() - edge) return Zone::ResizeS;
  if (p.y < frame_.y + kTitlebarH) {
    const int lights_y = frame_.y + kTitlebarH / 2;
    const int lx = frame_.x + 18;
    auto near = [&](int cx) {
      const int dx = p.x - cx;
      const int dy = p.y - lights_y;
      return dx * dx + dy * dy <= 100;
    };
    if (near(lx)) return Zone::Close;
    if (near(lx + 22)) return Zone::Minimise;
    if (near(lx + 44)) return Zone::Zoom;
    return Zone::Titlebar;
  }
  return Zone::Content;
}

// ---------------------------------------------------------------------------
// Compositor
// ---------------------------------------------------------------------------
Compositor::Compositor(int width, int height) : canvas_(width, height) {
  theme_.set_accent_index(0);
}

void Compositor::resize(int width, int height) { canvas_.resize(width, height); }

void Compositor::set_appearance(bool dark) { theme_.set_appearance(dark); }

Window& Compositor::add_window(WindowSpec spec, Application* app) {
  auto* w = new Window(next_id_++, std::move(spec), app);
  owned_.push_back(w);
  z_order_.push_back(w);
  w->begin_open();
  focused_id_ = w->id();
  for (Window* other : z_order_) other->set_focused(other->id() == focused_id_);
  return *w;
}

void Compositor::close_window(int id) {
  if (Window* w = find(id)) w->begin_close();
}

Window* Compositor::find(int id) {
  for (Window* w : z_order_)
    if (w->id() == id) return w;
  return nullptr;
}

void Compositor::focus_window(int id) {
  auto it =
      std::find_if(z_order_.begin(), z_order_.end(), [id](Window* w) { return w->id() == id; });
  if (it == z_order_.end()) return;
  Window* w = *it;
  z_order_.erase(it);
  z_order_.push_back(w);
  focused_id_ = id;
  for (Window* other : z_order_) other->set_focused(other->id() == focused_id_);
}

Window* Compositor::focused_window() const {
  return const_cast<Compositor*>(this)->find(focused_id_);
}

Window* Compositor::topmost_at(Point p) {
  for (auto it = z_order_.rbegin(); it != z_order_.rend(); ++it) {
    Window* w = *it;
    if (w->visible() && !w->minimised() && !w->closing() && w->frame().contains(p)) return w;
  }
  return nullptr;
}

Rect Compositor::dock_rect() const {
  const int items = 7;
  const int item_w = 62;
  const int w = items * item_w + 28;
  const int h = 78;
  return Rect{(width() - w) / 2, height() - h - 18, w, h};
}

int Compositor::pointer_down(Point p) {
  Window* w = topmost_at(p);
  drag_window_ = -1;
  if (!w) {
    focused_id_ = -1;
    for (Window* other : z_order_) other->set_focused(false);
    return -1;
  }
  focus_window(w->id());
  switch (w->zone_at(p)) {
    case Window::Zone::Close:
      w->begin_close();
      return w->id();
    case Window::Zone::Minimise:
      w->set_minimised(true);
      return w->id();
    case Window::Zone::Zoom:
      w->set_frame(Rect{40, 52, width() - 80, height() - 52 - 110});
      return w->id();
    case Window::Zone::Titlebar:
    case Window::Zone::ResizeSE:
    case Window::Zone::ResizeE:
    case Window::Zone::ResizeS:
      drag_window_ = w->id();
      drag_zone_ = w->zone_at(p);
      drag_origin_ = p;
      drag_start_frame_ = w->frame();
      return w->id();
    case Window::Zone::Content:
      w->app()->on_pointer(p, InputEvent::Type::PointerDown, 0, w->content_rect());
      return w->id();
    default:
      return w->id();
  }
}

int Compositor::pointer_move(Point p) {
  if (drag_window_ < 0) {
    if (Window* w = topmost_at(p); w && w->zone_at(p) == Window::Zone::Content)
      w->app()->on_pointer(p, InputEvent::Type::PointerMove, 0, w->content_rect());
    return -1;
  }
  Window* w = find(drag_window_);
  if (!w) {
    drag_window_ = -1;
    return -1;
  }
  const int dx = p.x - drag_origin_.x;
  const int dy = p.y - drag_origin_.y;
  Rect r = drag_start_frame_;
  switch (drag_zone_) {
    case Window::Zone::Titlebar:
      r.x = std::max(120 - r.w, std::min(width() - 120, drag_start_frame_.x + dx));
      r.y = std::max(32, std::min(height() - 80, drag_start_frame_.y + dy));
      break;
    case Window::Zone::ResizeE:
      r.w = std::max(w->spec().min_width, drag_start_frame_.w + dx);
      break;
    case Window::Zone::ResizeS:
      r.h = std::max(w->spec().min_height, drag_start_frame_.h + dy);
      break;
    case Window::Zone::ResizeSE:
      r.w = std::max(w->spec().min_width, drag_start_frame_.w + dx);
      r.h = std::max(w->spec().min_height, drag_start_frame_.h + dy);
      break;
    default:
      break;
  }
  w->set_frame(r);
  return w->id();
}

int Compositor::pointer_up(Point p) {
  int id = -1;
  if (drag_window_ >= 0) {
    id = drag_window_;
    if (Window* w = find(id)) {
      if (drag_zone_ == Window::Zone::Titlebar) {
        // Magnetic top edge: a dragged titlebar reflows to full width.
        Rect f = w->frame();
        if (f.y <= 44) {
          f.x = 0;
          f.w = width();
          w->set_frame(f);
        }
      }
    }
  } else if (Window* w = topmost_at(p)) {
    id = w->id();
    if (w->zone_at(p) == Window::Zone::Content)
      w->app()->on_pointer(p, InputEvent::Type::PointerUp, 0, w->content_rect());
  }
  drag_window_ = -1;
  drag_zone_ = Window::Zone::None;
  return id;
}

int Compositor::key_press(const std::string& key) {
  Window* w = focused_window();
  if (!w) return -1;
  w->app()->on_key(key, w->content_rect());
  return w->id();
}

int Compositor::scroll(Point p, int delta) {
  Window* w = topmost_at(p);
  if (!w) return -1;
  w->app()->on_scroll(p, delta, w->content_rect());
  return w->id();
}

void Compositor::tick(f32 dt_ms) {
  clock_ms_ += dt_ms;
  for (Window* w : owned_) {
    w->animate(dt_ms);
    if (w->opening() && !w->closing()) w->advance_open_animation(dt_ms);
  }
  drop_dead_windows();
}

void Compositor::drop_dead_windows() {
  for (auto it = owned_.begin(); it != owned_.end();) {
    Window* w = *it;
    if (w->closing() && w->close_progress() >= 1.f && !w->visible()) {
      z_order_.erase(std::remove(z_order_.begin(), z_order_.end(), w), z_order_.end());
      if (focused_id_ == w->id()) focused_id_ = z_order_.empty() ? -1 : z_order_.back()->id();
      delete w;
      it = owned_.erase(it);
    } else {
      ++it;
    }
  }
  (void)clock_ms_;
}

bool Compositor::animating() const {
  for (Window* w : owned_)
    if (w->opening() || w->closing()) return true;
  return false;
}

void Compositor::render() {
  ++frames_;
  for (Window* w : owned_) {
    if (!w->visible() || w->minimised()) continue;
    const Rect f = w->frame();
    if (f.w < 120 || f.h < 90) continue;
    if (w->opacity() >= 0.999f) {
      paint_window(canvas_, *w, f, 1.f);
    } else {
      Surface layer(f.w, f.h);
      layer.clear(Color(0, 0, 0, 0));
      paint_window(layer, *w, Rect{0, 0, f.w, f.h}, 1.f);
      // Fade the composed layer over the backdrop.
      const f32 op = w->opacity();
      for (int y = 0; y < layer.height(); ++y) {
        const int ty = f.y + y;
        if (ty < 0 || ty >= canvas_.height()) continue;
        for (int x = 0; x < layer.width(); ++x) {
          const int tx = f.x + x;
          if (tx < 0 || tx >= canvas_.width()) continue;
          u32 p = layer.data()[static_cast<size_t>(y) * layer.width() + x];
          const u8 a = static_cast<u8>((p >> 24) & 0xFF);
          if (a == 0) continue;
          canvas_.blend(tx, ty, Color::from_argb(p).with_alpha(fade(a, op)));
        }
      }
    }
  }
}

void Compositor::paint_window(Surface& dst, Window& w, Rect f, f32 alpha_mul) {
  const int rad = w.spec().corner_radius;
  const bool focused = w.focused();
  const Rect content = Rect{f.x, f.y + kTitlebarH, f.w, f.h - kTitlebarH};

  auto tint = [&](Color c) { return c.with_alpha(fade(c.a, alpha_mul)); };

  // 1. Ambient shadow (cached mask, so this is a single blit).
  dst.shadow(Rect{f.x, f.y + 8, f.w, f.h}, rad, tint(theme_.shadow), 30, 0);

  // 2. Opaque app surface with a soft vertical sheen.
  dst.fill_round_rect(f, rad, tint(theme_.window_bg));
  dst.vertical_gradient(Rect{f.x, f.y, f.w, std::min(f.h, kTitlebarH + 10)}, tint(Color(255, 255, 255, 16)),
                        tint(Color(255, 255, 255, 0)));

  // 3. Titlebar band: slightly lighter, top-rounded only.
  dst.fill_round_rect(Rect{f.x, f.y, f.w, kTitlebarH + rad}, rad, tint(theme_.titlebar));
  dst.fill(Rect{f.x, f.y + kTitlebarH, f.w, rad}, tint(theme_.window_bg));

  // 4. App content, clipped to the rounded silhouette.
  if (w.app() && content.w > 0 && content.h > 0) {
    Surface content_surface(content.w, content.h);
    content_surface.clear(theme_.window_bg);
    w.app()->draw(content_surface, Rect{0, 0, content.w, content.h}, theme_);
    blit_rounded(dst, content_surface, content.x, content.y, f, rad, alpha_mul);
  }

  // 5. Hairline under the titlebar and the outer border.
  dst.fill(Rect{f.x + 1, f.y + kTitlebarH - 1, f.w - 2, 1}, tint(theme_.hairline));
  dst.stroke_round_rect(f, rad, tint(focused ? theme_.accent_soft : theme_.window_border),
                        1);

  // 6. Traffic lights.
  const int ly = f.y + kTitlebarH / 2;
  const int lx = f.x + 18;
  const Color lights[3] = {theme_.close, theme_.minimize, theme_.zoom};
  for (int i = 0; i < 3; ++i) {
    const int cx = lx + i * 22;
    const Color base = focused ? lights[i] : mix(lights[i], theme_.text_faint, 0.55f);
    dst.fill_circle(cx, ly, 6, tint(base));
    dst.fill_circle(cx - 1, ly - 1, 3, tint(Color(255, 255, 255, 42)));
  }

  // 7. Title, centred; app status at the trailing edge.
  const std::string title = w.spec().title;
  const Rect title_area{f.x + 92, f.y, f.w - 184, kTitlebarH};
  if (title_area.w > 40)
    dst.draw_text_center(title_area, title, tint(focused ? theme_.text : theme_.text_faint), 2);
  if (w.app()) {
    const std::string status = w.app()->status();
    if (!status.empty() && f.w > 520)
      dst.draw_text_right(f.right() - 16, f.y + (kTitlebarH - 16) / 2, status,
                          tint(theme_.text_faint), 2);
  }

  // 8. Resize affordance.
  if (w.spec().resizable) {
    const Color grip = tint(theme_.text_faint.with_alpha(150));
    for (int i = 0; i < 3; ++i) {
      const int x = f.right() - 6 - i * 4;
      const int y = f.bottom() - 6;
      dst.fill(Rect{x, y - i * 4, 2, 2}, grip);
    }
  }
}

}  // namespace lumina
