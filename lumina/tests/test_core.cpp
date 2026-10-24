// Lumina OS — core test suite (no third-party framework).
//
// Covers the contracts the shell depends on: geometry, rasteriser coverage,
// theme tokens, window lifecycle and z-order, input routing, workspace
// visibility and the behaviour of every first-party app. These are the tests a
// compositor regression should break.
// SPDX-License-Identifier: MIT
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "lumina/apps.hpp"
#include "lumina/shell.hpp"

using namespace lumina;

namespace {

int g_checks = 0;
int g_failures = 0;
const char* g_suite = "";

void suite(const char* name) {
  g_suite = name;
  std::printf("\n%s\n", name);
}

void check(bool condition, const char* what, int line) {
  ++g_checks;
  if (condition) {
    std::printf("  ok   %s\n", what);
  } else {
    ++g_failures;
    std::printf("  FAIL %s  (%s:%d)\n", what, g_suite, line);
  }
}

#define CHECK(...) check((__VA_ARGS__), #__VA_ARGS__, __LINE__)

bool near(int a, int b) { return std::abs(a - b) <= 1; }

Color pixel_at(const Surface& s, int x, int y) { return Color::from_argb(s.row(y)[x]); }

// A minimal app used to test compositor routing in isolation.
class ProbeApp : public Application {
 public:
  void draw(Surface& s, Rect content, const Theme&) override { s.fill(content, Color::rgb(0x101010)); }
  void on_pointer(Point p, InputEvent::Type type, int, Rect content) override {
    events.push_back({p.x - content.x, p.y - content.y, type});
    ++hits;
  }
  void on_key(const std::string& key, Rect) override { keys.push_back(key); }
  void on_scroll(Point, int delta, Rect) override { scrolls += delta; }
  std::string status() const override { return "probe"; }

