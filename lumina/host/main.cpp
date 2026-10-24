// Lumina OS — host runtime.
//
// Two modes:
//   * scenario: renders deterministic stills (PNG) for docs, tests and review.
//   * serve:    streams the live framebuffer as raw RGBA to a browser canvas so
//               the desktop can be driven with a real mouse and keyboard.
//
// The host is the "device": it owns the clock, the probe (/proc), the Python
// syscall broker and the input transport. The shell never knows the difference.
// SPDX-License-Identifier: MIT
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <ctime>
#include <functional>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

#if defined(__unix__) || defined(__APPLE__)
#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

#include "lumina/shell.hpp"
#include "png.hpp"

using namespace lumina;

namespace {

struct Options {
  int width{1280};
  int height{800};
  std::string scenario{"tour"};
  std::string out{"out"};
  std::string root{"."};
  int port{0};
  bool cursor{true};
  bool light{false};
  int accent{0};
};

std::string clock_text() {
  const std::time_t now = std::time(nullptr);
  std::tm tm{};
#if defined(_WIN32)
  localtime_s(&tm, &now);
#else
  localtime_r(&now, &tm);
#endif
  char buf[64];
  std::strftime(buf, sizeof buf, "%a %d %b  %H:%M", &tm);
  return buf;
}

// Real machine telemetry for the Monitor app: cpu% from /proc/stat deltas and
// resident set size from /proc/self/status.
std::pair<double, double> host_probe() {
  static unsigned long long prev_idle = 0;
  static unsigned long long prev_total = 0;
  double cpu = 0.0;
  double mem = 0.0;
#if defined(__linux__)
  if (std::FILE* f = std::fopen("/proc/stat", "r")) {
    unsigned long long user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0,
                       softirq = 0, steal = 0;
    if (std::fscanf(f, "cpu %llu %llu %llu %llu %llu %llu %llu %llu", &user, &nice, &system,
                    &idle, &iowait, &irq, &softirq, &steal) == 8) {
      const unsigned long long idle_all = idle + iowait;
      const unsigned long long total = user + nice + system + idle + iowait + irq + softirq + steal;
      if (prev_total && total > prev_total) {
        const double d_total = static_cast<double>(total - prev_total);
        const double d_idle = static_cast<double>(idle_all - prev_idle);
        cpu = 100.0 * (1.0 - d_idle / d_total);
      }
      prev_idle = idle_all;
      prev_total = total;
    }
    std::fclose(f);
  }
  if (std::FILE* f = std::fopen("/proc/self/status", "r")) {
    char line[256];
    while (std::fgets(line, sizeof line, f)) {
      unsigned long kb = 0;
      if (std::sscanf(line, "VmRSS: %lu kB", &kb) == 1) {
        mem = static_cast<double>(kb) / 1024.0;
        break;
      }
    }
    std::fclose(f);
  }
#endif
  return {cpu, mem};
}

std::string shell_quote(const std::string& s) {
  std::string out = "'";
  for (char c : s) {
    if (c == '\'')
      out += "'\\''";
    else
      out += c;
  }
  out += "'";
  return out;
}

// Optional bridge to the Python syscall broker. Unknown shell commands are
// executed through tools/lumina/sysd.py so the terminal exercises the real
// syscall surface instead of a hard-coded command table.
std::function<TerminalResult(const std::string&)> make_proxy(const std::string& root) {
  const std::string script = root + "/lumina/tools/lumina/sysd.py";
  if (!std::filesystem::exists(script)) return {};
  return [script](const std::string& line) {
    TerminalResult result;
    const std::string cmd = "python3 " + shell_quote(script) + " --exec " + shell_quote(line) +
                            " 2>&1";
    std::FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) {
      result.lines.push_back("broker: python3 unavailable");
      result.exit_code = 127;
      return result;
    }
    char buf[512];
    while (std::fgets(buf, sizeof buf, pipe)) {
      std::string s(buf);
      while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
      result.lines.push_back(s);
    }
    const int status = pclose(pipe);
    result.exit_code = (status == -1) ? 1 : (status >> 8);
    return result;
  };
}

void step(Shell& shell, int total_ms, int dt = 16) {
  for (int t = 0; t < total_ms; t += dt) {
    shell.tick(static_cast<f32>(dt));
    shell.render();
  }
}

