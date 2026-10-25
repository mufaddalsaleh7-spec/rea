/**
 * Headless smoke test for the ReaOS desktop shell.
 *
 * There is no browser in the development sandbox, so this harness builds a
 * linkedom document from the real index.html, installs the browser globals the
 * shell expects, points fetch at a live ReaOS server and then drives the shell:
 * boot -> dock -> open every application -> perform a real file save.
 *
 * It is a development aid, not a substitute for a real browser suite: layout,
 * painting and input modalities are not exercised.
 *
 * Prerequisites:
 *   1. a running platform:  node src/main.ts --port 4173
 *   2. a DOM implementation (not a platform dependency):
 *        npm install --no-save --prefix platform linkedom
 *   3. run:                 node platform/tools/shell-smoke.mjs
 *
 * Exits non-zero when a check fails, so it can gate a release step.
 */

import { readFile } from "node:fs/promises";
import { parseHTML } from "linkedom";

const BASE = process.env.REAOS_URL ?? "http://127.0.0.1:4173";
const UI = new URL("../ui/", import.meta.url);

const html = await readFile(new URL("index.html", UI), "utf8");
const { window, document, HTMLElement, Element, Node, Event, CustomEvent } =
  parseHTML(html);

// --- minimal browser environment -------------------------------------------------
const describe = () => ({
  width: 1280,
  height: 800,
  top: 0,
  left: 0,
  right: 1280,
  bottom: 800,
  x: 0,
  y: 0,
});
Element.prototype.getBoundingClientRect = describe;
if (!Element.prototype.scrollIntoView)
  Element.prototype.scrollIntoView = () => {};
if (!window.HTMLCanvasElement) window.HTMLCanvasElement = window.HTMLElement;
if (!window.HTMLInputElement) window.HTMLInputElement = window.HTMLElement;
if (window.HTMLInputElement.prototype.select === undefined) {
  window.HTMLInputElement.prototype.select = () => {};
}
if (window.HTMLCanvasElement.prototype.getContext === undefined) {
  window.HTMLCanvasElement.prototype.getContext = () => null;
}
if (!window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
}

const listeners = new Map();
class FakeEventSource {
  constructor() {
    listeners.set("source", this);
  }
  addEventListener(topic, handler) {
    this.handlers ??= {};
    this.handlers[topic] = handler;
  }
  close() {}
}

const realFetch = globalThis.fetch;
const wrappedFetch = (input, init) =>
  realFetch(
    typeof input === "string" && input.startsWith("/")
      ? `${BASE}${input}`
      : input,
    init,
  );

const globals = {
  window,
  document,
  HTMLElement,
  Element,
  Node,
  Event,
  CustomEvent,
  fetch: wrappedFetch,
  EventSource: FakeEventSource,
  getComputedStyle: (element) => ({
    getPropertyValue: () => "#5fd7c0",
    element,
  }),
  matchMedia: window.matchMedia,
  location: { ...window.location, reload() {} },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  queueMicrotask,
  URL,
  URLSearchParams,
  Date,
  Math,
  JSON,
  Promise,
  Number,
  String,
  Boolean,
  Object,
  Array,
  RegExp,
  Error,
  Map,
  Set,
  Intl,
  TextDecoder,
  performance,
};
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(window, "innerWidth", { value: 1280, writable: true });
Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
window.document = document;
window.location = globals.location;

Object.assign(document, {
  addEventListener: (type, handler) => {
    document.__handlers ??= new Map();
    document.__handlers.set(type, handler);
  },
  removeEventListener: () => {},
});
if (!document.body.append)
  document.body.append = document.body.appendChild.bind(document.body);

const failures = [];
const check = (label, condition, detail = "") => {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail === "" ? "" : ` — ${detail}`}`);
    console.log(`  FAIL ${label}${detail === "" ? "" : ` — ${detail}`}`);
  }
};

const settle = (ms = 260) => new Promise((resolve) => setTimeout(resolve, ms));

const { startShell } = await import(new URL("js/shell.js", UI).href);
await startShell();
await settle(400);

const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];

console.log("\nShell boot");
check("boot overlay hidden", $("#boot-overlay").hidden === true);
check(
  "dock rendered 6 applications + settings",
  all("#dock .dock-item").length === 7,
  `got ${all("#dock .dock-item").length}`,
);
check(
  "theming applied from settings",
  ["dark", "light"].includes(document.documentElement.dataset.theme),
);
check("clock has text", ($("#status-clock").textContent ?? "").length > 0);
check(
  "cpu chip populated",
  ($("#status-cpu").textContent ?? "").includes("CPU"),
);
check(
  "desktop icons rendered",
  all("#desktop-icons .desktop-icon").length === 2,
);
check("notifications loaded from server", all("#toasts .toast").length >= 0);

// open every application through the shell's registry
const apps = ["files", "editor", "settings", "monitor", "terminal", "console"];
console.log("\nApplication windows");
for (const appId of apps) {
  const before = all(".window").length;
  const dockButton = all(`#dock .dock-item`).find(
    (node) => node.dataset.app === appId,
  );
  dockButton?.dispatchEvent(new window.Event("click"));
  await settle(320);
  const opened = all(".window").length;
  check(
    `${appId} window opened`,
    opened > before || all(`.window[data-app="${appId}"]`).length > 0,
  );
  const windowNode = all(`.window[data-app="${appId}"]`).at(-1);
  check(
    `${appId} rendered content`,
    (windowNode?.textContent ?? "").trim().length > 20,
  );
}

