/**
 * Tiny DOM helpers. ReaOS ships as plain ES modules with no client build step,
 * so the shell has one small set of element factories instead of a framework.
 */

export const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  const { class: className, text, html, dataset, on, ...rest } = props;
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (html !== undefined) node.innerHTML = html;
  if (dataset !== undefined) Object.assign(node.dataset, dataset);
  if (on !== undefined) {
    for (const [event, handler] of Object.entries(on))
      node.addEventListener(event, handler);
  }
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "disabled" || key === "hidden" || key === "checked") {
      node[key] = Boolean(value);
      continue;
    }
    node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return node;
};

export const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};

export const replaceChildren = (node, children) => {
  clear(node);
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
  return node;
};

export const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
};

export const formatDate = (iso) => {
  if (typeof iso !== "string") return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = Date.now();
  const delta = now - date.getTime();
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export const formatClock = (date, showSeconds) =>
  date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(showSeconds ? { second: "2-digit" } : {}),
  });

export const parentPath = (path) => {
  if (!path || path === "/") return "/";
  const trimmed = path.replace(/\/+$/u, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
};

export const baseName = (path) => {
  if (!path || path === "/") return "/";
  const trimmed = path.replace(/\/+$/u, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
};

export const joinPath = (parent, name) =>
  parent === "/" ? `/${name}` : `${parent}/${name}`;

export const debounce = (fn, delay = 160) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};