bool snap(Shell& shell, const std::string& dir, const std::string& name) {
  std::error_code ec;
  std::filesystem::create_directories(dir, ec);
  const std::string path = dir + "/" + name + ".png";
  return write_png(shell.canvas(), path);
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
void scenario_tour(Shell& shell, const Options& opt) {
  auto shot = [&](const std::string& name) {
    std::printf("  %-18s %s\n", name.c_str(), snap(shell, opt.out, name) ? "ok" : "FAILED");
  };
  std::printf("rendering tour -> %s\n", opt.out.c_str());

  step(shell, 620);
  shot("01-boot");

  step(shell, 1500);
  shell.pointer_move(Point{opt.width - 360, 600});
  step(shell, 200);
  shot("02-desktop");

  // Terminal, driven through real key events.
  shell.open_app(WindowKind::Terminal);
  step(shell, 320);
  for (char c : std::string("lumina")) shell.key(std::string(1, c));
  shell.key("Enter");
  step(shell, 160);
  for (char c : std::string("agents")) shell.key(std::string(1, c));
  shell.key("Enter");
  step(shell, 260);
  shot("03-terminal");

  // Files, sitting beside the terminal.
  shell.open_app(WindowKind::Files);
  if (Window* term = shell.window(WindowKind::Terminal))
    term->set_frame(Rect{64, 360, 560, 300});
  if (Window* files = shell.window(WindowKind::Files))
    files->set_frame(Rect{300, 84, 720, 430});
  step(shell, 340);
  shot("04-files");

  // Notes, composed with the two others.
  shell.open_app(WindowKind::Notes);
  if (Window* notes = shell.window(WindowKind::Notes))
    notes->set_frame(Rect{560, 300, 680, 440});
  step(shell, 360);
  shot("05-windows");

  shell.toggle_control_centre();
  step(shell, 160);
  shot("06-control-centre");
  shell.toggle_control_centre();

  shell.toggle_spotlight();
  for (char c : std::string("mon")) shell.key(std::string(1, c));
  step(shell, 160);
  shot("07-spotlight");
  shell.key("Escape");

  shell.close_all_windows();
  step(shell, 360);
  shell.open_app(WindowKind::Monitor);
  step(shell, 900);
  shot("08-monitor");

  shell.set_dark(false);
  shell.set_accent(2);
  step(shell, 220);
  shot("09-light");

  shell.close_all_windows();
  step(shell, 320);
  shell.open_app(WindowKind::Settings);
  step(shell, 280);
  shot("10-settings");

  shell.close_all_windows();
  step(shell, 320);
  shell.open_app(WindowKind::Studio);
  step(shell, 280);
  shot("11-build-studio");

  shell.close_all_windows();
  step(shell, 320);
  shell.open_app(WindowKind::About);
  step(shell, 300);
  shot("12-about");

  shell.set_dark(true);
  shell.set_accent(0);
  step(shell, 180);
  shell.close_all_windows();
  step(shell, 360);
  const Rect dock = shell.compositor().dock_rect();
  shell.pointer_move(Point{dock.x + 14 + 62 * 3 + 22, dock.y + 40});
  step(shell, 160);
  shot("13-dock-hover");

  shell.open_app(WindowKind::Terminal);
  step(shell, 320);
  if (Window* w = shell.compositor().focused_window()) {
    const Point grab{w->frame().x + 220, w->frame().y + 18};
    shell.pointer_down(grab);
    shell.pointer_move(Point{grab.x - 70, 40});
    step(shell, 140);
    shot("14-drag-snap");
    shell.pointer_up(Point{grab.x - 70, 40});
  }

  shell.set_workspace(1);
  step(shell, 320);
  shot("15-workspace-hud");
  std::printf("done: 15 stills\n");
}

void scenario_stills(Shell& shell, const Options& opt) {
  auto shot = [&](const std::string& name) {
    std::printf("  %-18s %s\n", name.c_str(), snap(shell, opt.out, name) ? "ok" : "FAILED");
  };
  step(shell, 2400);
  shell.open_app(WindowKind::Terminal);
  shell.open_app(WindowKind::Files);
  step(shell, 400);
  shot("desktop");
  shell.toggle_control_centre();
  step(shell, 120);
  shot("control-centre");
  shell.toggle_control_centre();
  shell.toggle_spotlight();
  for (char c : std::string("ter")) shell.key(std::string(1, c));
  step(shell, 120);
  shot("spotlight");
}

// ---------------------------------------------------------------------------
// Live server
// ---------------------------------------------------------------------------
#if defined(__unix__) || defined(__APPLE__)
std::string html_page(int w, int h) {
  char head[1400];
  std::snprintf(head, sizeof head,
                "<!doctype html><html><head><meta charset=utf-8>"
                "<title>Lumina OS — live</title>"
                "<style>html,body{margin:0;height:100%%;background:#05070d;color:#9fb0cc;"
                "font:13px/1.4 ui-monospace,Menlo,monospace;display:flex;flex-direction:column;"
                "align-items:center;justify-content:center;gap:10px}"
                "canvas{width:min(96vw,1280px);height:auto;border-radius:10px;"
                "box-shadow:0 24px 90px rgba(0,0,0,.7);cursor:default;image-rendering:auto}"
                "#hud{opacity:.7;letter-spacing:.08em;text-transform:uppercase;font-size:10px}"
                "</style></head><body><canvas id=c width=%d height=%d></canvas>"
                "<div id=hud>connecting…</div>",
                w, h);
  return std::string(head) +
         "<script>const W=" + std::to_string(w) + ",H=" + std::to_string(h) + ";" +
         R"JS(
const c=document.getElementById('c'),ctx=c.getContext('2d');
const img=ctx.createImageData(W,H);let busy=false;
async function frame(){
  if(!busy){busy=true;
    try{const r=await fetch('/frame',{cache:'no-store'});const b=await r.arrayBuffer();
      img.data.set(new Uint8ClampedArray(b));ctx.putImageData(img,0,0);
      const s=await (await fetch('/state',{cache:'no-store'})).json();
      document.getElementById('hud').textContent =
        s.fps.toFixed(0)+' fps · '+s.frame_ms.toFixed(1)+' ms/frame · '+
        s.windows+' windows · workspace '+(s.workspace+1)+' · '+s.theme+' · '+s.syscalls+' syscalls';
    }catch(e){document.getElementById('hud').textContent='reconnecting…';}
    busy=false;}
  setTimeout(frame,70);
}
frame();
function pos(e){const r=c.getBoundingClientRect();
  return [Math.round((e.clientX-r.left)*W/r.width),Math.round((e.clientY-r.top)*H/r.height)];}
c.addEventListener('mousemove',e=>{const [x,y]=pos(e);fetch(`/input?type=move&x=${x}&y=${y}`);});
c.addEventListener('mousedown',e=>{const [x,y]=pos(e);fetch(`/input?type=down&x=${x}&y=${y}`);});
c.addEventListener('mouseup',e=>{const [x,y]=pos(e);fetch(`/input?type=up&x=${x}&y=${y}`);});
c.addEventListener('wheel',e=>{const [x,y]=pos(e);e.preventDefault();
  fetch(`/input?type=scroll&x=${x}&y=${y}&d=${e.deltaY>0?-1:1}`);},{passive:false});
function keyName(e){
  if(e.metaKey){const k=e.key.length===1?e.key.toLowerCase():e.key;
    return 'Meta+'+(e.shiftKey&&e.key.length>1?'Shift+':'')+k;}
  const map={' ':'Space','ArrowUp':'Up','ArrowDown':'Down','ArrowLeft':'Left','ArrowRight':'Right'};
  if(map[e.key])return map[e.key];
  if(e.key.length===1)return e.key;
  return e.key;
}
document.addEventListener('keydown',e=>{
  if(e.metaKey) e.preventDefault();
  fetch('/key?k='+encodeURIComponent(keyName(e)));
});
)JS" +
         "</script></body></html>";
}