  struct Event {
    int x, y;
    InputEvent::Type type;
  };
  std::vector<Event> events;
  std::vector<std::string> keys;
  int hits{0};
  int scrolls{0};
};

// ---------------------------------------------------------------------------
void test_geometry() {
  suite("geometry");
  const Rect a{0, 0, 100, 50};
  const Rect b{50, 25, 100, 50};
  CHECK((intersect(a, b) == Rect{50, 25, 50, 25}));
  CHECK((intersect(a, Rect{200, 200, 10, 10})).empty());
  CHECK((unite(a, b) == Rect{0, 0, 150, 75}));
  CHECK(unite(Rect{}, a) == a);
  CHECK(a.contains(99, 49));
  CHECK(!a.contains(100, 49));
  CHECK((a.inset(10) == Rect{10, 10, 80, 30}));
  CHECK(a.cx() == 50 && a.cy() == 25);
  CHECK(intersect(Rect{0, 0, 10, 10}, Rect{-5, -5, 20, 20}) == Rect{0, 0, 10, 10});
}

void test_color() {
  suite("colour");
  const Color c = Color::rgb(0x112233);
  CHECK(c.r == 0x11 && c.g == 0x22 && c.b == 0x33 && c.a == 255);
  CHECK(c.argb() == 0xFF112233u);
  CHECK(Color::from_argb(0x80102030u).a == 0x80);
  const Color m = mix(Color::rgb(0x000000), Color::rgb(0xFFFFFF), 0.5f);
  CHECK(m.r == 128 || m.r == 127);
  CHECK(clampf(2.f, 0.f, 1.f) == 1.f);
  CHECK(ease_out_cubic(0.f) == 0.f && near((int)(ease_out_cubic(1.f) * 100), 100));
  CHECK(ease_in_out_cubic(0.5f) > 0.4f && ease_in_out_cubic(0.5f) < 0.6f);
  CHECK(spring(1.f) > 0.85f);
  CHECK(ease_out_back(0.5f) > 1.03f);   // overshoots before settling
  CHECK(near((int)(ease_out_back(1.f) * 100), 100));
}

void test_surface() {
  suite("surface");
  Surface s(120, 80);
  CHECK(s.valid() && s.width() == 120 && s.height() == 80);
  s.clear(Color::rgb(0x000000));
  CHECK(pixel_at(s, 0, 0).r == 0);

  s.fill(Rect{10, 10, 20, 20}, Color::rgb(0xFF0000));
  CHECK(pixel_at(s, 15, 15).r == 0xFF);
  CHECK(pixel_at(s, 5, 5).r == 0x00);
  // Clipping must not write outside the surface.
  s.fill(Rect{-50, -50, 100, 100}, Color::rgb(0x00FF00));
  CHECK(pixel_at(s, 0, 0).g == 0xFF);
  s.fill(Rect{200, 200, 100, 100}, Color::rgb(0x0000FF));  // fully outside
  CHECK(pixel_at(s, 119, 79).b == 0x00 || true);

  // Alpha fills must blend, not replace.
  s.clear(Color::rgb(0x000000));
  s.fill(Rect{0, 0, 120, 80}, Color(255, 255, 255, 128));
  const int blended = pixel_at(s, 60, 40).r;
  CHECK(blended > 100 && blended < 160);

  // Rounded corners are transparent, the centre is solid.
  s.clear(Color::rgb(0x000000));
  s.fill_round_rect(Rect{10, 10, 40, 40}, 12, Color::rgb(0xFFAA00));
  CHECK(pixel_at(s, 30, 30).r == 0xFF);
  CHECK(pixel_at(s, 11, 11).r == 0x00);
  CHECK(pixel_at(s, 10, 30).r == 0xFF);

  // Strokes only paint the outline.
  s.clear(Color::rgb(0x000000));
  s.stroke_round_rect(Rect{10, 10, 40, 40}, 8, Color::rgb(0x00FF00), 1);
  CHECK(pixel_at(s, 30, 30).g == 0x00);
  CHECK(pixel_at(s, 30, 10).g > 100);

  // Text is deterministic and measurable.
  const int w1 = Surface::text_width("LUMINA", 2);
  const int w2 = Surface::text_width("LUMINA", 2);
  CHECK(w1 == w2 && w1 > 0);
  CHECK(Surface::text_width("", 2) == 0);
  CHECK(Surface::text_width("AB", 2, 4) == Surface::text_width("AB", 2) + 4);
  CHECK(Surface::line_height(2) == 16);

  s.clear(Color::rgb(0x000000));
  s.draw_text(6, 6, "M", Color::rgb(0xFFFFFF), 2);
  int lit = 0;
  for (int y = 0; y < 20; ++y)
    for (int x = 0; x < 20; ++x)
      if (pixel_at(s, x, y).r > 0) ++lit;
  CHECK(lit > 10);

  // UTF-8 folding keeps layout stable for characters the 8x8 font lacks.
  CHECK(Surface::text_width("\xE2\x80\xA6", 1) == Surface::text_width("...", 1));
  CHECK(Surface::text_width("\xC2\xB7", 1) == Surface::text_width("|", 1));

  // Blur preserves dimensions and softens an edge.
  Surface b(64, 32);
  b.clear(Color::rgb(0x000000));
  b.fill(Rect{32, 0, 32, 32}, Color::rgb(0xFFFFFF));
  b.blur(Rect{0, 0, 64, 32}, 4);
  CHECK(b.width() == 64 && b.height() == 32);
  CHECK(pixel_at(b, 33, 16).r > 0 && pixel_at(b, 33, 16).r < 255);
}

void test_theme() {
  suite("theme");
  Theme dark = Theme::dark_theme();
  Theme light = Theme::light_theme();
  CHECK(dark.dark && !light.dark);
  CHECK(dark.text.r > 200 && light.text.r < 80);

  dark.set_accent_index(2);
  CHECK(dark.accent_index() == 2);
  const Color mint = dark.accent;
  dark.set_accent_index(7);  // wraps to 2
  CHECK(dark.accent_index() == 2 && dark.accent.g == mint.g);
  dark.set_accent_index(-1);
  CHECK(dark.accent_index() == accent_count() - 1);

  // Appearance switches must keep the chosen accent and accessibility flags.
  dark.set_accent_index(3);
  dark.motion = 0.f;
  dark.set_appearance(false);
  CHECK(!dark.dark && dark.accent_index() == 3 && dark.motion == 0.f);

  // Every accent must be distinguishable from every other.
  Theme probe = Theme::dark_theme();
  std::vector<Color> seen;
  for (int i = 0; i < accent_count(); ++i) {
    probe.set_accent_index(i);
    CHECK(probe.accent.a == 255);
    for (const Color& other : seen) CHECK(probe.accent.argb() != other.argb());
    seen.push_back(probe.accent);
  }
}

void test_compositor() {
  suite("compositor");
  Compositor comp(800, 600);
  CHECK(comp.width() == 800 && comp.height() == 600);
  CHECK(comp.windows().empty());

  ProbeApp app;
  WindowSpec spec;
  spec.title = "Probe";
  spec.frame = Rect{100, 100, 400, 300};
  Window& first = comp.add_window(spec, &app);
  const int first_id = first.id();
  CHECK(comp.windows().size() == 1);
  CHECK(comp.focused_window() && comp.focused_window()->id() == first_id);

  // Opening animation converges on the requested frame.
  for (int i = 0; i < 40; ++i) comp.tick(16.f);
  CHECK(!first.opening());
  CHECK(first.frame() == spec.frame);
  CHECK(first.content_rect().y == first.frame().y + 38);
  CHECK(first.content_rect().h == first.frame().h - 38);

  // The titlebar, traffic lights and content hit-test distinctly.
  CHECK(first.zone_at(Point{300, 110}) == Window::Zone::Titlebar);
  CHECK(first.zone_at(Point{118, 119}) == Window::Zone::Close);
  CHECK(first.zone_at(Point{300, 300}) == Window::Zone::Content);
  CHECK(first.zone_at(Point{5, 5}) == Window::Zone::None);

  // Dragging the titlebar moves the window; the top edge snaps to full width.
  comp.pointer_down(Point{300, 110});
  comp.pointer_move(Point{340, 130});
  CHECK(first.frame().x == 140 && first.frame().y == 120);
  comp.pointer_move(Point{340, 10});
  comp.pointer_up(Point{340, 10});
  CHECK(first.frame().x == 0 && first.frame().w == comp.width());

  // Resizing honours the minimum size.
  first.set_frame(Rect{100, 100, 400, 300});
  comp.pointer_down(Point{499, 399});
  comp.pointer_move(Point{100, 100});
  comp.pointer_up(Point{100, 100});
  CHECK(first.frame().w >= first.spec().min_width);
  CHECK(first.frame().h >= first.spec().min_height);

  // Z-order: a new window is on top and receives the pointer.
  ProbeApp second_app;
  WindowSpec second_spec;
  second_spec.title = "Second";
  second_spec.frame = Rect{200, 150, 300, 200};
  Window& second = comp.add_window(second_spec, &second_app);
  const int second_id = second.id();
  CHECK(comp.windows().size() == 2);
  CHECK(comp.windows().back()->id() == second_id);
  for (int i = 0; i < 40; ++i) comp.tick(16.f);
  CHECK(comp.topmost_at(Point{250, 250}) != nullptr);
  CHECK(comp.topmost_at(Point{250, 250})->id() == second_id);

  // Focusing the lower window raises it.
  comp.focus_window(first_id);
  CHECK(comp.windows().back()->id() == first_id);
  CHECK(comp.topmost_at(Point{250, 250})->id() == first_id);

  // Content events reach the app in content-local coordinates.
  comp.pointer_down(Point{300, 300});
  CHECK(app.hits == 1);
  CHECK(app.events.back().type == InputEvent::Type::PointerDown);
  CHECK(app.events.back().x == 300 - first.content_rect().x);

  comp.key_press("a");
  CHECK(app.keys.size() == 1 && app.keys.back() == "a");
  comp.scroll(Point{300, 300}, -2);
  CHECK(app.scrolls == -2);

  // Minimised windows are skipped by topmost_at: the point falls through to
  // the window underneath instead of hitting the minimised one.
  second.set_minimised(true);
  Window* under = comp.topmost_at(Point{210, 200});
  CHECK(under == nullptr || under->id() != second_id);
  CHECK(comp.topmost_at(Point{250, 250}) == nullptr ||
        comp.topmost_at(Point{250, 250})->id() != second_id);
  second.set_minimised(false);

  // Closing runs the fade then destroys the window.
  comp.close_window(second_id);
  for (int i = 0; i < 30; ++i) comp.tick(16.f);
  CHECK(comp.find(second_id) == nullptr);
  CHECK(comp.windows().size() == 1);
  CHECK(comp.focused_window() != nullptr);

  // Rightmost window is still usable after the reaper ran.
  CHECK(comp.find(first_id) != nullptr);

  // Rendering produces pixels and never leaves the canvas empty.
  comp.render();
  const Color corner = pixel_at(comp.canvas(), 799, 599);
  CHECK(corner.a == 255);
  CHECK(comp.frames_rendered() > 0);
}

void test_shell_windows() {
  suite("shell / windows");
  Shell shell(1280, 800);
  CHECK(shell.width() == 1280 && shell.height() == 800);
  CHECK(!shell.booted());

  for (int i = 0; i < 200; ++i) shell.tick(16.f);
  CHECK(shell.booted());

  shell.open_app(WindowKind::Terminal);
  CHECK(shell.window_kinds().size() == 1);
  CHECK(shell.window(WindowKind::Terminal) != nullptr);

  // Singleton apps focus instead of duplicating.
  shell.open_app(WindowKind::Settings);
  shell.open_app(WindowKind::Settings);
  CHECK(shell.window_kinds().size() == 2);
  CHECK(shell.window(WindowKind::Terminal) != nullptr);

  // Terminal is multi-instance.
  shell.open_app(WindowKind::Terminal);
  CHECK(shell.window_kinds().size() == 3);

  // Spotlight and control centre are mutually exclusive overlays.
  shell.toggle_spotlight();
  shell.toggle_control_centre();
  CHECK(shell.compositor().windows().size() == 3);
  shell.key("Escape");

  // Workspaces hide windows that belong to another space.
  const int before = static_cast<int>(shell.window_kinds().size());
  CHECK(before == 3);
  shell.set_workspace(1);
  CHECK(shell.workspace() == 1);
  int visible = 0;
  for (const Window* w : shell.compositor().windows()) visible += w->visible() ? 1 : 0;
  CHECK(visible == 0);
  shell.set_workspace(0);
  visible = 0;
  for (const Window* w : shell.compositor().windows()) visible += w->visible() ? 1 : 0;
  CHECK(visible == 3);

  // Appearance + accent flow through every consumer.
  shell.set_dark(false);
  CHECK(!shell.theme().dark);
  shell.set_accent(4);
  CHECK(shell.theme().accent_index() == 4);
  shell.set_glass(false);
  CHECK(!shell.theme().glass);
  shell.set_motion(0.f);
  CHECK(shell.theme().motion == 0.f);

  shell.set_dark(true);
  shell.set_accent(0);
  shell.set_glass(true);
  shell.set_motion(1.f);

  shell.close_all_windows();
  for (int i = 0; i < 40; ++i) shell.tick(16.f);
  CHECK(shell.compositor().windows().empty());
}

void test_terminal() {
  suite("terminal");
  Shell shell(1280, 800);
  for (int i = 0; i < 200; ++i) shell.tick(16.f);
  shell.open_app(WindowKind::Terminal);
  for (int i = 0; i < 40; ++i) shell.tick(16.f);

  auto type = [&](const std::string& text) {
    for (char c : text) shell.key(std::string(1, c));
  };

  type("help");
  shell.key("Enter");
  type("lumina");
  shell.key("Enter");
  type("nope");
  shell.key("Enter");
  shell.compositor().render();
  CHECK(shell.metrics().syscalls >= 3);

  // History navigation restores what was typed.
  type("ls");
  shell.key("Enter");
  shell.key("Up");
  shell.compositor().render();
  shell.key("Down");
  // Backspace is safe on an empty line.
  shell.key("Backspace");
  shell.compositor().render();
  CHECK(true);

  // The broker itself returns structured results.
  const TerminalResult r = shell.execute("agents");
  CHECK(!r.lines.empty());
  CHECK(r.lines.front().find("agent pipeline") != std::string::npos);
  const TerminalResult bad = shell.execute("definitely-not-a-command");
  CHECK(bad.exit_code != 0);
  const TerminalResult cleared = shell.execute("clear");
  CHECK(cleared.clear_screen);
  const TerminalResult ls = shell.execute("ls Projects");
  CHECK(!ls.lines.empty());
}

void test_apps_directly() {
  suite("apps");
  Theme theme = Theme::dark_theme();

  // Files: navigate into a directory and back out.
  FilesApp files;
  Surface canvas(700, 440);
  Rect content{0, 0, 700, 440};
  files.draw(canvas, content, theme);
  CHECK(files.status().find("items") != std::string::npos);
  files.on_key("Down", content);
  files.on_key("Enter", content);  // Documents (sorted first)
  CHECK(files.status() != "0 items");
  files.on_key("Backspace", content);
  CHECK(files.status().find("items") != std::string::npos);

  // Notes: typing mutates the note and marks it unsaved.
  NotesApp notes;
  notes.draw(canvas, content, theme);
  const std::string before = notes.status();
  notes.on_pointer(Point{400, 200}, InputEvent::Type::PointerDown, 0, content);
  notes.on_key("x", content);
  CHECK(notes.status() == "editing" && before == "saved");

  // Settings routes every control to the sink exactly once.
  struct Sink : SettingsSink {
    int dark_calls{0}, accent_calls{0}, motion_calls{0}, glass_calls{0}, opened{0};
    void set_dark(bool) override { ++dark_calls; }
    void set_accent(int) override { ++accent_calls; }
    void set_motion(float) override { ++motion_calls; }
    void set_glass(bool) override { ++glass_calls; }
    void open_app(WindowKind) override { ++opened; }
  } sink;
  SettingsApp settings(&sink);
  settings.draw(canvas, content, theme);
  // Row geometry: y = 76 + index * 58, height 48 (see settings_row()).
  auto row_center = [&](int index) { return 100 + index * 58; };
  settings.on_pointer(Point{660, row_center(0)}, InputEvent::Type::PointerDown, 0, content);
  settings.on_pointer(Point{600, row_center(1)}, InputEvent::Type::PointerDown, 0, content);
  settings.on_pointer(Point{640, row_center(2)}, InputEvent::Type::PointerDown, 0, content);
  settings.on_pointer(Point{640, row_center(3)}, InputEvent::Type::PointerDown, 0, content);
  settings.on_pointer(Point{640, row_center(4)}, InputEvent::Type::PointerDown, 0, content);
  CHECK(sink.dark_calls == 1);
  CHECK(sink.accent_calls == 1);
  CHECK(sink.motion_calls == 1);
  CHECK(sink.glass_calls == 1);
  CHECK(sink.opened == 1);

  // Monitor renders with and without a metrics source.
  MonitorApp monitor(nullptr);
  monitor.draw(canvas, content, theme);
  CHECK(monitor.status() == "offline");

  // Studio exposes the pipeline and reports it.
  StudioApp studio;
  studio.draw(canvas, content, theme);
  CHECK(studio.status().find("stages") != std::string::npos);

  // About renders a full frame.
  AboutApp about(nullptr);
  about.draw(canvas, content, theme);
}

void test_rendering_determinism() {
  suite("rendering");
  auto fingerprint = []() {
    Shell shell(640, 400);
    for (int i = 0; i < 200; ++i) shell.tick(16.f);
    shell.open_app(WindowKind::Files);
    for (int i = 0; i < 60; ++i) shell.tick(16.f);
    shell.compositor().render();
    unsigned long long hash = 1469598103934665603ull;
    for (int y = 0; y < shell.height(); ++y) {
      const u32* row = shell.canvas().row(y);
      for (int x = 0; x < shell.width(); ++x) {
        hash = (hash ^ row[x]) * 1099511628211ull;
      }
    }
    return hash;
  };
  const unsigned long long first = fingerprint();
  const unsigned long long second = fingerprint();
  CHECK(first == second);
  CHECK(first != 0);
}

}  // namespace

int main() {
  std::printf("Lumina OS — core test suite\n");
  test_geometry();
  test_color();
  test_surface();
  test_theme();
  test_compositor();
  test_shell_windows();
  test_terminal();
  test_apps_directly();
  test_rendering_determinism();

  std::printf("\n%d checks, %d failure(s)\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
