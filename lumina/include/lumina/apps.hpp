// Lumina OS — first-party applications.
// SPDX-License-Identifier: MIT
#pragma once

#include <string>
#include <vector>

#include "lumina/compositor.hpp"

namespace lumina {

// ---------------------------------------------------------------------------
// Host services. The shell implements these; apps never touch the OS directly,
// which keeps them portable between the native, WASM and on-device builds.
// ---------------------------------------------------------------------------
struct TerminalResult {
  std::vector<std::string> lines;
  bool clear_screen{false};
  int exit_code{0};
};

class TerminalBackend {
 public:
  virtual ~TerminalBackend() = default;
  virtual TerminalResult execute(const std::string& line) = 0;
  virtual std::string prompt() const { return "lumina"; }
};

struct Metrics {
  double fps{0};
  double frame_ms{0};
  double cpu_percent{0};
  double memory_mb{0};
  int windows{0};
  double uptime_s{0};
  unsigned long long syscalls{0};
  unsigned long long frames{0};
  std::vector<float> frame_history;  // normalised 0..1, oldest first
};

class MetricsSource {
 public:
  virtual ~MetricsSource() = default;
  virtual Metrics metrics() const = 0;
};

class SettingsSink {
 public:
  virtual ~SettingsSink() = default;
  virtual void set_dark(bool dark) = 0;
  virtual void set_accent(int index) = 0;
  virtual void set_motion(float scale) = 0;
  virtual void set_glass(bool enabled) = 0;
  virtual void open_app(WindowKind kind) = 0;
};

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
class FilesApp : public Application {
 public:
  FilesApp();
  void draw(Surface& s, Rect content, const Theme& theme) override;
  void on_pointer(Point p, InputEvent::Type type, int button, Rect content) override;
  void on_key(const std::string& key, Rect content) override;
  void on_scroll(Point p, int delta, Rect content) override;
  std::string status() const override;

 private:
  struct Node {
    std::string name;
    std::string kind;
    bool is_dir{false};
    std::uint64_t bytes{0};
    std::vector<Node> children;
  };
  void open_selected();
  std::vector<const Node*> current_entries() const;

  Node root_;
  std::vector<const Node*> stack_;
  int selected_{0};
  int sidebar_index_{0};
  int scroll_{0};
  int hover_row_{-1};
};

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------
class TerminalApp : public Application {
 public:
  explicit TerminalApp(TerminalBackend* backend);
  void draw(Surface& s, Rect content, const Theme& theme) override;
  void on_key(const std::string& key, Rect content) override;
  void on_scroll(Point p, int delta, Rect content) override;
  std::string status() const override;

 private:
  void submit();
  void print(const std::string& text, Color color);

  TerminalBackend* backend_{nullptr};
  struct Line {
    std::string text;
    Color color;
  };
  std::vector<Line> scrollback_;
  std::vector<std::string> history_;
  std::string input_;
  int history_pos_{-1};
  int scroll_offset_{0};
  int commands_{0};
  bool booted_{false};
  int blink_{0};
};

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
class NotesApp : public Application {
 public:
  NotesApp();
  void draw(Surface& s, Rect content, const Theme& theme) override;
  void on_pointer(Point p, InputEvent::Type type, int button, Rect content) override;
  void on_key(const std::string& key, Rect content) override;
  std::string status() const override;

 private:
  struct Note {
    std::string title;
    std::string body;
    std::string updated;
  };
  std::vector<Note> notes_;
  int current_{0};
  bool editing_{false};
  int frames_marker_{0};
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
class SettingsApp : public Application {
 public:
  explicit SettingsApp(SettingsSink* sink);
  void draw(Surface& s, Rect content, const Theme& theme) override;
  void on_pointer(Point p, InputEvent::Type type, int button, Rect content) override;
  std::string status() const override { return "system"; }

 private:
  SettingsSink* sink_{nullptr};
  int selected_row_{-1};
  bool theme_cache_dark_{true};
  bool motion_on_{true};
  bool glass_on_{true};
};

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------
class MonitorApp : public Application {
 public:
  explicit MonitorApp(const MetricsSource* source);
  void draw(Surface& s, Rect content, const Theme& theme) override;
  std::string status() const override;

 private:
  const MetricsSource* source_{nullptr};
};

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------
class AboutApp : public Application {
 public:
  explicit AboutApp(const MetricsSource* source);
  void draw(Surface& s, Rect content, const Theme& theme) override;
  std::string status() const override { return "3 languages"; }

 private:
  const MetricsSource* source_{nullptr};
};

// ---------------------------------------------------------------------------
// Build Studio — the agent pipeline that builds this OS.
// ---------------------------------------------------------------------------
class StudioApp : public Application {
 public:
  StudioApp();
  void draw(Surface& s, Rect content, const Theme& theme) override;
  void on_pointer(Point p, InputEvent::Type type, int button, Rect content) override;
  std::string status() const override;

 private:
  struct Stage {
    std::string name;      // layer the agent owns
    std::string agent;     // role from agents/manifest.json
    std::string language;
    std::string target;
    std::string detail;
    std::string status;
    float progress;
  };
  std::vector<Stage> stages_;
  int selected_{0};
};

}  // namespace lumina