struct HttpRequest {
  std::string method;
  std::string path;
  std::string query;
};

HttpRequest parse_request(const std::string& raw) {
  HttpRequest req;
  size_t sp1 = raw.find(' ');
  if (sp1 == std::string::npos) return req;
  req.method = raw.substr(0, sp1);
  size_t sp2 = raw.find(' ', sp1 + 1);
  std::string target = raw.substr(sp1 + 1, sp2 - sp1 - 1);
  const size_t q = target.find('?');
  req.path = target.substr(0, q);
  req.query = q == std::string::npos ? "" : target.substr(q + 1);
  return req;
}

std::string param(const std::string& query, const std::string& key, const std::string& field = "") {
  size_t pos = 0;
  while (pos < query.size()) {
    const size_t amp = query.find('&', pos);
    const std::string kv = query.substr(pos, amp == std::string::npos ? std::string::npos : amp - pos);
    const size_t eq = kv.find('=');
    if (eq != std::string::npos) {
      const std::string k = kv.substr(0, eq);
      if (k == key) return kv.substr(eq + 1);
    } else if (kv == field && !field.empty()) {
      return field;
    }
    if (amp == std::string::npos) break;
    pos = amp + 1;
  }
  return {};
}

std::string url_decode(const std::string& in) {
  std::string out;
  for (size_t i = 0; i < in.size(); ++i) {
    if (in[i] == '%' && i + 2 < in.size()) {
      out += static_cast<char>(std::strtol(in.substr(i + 1, 2).c_str(), nullptr, 16));
      i += 2;
    } else if (in[i] == '+') {
      out += ' ';
    } else {
      out += in[i];
    }
  }
  return out;
}

