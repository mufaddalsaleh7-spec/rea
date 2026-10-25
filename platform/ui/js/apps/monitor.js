import { api } from "../api.js";
import { el, formatBytes, replaceChildren } from "../dom.js";

/**
 * Activity — the system monitor.
 *
 * Polls the platform's host telemetry and draws short histories. The numbers are
 * measured, not simulated: CPU usage is the delta between two kernel samples,
 * and memory comes from the host's free-memory counters.
 */

const HISTORY_POINTS = 48;

export const renderMonitor = (body, ctx) => {
  const history = { cpu: [], memory: [] };
  const cpuValue = el("div", { class: "metric-value", text: "—" });
  const memoryValue = el("div", { class: "metric-value", text: "—" });
  const loadValue = el("div", { class: "metric-value", text: "—" });
  const processValue = el("div", { class: "metric-value", text: "—" });
  const memoryMeter = el("span", { style: "width: 0%" });
  const footer = el("div", { class: "files-status" });
  const canvas = el("canvas", {
    class: "sparkline",
    width: "560",
    height: "112",
    "aria-label": "CPU history",
  });

  const card = (label, value, extra) =>
    el("div", { class: "metric-card" }, [
      el("span", { class: "metric-label", text: label }),
      value,
      extra ?? null,
    ]);

  body.append(
    el("div", { class: "app" }, [
      el("div", { class: "app-toolbar" }, [
        el("span", { class: "badge", text: "live" }),
        el("span", {
          class: "quiet",
          text: "Sampled from the host every 2 seconds",
        }),
        el("span", { class: "spacer" }),
        el("button", {
          class: "toolbar-button",
          text: "System log",
          on: { click: () => ctx.openApp("console") },
        }),
      ]),
      el("div", { class: "monitor-grid" }, [
        card("CPU", cpuValue, canvas),
        card(
          "Memory",
          memoryValue,
          el("div", { class: "meter" }, [memoryMeter]),
        ),
        card(
          "Load average",
          loadValue,
          el("span", { class: "quiet", text: "1 · 5 · 15 minute averages" }),
        ),
        card(
          "ReaOS process",
          processValue,
          el("span", { class: "quiet", text: "Resident memory · JS heap" }),
        ),
      ]),
      footer,
    ]),
  );

  const drawSparkline = () => {
    const context = canvas.getContext("2d");
    if (context === null) return;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const accent =
      getComputedStyle(document.documentElement)
        .getPropertyValue("--accent")
        .trim() || "#5fd7c0";
    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.lineWidth = 1;
    for (let line = 1; line < 4; line += 1) {
      const y = (height / 4) * line;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    const points = history.cpu;
    if (points.length < 2) return;
    const step = width / (HISTORY_POINTS - 1);
    context.beginPath();
    points.forEach((value, index) => {
      const x = index * step;
      const y = height - (value / 100) * (height - 6) - 3;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.stroke();
    context.lineTo((points.length - 1) * step, height);
    context.lineTo(0, height);
    context.closePath();
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, `${accent}55`);
    gradient.addColorStop(1, `${accent}00`);
    context.fillStyle = gradient;
    context.fill();
  };

  const tick = async () => {
    if (!body.isConnected) {
      clearInterval(timer);
      return;
    }
    const response = await api.system();
    if (!response.ok) {
      replaceChildren(
        footer,
        el("span", { class: "status-dot", dataset: { state: "offline" } }),
        el("span", {
          text: `Telemetry unavailable: ${response.error.message}`,
        }),
      );
      return;
    }
    const { metrics, facts, platform } = response.data;
    if (metrics.cpuUsagePercent !== null) {
      history.cpu.push(metrics.cpuUsagePercent);
      if (history.cpu.length > HISTORY_POINTS) history.cpu.shift();
    }
    history.memory.push(metrics.memory.usedPercent);
    if (history.memory.length > HISTORY_POINTS) history.memory.shift();

    replaceChildren(
      cpuValue,
      `${metrics.cpuUsagePercent ?? "—"}`,
      el("small", { text: "%" }),
    );
    replaceChildren(
      memoryValue,
      formatBytes(metrics.memory.totalBytes - metrics.memory.freeBytes),
      el("small", { text: `of ${formatBytes(metrics.memory.totalBytes)}` }),
    );
    replaceChildren(
      loadValue,
      metrics.loadAverage.map((value) => value.toFixed(2)).join(" · "),
    );
    replaceChildren(
      processValue,
      formatBytes(metrics.process.residentBytes),
      el("small", {
        text: `heap ${formatBytes(metrics.process.heapUsedBytes)}`,
      }),
    );
    memoryMeter.style.width = `${metrics.memory.usedPercent}%`;
    drawSparkline();
    replaceChildren(
      footer,
      el("span", { class: "status-dot" }),
      el("span", {
        text: `${facts.hostname} · ${facts.platform} ${facts.release} · ${facts.architecture}`,
      }),
      el("span", { class: "spacer" }),
      el("span", { text: `${facts.cpuCount} × ${facts.cpuModel}` }),
      el("span", { text: `ReaOS ${platform.version}` }),
    );
  };

  const timer = setInterval(() => void tick(), 2000);
  void tick();
  ctx.win.onClose = () => clearInterval(timer);
};
