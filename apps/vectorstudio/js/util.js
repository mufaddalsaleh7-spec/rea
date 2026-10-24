/** Small DOM, colour and number helpers shared by every VectorStudio module. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element with props, dataset and children. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "value") node.value = v;
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function uid(prefix = "id") {
  uid.n = (uid.n || 0) + 1;
  return `${prefix}${uid.n.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/** Round to a number of decimals without trailing zero noise. */
export function round(v, dp = 2) {
  const f = 10 ** dp;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function fmt(v, dp = 2) {
  if (!Number.isFinite(v)) return "—";
  const r = round(v, dp);
  return String(r);
}

export function fmtPx(v) {
  return `${fmt(v, v % 1 === 0 ? 0 : 2)} px`;
}

/* ------------------------------------------------------------------ colours */

export function hexToRgb(hex) {
  let h = String(hex || "#000").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  const p = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`;
}

export function rgbToHsv({ r, g, b }) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const hh = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const hexToHsv = (hex) => rgbToHsv(hexToRgb(hex));
export const hsvToHex = (hsv) => rgbToHex(hsvToRgb(hsv));

/** Perceptual luminance, used to pick readable label colours on swatches. */
export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Lighten/darken in sRGB, used for layer thumbnails and previews. */
export function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  return rgbToHex({
    r: (t - r) * p + r,
    g: (t - g) * p + g,
    b: (t - b) * p + b,
  });
}

/* ------------------------------------------------------------------ misc */

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export function isMac() {
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Cmd on macOS, Ctrl elsewhere. */
export const modKey = () => (isMac() ? "⌘" : "Ctrl+");

export function debounce(fn, ms = 120) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Trailing-edge coalescer for expensive rebuilds (panels). */
export function rafThrottle(fn) {
  let queued = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...lastArgs);
    });
  };
}