int run_server(Shell& shell, const Options& opt) {
  const int server = socket(AF_INET, SOCK_STREAM, 0);
  if (server < 0) {
    std::perror("socket");
    return 1;
  }
  int yes = 1;
  setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_ANY);  // required for the preview proxy
  addr.sin_port = htons(static_cast<uint16_t>(opt.port));
  if (bind(server, reinterpret_cast<sockaddr*>(&addr), sizeof addr) < 0) {
    std::perror("bind");
    return 1;
  }
  listen(server, 8);
  std::printf("Lumina preview listening on http://0.0.0.0:%d\n", opt.port);
  std::fflush(stdout);

  step(shell, 2400);  // finish the boot sequence before the first request
  shell.render();

  std::vector<unsigned char> frame(static_cast<size_t>(opt.width) * opt.height * 4);
  auto last = std::chrono::steady_clock::now();
  for (;;) {
    sockaddr_in client{};
    socklen_t len = sizeof client;
    const int fd = accept(server, reinterpret_cast<sockaddr*>(&client), &len);
    if (fd < 0) continue;
    std::string raw;
    char buf[2048];
    for (;;) {
      const ssize_t n = recv(fd, buf, sizeof buf, 0);
      if (n <= 0) break;
      raw.append(buf, static_cast<size_t>(n));
      if (raw.find("\r\n\r\n") != std::string::npos || raw.size() > 16384) break;
    }
    const HttpRequest req = parse_request(raw);

    if (req.path == "/frame") {
      const auto now = std::chrono::steady_clock::now();
      const double dt =
          std::chrono::duration<double, std::milli>(now - last).count();
      last = now;
      const f32 dt_ms = static_cast<f32>(clampf(static_cast<float>(dt), 6.f, 120.f));
      shell.set_clock(clock_text());
      shell.tick(dt_ms);
      shell.render();
      for (int y = 0; y < opt.height; ++y) {
        const u32* row = shell.canvas().row(y);
        for (int x = 0; x < opt.width; ++x) {
          const u32 p = row[x];
          const size_t i = (static_cast<size_t>(y) * opt.width + x) * 4;
          frame[i + 0] = static_cast<unsigned char>((p >> 16) & 0xFF);
          frame[i + 1] = static_cast<unsigned char>((p >> 8) & 0xFF);
          frame[i + 2] = static_cast<unsigned char>(p & 0xFF);
          frame[i + 3] = 0xFF;
        }
      }
      char header[256];
      const int hlen = std::snprintf(header, sizeof header,
                                     "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n"
                                     "Content-Length: %zu\r\nCache-Control: no-store\r\n"
                                     "Connection: close\r\n\r\n",
                                     frame.size());
      send(fd, header, static_cast<size_t>(hlen), 0);
      send(fd, frame.data(), frame.size(), 0);
    } else if (req.path == "/state") {
      const Metrics m = shell.metrics();
      char body[512];
      const int n = std::snprintf(
          body, sizeof body,
          "{\"fps\":%.1f,\"frame_ms\":%.2f,\"windows\":%d,\"workspace\":%d,"
          "\"theme\":\"%s\",\"syscalls\":%llu,\"frames\":%llu,\"cpu\":%.1f,\"mem\":%.1f}",
          m.fps, m.frame_ms, m.windows, shell.workspace(),
          shell.theme().dark ? "solstice dark" : "aurora light", m.syscalls, m.frames,
          m.cpu_percent, m.memory_mb);
      char header[256];
      const int hlen = std::snprintf(header, sizeof header,
                                     "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
                                     "Content-Length: %d\r\nCache-Control: no-store\r\n"
                                     "Connection: close\r\n\r\n",
                                     n);
      send(fd, header, static_cast<size_t>(hlen), 0);
      send(fd, body, static_cast<size_t>(n), 0);
    } else if (req.path == "/input") {
      const std::string type = param(req.query, "type");
      const int x = std::atoi(param(req.query, "x").c_str());
      const int y = std::atoi(param(req.query, "y").c_str());
      if (type == "move") {
        shell.pointer_move(Point{x, y});
      } else if (type == "down") {
        shell.pointer_down(Point{x, y});
      } else if (type == "up") {
        shell.pointer_up(Point{x, y});
      } else if (type == "scroll") {
        shell.scroll(Point{x, y}, std::atoi(param(req.query, "d").c_str()));
      }
      const char* ok = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
      send(fd, ok, std::strlen(ok), 0);
    } else if (req.path == "/key") {
      shell.key(url_decode(param(req.query, "k")));
      const char* ok = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
      send(fd, ok, std::strlen(ok), 0);
    } else {
      const std::string page = html_page(opt.width, opt.height);
      char header[256];
      const int hlen = std::snprintf(header, sizeof header,
                                     "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
                                     "Content-Length: %zu\r\nCache-Control: no-store\r\n"
                                     "Connection: close\r\n\r\n",
                                     page.size());
      send(fd, header, static_cast<size_t>(hlen), 0);
      send(fd, page.data(), page.size(), 0);
    }
    close(fd);
  }
}
#endif

