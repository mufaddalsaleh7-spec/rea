/**
 * Application menu bar (File, Edit, Object, …) rendered from the menu model.
 * Behaves like a native macOS/Windows menu bar: hovering while a menu is open
 * switches menus, submenus open on hover, Escape and outside clicks close.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MENUS } from "../studio/menus.js";
import { app } from "../studio/app.js";
import { ui, setUI, notify } from "../ui/overlays.js";
import { Icon } from "./ui.jsx";

/* --------------------------------------------------------------- popup */

function MenuItem({ item, onRun, onHover, depth }) {
  if (!item) return null;
  if (item.separator) return <div className="menu__separator" role="separator" />;
  if (item.labelOnly) return <div className="menu__label">{item.labelOnly}</div>;
  const hasSubmenu = Array.isArray(item.submenu) && item.submenu.length > 0;
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu__item${item.disabled ? " is-disabled" : ""}`}
      disabled={!!item.disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (hasSubmenu) return;
        onRun(item);
      }}
      onMouseEnter={(event) => onHover(event, item, depth)}
    >
      <span className="menu__check">{item.checked ? <Icon name="check" size={12} /> : null}</span>
      <span className="menu__label-text">{item.label}</span>
      <span className="menu__shortcut">{item.shortcut || (hasSubmenu ? "›" : "")}</span>
    </button>
  );
}

function MenuPopup({ items, x, y, minWidth = 224, depth = 0, onRun, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [submenu, setSubmenu] = useState(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 6)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 6)),
    });
  }, [x, y, items]);

  const hover = useCallback((event, item, itemDepth) => {
    if (!Array.isArray(item.submenu) || item.submenu.length === 0) {
      setSubmenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setSubmenu({
      items: item.submenu,
      x: rect.right - 4,
      y: rect.top - 4,
      depth: itemDepth + 1,
    });
  }, []);

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: position.left, top: position.top, minWidth, position: "fixed", zIndex: 900 + depth }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {items.map((item, index) => (
        <MenuItem
          // eslint-disable-next-line react/no-array-index-key
          key={`${item?.label || item?.separator || "item"}-${index}`}
          item={item}
          depth={depth}
          onRun={onRun}
          onHover={hover}
        />
      ))}
      {submenu ? (
        <MenuPopup
          items={submenu.items}
          x={submenu.x}
          y={submenu.y}
          minWidth={minWidth}
          depth={submenu.depth}
          onRun={onRun}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- menu bar */

export function MenuBar() {
  const [open, setOpen] = useState(null);
  const rootRef = useRef(null);

  const close = useCallback(() => setOpen(null), []);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target) && !event.target.closest?.(".menu")) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  const runItem = (item) => {
    close();
    try {
      item.action?.();
    } finally {
      notify();
    }
  };

  return (
    <header id="menubar" className="menubar" role="menubar" aria-label="Application menu" ref={rootRef}>
      <div className="menubar__items" id="menu-items">
        {MENUS.map((menu) => (
          <button
            key={menu.label}
            type="button"
            role="menuitem"
            className={`menu-trigger${open?.label === menu.label ? " is-open" : ""}`}
            aria-haspopup="true"
            aria-expanded={open?.label === menu.label}
            onClick={(event) => {
              event.stopPropagation();
              if (open?.label === menu.label) {
                close();
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              setOpen({ label: menu.label, x: rect.left, y: rect.bottom + 1, items: menu.items(app), menu });
            }}
            onMouseEnter={(event) => {
              if (!open || open.label === menu.label) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setOpen({ label: menu.label, x: rect.left, y: rect.bottom + 1, items: menu.items(app), menu });
            }}
          >
            {menu.label}
          </button>
        ))}
      </div>
      <div className="menubar__spacer" />
      <button
        type="button"
        className="menubar__workspace"
        id="workspace-switcher"
        title="Workspace"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setOpen({
            label: "Workspace",
            x: rect.right - 210,
            y: rect.bottom + 2,
            items: [
              { label: "Essentials (Default)", action: () => app.setWorkspace("Essentials") },
              { label: "Typography", action: () => app.setWorkspace("Typography") },
              { label: "Layout", action: () => app.setWorkspace("Layout") },
              { label: "Painting", action: () => app.setWorkspace("Painting") },
              { separator: true },
              { label: "Dark Theme", checked: ui.theme === "dark", action: () => app.setTheme("dark") },
              { label: "Light Theme", checked: ui.theme === "light", action: () => app.setTheme("light") },
            ],
            menu: null,
          });
        }}
      >
        <span>{ui.workspace || app.workspace || "Essentials"}</span>
        <Icon name="chevronDown" size={8} />
      </button>
      <button
        type="button"
        className="menubar__icon"
        id="btn-help"
        title="VectorStudio Help (F1)"
        aria-label="Help"
        onClick={() => app.commands.help()}
      >
        <Icon name="info" size={13} />
      </button>

      {open ? (
        <MenuPopup
          items={open.items.filter(Boolean)}
          x={open.x}
          y={open.y}
          minWidth={open.label === "Workspace" ? 210 : 240}
          onRun={runItem}
          onClose={close}
        />
      ) : null}

      {ui.dialog === null && ui.menu ? <span hidden aria-live="polite" /> : null}
    </header>
  );
}

/* Menus opened from panels/context menus (app.openContextMenu → openMenu). */
export function DetachedMenu() {
  useEffect(() => {
    if (!ui.menu) return undefined;
    const close = (event) => {
      if (!event.target.closest?.(".menu")) setUI({ menu: null });
    };
    const onKey = (event) => {
      if (event.key === "Escape") setUI({ menu: null });
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ui.menu]);
  if (!ui.menu) return null;
  return (
    <MenuPopup
      items={ui.menu.items}
      x={ui.menu.x}
      y={ui.menu.y}
      minWidth={ui.menu.minWidth}
      onRun={(item) => {
        setUI({ menu: null });
        item.action?.();
      }}
      onClose={() => setUI({ menu: null })}
    />
  );
}
