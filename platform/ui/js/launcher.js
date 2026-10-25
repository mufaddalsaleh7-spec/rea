import { api } from "./api.js";
import { clear, el } from "./dom.js";

/**
 * Launcher (universal search).
 *
 * Results are produced by the platform's launcher service — applications and
 * real files ranked together. Keyboard-first: ↑/↓ to move, ⏎ to open, esc to
 * close. File results open in the editor; app results open the application.
 */

export const createLauncher = ({
  root,
  input,
  results,
  onOpenApp,
  onOpenFile,
}) => {
  let hits = [];
  let selected = 0;
  let searchToken = 0;

  const renderEmpty = (message) => {
    clear(results);
    results.append(el("p", { class: "launcher-empty", text: message }));
  };

  const render = () => {
    clear(results);
    if (hits.length === 0) {
      renderEmpty(
        input.value.trim().length === 0
          ? "Search applications and files"
          : "No matches",
      );
      return;
    }
    hits.forEach((hit, index) => {
      const row = el(
        "button",
        {
          class: "result-row",
          role: "option",
          "aria-selected": String(index === selected),
          on: {
            click: () => activate(index),
            mouseenter: () => {
              selected = index;
              for (const [position, node] of [...results.children].entries()) {
                node.setAttribute("aria-selected", String(position === index));
              }
            },
          },
        },
        [
          el("span", { class: "result-glyph", text: hit.glyph }),
          el("span", { class: "result-text" }, [
            el("span", { class: "result-title", text: hit.title }),
            el("span", { class: "result-subtitle", text: hit.subtitle }),
          ]),
          el("span", { class: "result-kind", text: hit.kind }),
        ],
      );
      results.append(row);
    });
  };

  const activate = (index) => {
    const hit = hits[index];
    if (hit === undefined) return;
    close();
    if (hit.kind === "app") onOpenApp(hit.app.id);
    else onOpenFile(hit.path);
  };

  const runSearch = async () => {
    const token = ++searchToken;
    const query = input.value.trim();
    if (query.length === 0) {
      hits = [];
      selected = 0;
      render();
      return;
    }
    const response = await api.search(query);
    if (token !== searchToken) return;
    hits = response.ok ? response.data : [];
    selected = 0;
    render();
  };

  const onInput = () => {
    void runSearch();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (hits.length === 0) return;
      selected = (selected + 1) % hits.length;
      render();
      results.children[selected]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (hits.length === 0) return;
      selected = (selected - 1 + hits.length) % hits.length;
      render();
      results.children[selected]?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(selected);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const open = () => {
    root.hidden = false;
    input.value = "";
    hits = [];
    selected = 0;
    render();
    input.focus();
  };

  const close = () => {
    root.hidden = true;
  };

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  root.addEventListener("pointerdown", (event) => {
    if (event.target === root) close();
  });

  return {
    open,
    close,
    toggle: () => (root.hidden ? open() : close()),
    isOpen: () => !root.hidden,
  };
};