Options parse(int argc, char** argv) {
  Options opt;
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    auto next = [&]() { return i + 1 < argc ? std::string(argv[++i]) : std::string(); };
    if (a == "--width") opt.width = std::atoi(next().c_str());
    else if (a == "--height") opt.height = std::atoi(next().c_str());
    else if (a == "--scenario") opt.scenario = next();
    else if (a == "--out") opt.out = next();
    else if (a == "--root") opt.root = next();
    else if (a == "--port" || a == "--serve") opt.port = std::atoi(next().c_str());
    else if (a == "--light") opt.light = true;
    else if (a == "--accent") opt.accent = std::atoi(next().c_str());
    else if (a == "--no-cursor") opt.cursor = false;
    else if (a == "--help" || a == "-h") {
      std::printf(
          "lumina-host — Lumina OS host runtime\n\n"
          "  --scenario tour|stills|serve   what to run (default: tour)\n"
          "  --width N --height N           framebuffer size (default 1280x800)\n"
          "  --port N                       live preview port (implies serve)\n"
          "  --out DIR                      still output directory (lumina/out)\n"
          "  --light --accent N             initial appearance\n");
      std::exit(0);
    }
  }
  return opt;
}

}  // namespace

int main(int argc, char** argv) {
  const Options opt = parse(argc, argv);
  Shell shell(opt.width, opt.height);
  shell.set_system_probe(host_probe);
  shell.set_terminal_proxy(make_proxy(opt.root));
  shell.set_clock(clock_text());
  if (opt.light) shell.set_dark(false);
  shell.set_accent(opt.accent);

  if (opt.port > 0 || opt.scenario == "serve") {
#if defined(__unix__) || defined(__APPLE__)
    return run_server(shell, opt);
#else
    std::fprintf(stderr, "live preview requires a POSIX host\n");
    return 1;
#endif
  }
  if (opt.scenario == "stills") {
    scenario_stills(shell, opt);
    return 0;
  }
  if (opt.scenario == "tour") {
    scenario_tour(shell, opt);
    return 0;
  }
  std::fprintf(stderr, "unknown scenario '%s' (tour|stills|serve)\n", opt.scenario.c_str());
  return 2;
}