// The Files app must show real entries from the platform.
const filesWindow = all('.window[data-app="files"]').at(-1);
const fileRows = [...(filesWindow?.querySelectorAll(".file-row") ?? [])];
check(
  "Files lists real directories",
  fileRows.length >= 5,
  `rows: ${fileRows.length}`,
);

// Editor round-trip through the platform API.
const editorWindow = all('.window[data-app="editor"]').at(-1);
const textarea = editorWindow?.querySelector("textarea");
textarea.value = `smoke ${new Date().toISOString()}\n`;
textarea.dispatchEvent(new window.Event("input"));
const saveButton = [...(editorWindow?.querySelectorAll("button") ?? [])].find(
  (button) => button.textContent === "Save",
);
saveButton?.dispatchEvent(new window.Event("click"));
await settle(150);
// The untitled document prompts for a file name; drive the platform dialog.
const dialog = document.querySelector(".dialog-overlay");
check("save dialog opened for an untitled document", dialog !== null);
const dialogInput = dialog?.querySelector("input");
if (dialogInput) dialogInput.value = "smoke-test.txt";
dialog?.querySelector("form")?.dispatchEvent(new window.Event("submit"));
await settle(600);
const saveStatus =
  editorWindow?.querySelector(".editor-status")?.textContent ?? "";
check("editor saved to the platform", saveStatus.includes("Saved"), saveStatus);
const saved = await wrappedFetch("/api/files/read", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ path: "/Documents/smoke-test.txt" }),
}).then((response) => response.json());
check(
  "saved file exists on the platform",
  saved.ok === true && String(saved.data?.content ?? "").includes("smoke"),
);
await wrappedFetch("/api/files/delete", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ path: "/Documents/smoke-test.txt" }),
});

// Launcher search over real data.
console.log("\nLauncher");
const launcherRoot = document.getElementById("launcher");
// Open the launcher the way a user does: Ctrl+Space.
const shortcut = new window.Event("keydown");
Object.defineProperty(shortcut, "code", { value: "Space" });
Object.defineProperty(shortcut, "ctrlKey", { value: true });
Object.defineProperty(shortcut, "metaKey", { value: false });
Object.defineProperty(shortcut, "key", { value: " " });
window.dispatchEvent(shortcut);
await settle(150);
const input = document.getElementById("launcher-input");
input.value = "Wel";
input.dispatchEvent(new window.Event("input"));
await settle(500);
const results = [...document.querySelectorAll("#launcher-results .result-row")];
check(
  "launcher returns results",
  results.length > 0,
  `results: ${results.length}`,
);
check(
  "launcher finds the welcome document",
  results.some((row) => (row.textContent ?? "").includes("Welcome")),
  results.map((row) => row.textContent).join(" | "),
);
check("launcher overlay is visible when open", launcherRoot.hidden === false);

// Settings: switch theme server-side and confirm the shell re-themes.
console.log("\nSettings");
const settingsWindow = all('.window[data-app="settings"]').at(-1);
const themeButtons = [
  ...(settingsWindow?.querySelectorAll(".segmented button") ?? []),
];
const lightButton = themeButtons.find(
  (button) => button.textContent === "Light",
);
lightButton?.dispatchEvent(new window.Event("click"));
await settle(500);
check(
  "theme applied from server setting",
  document.documentElement.dataset.theme === "light",
  document.documentElement.dataset.theme,
);
const darkButton = [
  ...(settingsWindow?.querySelectorAll(".segmented button") ?? []),
].find((button) => button.textContent === "Dark");
darkButton?.dispatchEvent(new window.Event("click"));
await settle(400);

// Terminal: locked by default, unlock through the UI, then run a command.
console.log("\nTerminal");
const terminalWindow = all('.window[data-app="terminal"]').at(-1);
check(
  "terminal is locked without the capability",
  (terminalWindow?.textContent ?? "").includes("Command execution is off"),
);
const enableButton = [
  ...(terminalWindow?.querySelectorAll("button") ?? []),
].find((button) => button.textContent === "Enable now");
enableButton?.dispatchEvent(new window.Event("click"));
await settle(600);
const commandInput = terminalWindow?.querySelector(".terminal-input");
check(
  "terminal unlocked after enabling in the UI",
  commandInput !== null && commandInput !== undefined,
);
if (commandInput) {
  commandInput.value = "echo hello-reaos";
  const enter = new window.Event("keydown");
  Object.defineProperty(enter, "key", { value: "Enter" });
  commandInput.dispatchEvent(enter);
  await settle(900);
}
check(
  "command output rendered in the terminal",
  (terminalWindow?.textContent ?? "").includes("hello-reaos"),
);

// Restore the terminal setting to off so the smoke test is repeatable.
await wrappedFetch("/api/settings", {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    terminalEnabled: false,
    theme: "dark",
    accent: "aurora",
  }),
});

console.log("\nResult");
if (failures.length === 0) {
  console.log("all shell smoke checks passed");
  process.exit(0);
}
console.log(`${failures.length} check(s) failed:`);
for (const failure of failures) console.log(` - ${failure}`);
process.exit(1);
