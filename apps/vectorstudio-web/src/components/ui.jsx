/**
 * React primitives that reproduce Illustrator's control language: scrubbable
 * numeric fields with expression entry, compact selects, swatches and the
 * collapsible panel frame used by every dock panel.
 */

import { useEffect, useId, useRef, useState } from "react";
import { icon } from "../engine/icons.js";
import { clamp, fmt } from "../engine/util.js";
import { evaluateExpression } from "../ui/evaluate.js";

/* --------------------------------------------------------------- icons */

export function Icon({ name, size = 14, className = "" }) {
  return (
    <span
      className={`icon ${className}`}
      aria-hidden="true"
      style={{ display: "inline-flex", width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: icon(name, size) }}
    />
  );
}

/* ---------------------------------------------------------------- fields */

/**
 * Illustrator numeric field: drag the prefix to scrub, arrow keys step,
 * arithmetic expressions ("120+30") are accepted.
 */
export function NumField({
  label = "", value = 0, onChange, min = -1e7, max = 1e7, step = 1, dp = 2,
  width = 0, title = "", disabled = false, small = false, unit = "",
}) {
  const [text, setText] = useState(() => fmt(value, dp));
  const [editing, setEditing] = useState(false);
  const dragRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setText(fmt(value, dp));
  }, [value, dp, editing]);

  const commit = (raw) => {
    const parsed = evaluateExpression(String(raw));
    if (parsed === null) {
      setText(fmt(value, dp));
      return;
    }
    const next = clamp(parsed, min, max);
    onChange?.(next);
    setText(fmt(next, dp));
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, value: Number(value) || 0, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = event.clientX - drag.x;
    if (Math.abs(delta) < 2) return;
    drag.moved = true;
    const factor = event.shiftKey ? 10 : 1;
    const next = clamp(drag.value + delta * (step || 1) * factor, min, max);
    onChange?.(Number(next.toFixed(dp)));
    setText(fmt(next, dp));
  };
  const onPointerUp = () => {
    if (dragRef.current && !dragRef.current.moved) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    dragRef.current = null;
  };

  return (
    <label
      className={`num num__scrub${small ? " num--sm" : ""}${disabled ? " is-disabled" : ""}`}
      style={width ? { minWidth: width } : undefined}
      title={title || label || "value"}
    >
      <span
        className="num__prefix"
        onPointerDown={disabled ? undefined : onPointerDown}
        onPointerMove={disabled ? undefined : onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: disabled ? "default" : "ew-resize" }}
      >
        {label || unit}
      </span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        spellCheck="false"
        disabled={disabled}
        value={text}
        aria-label={title || label || "value"}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onFocus={() => setEditing(true)}
        onBlur={(e) => {
          setEditing(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setText(fmt(value, dp));
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const delta = (e.key === "ArrowUp" ? 1 : -1) * (step || 1) * (e.shiftKey ? 10 : 1);
            const next = clamp((Number(value) || 0) + delta, min, max);
            onChange?.(Number(next.toFixed(dp)));
            setText(fmt(next, dp));
          } else if (e.key.length === 1) {
            setEditing(true);
          }
        }}
        style={{ width: "100%" }}
      />
    </label>
  );
}

export function TextField({ value = "", onChange, placeholder = "", width = 0, title = "" }) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  return (
    <input
      className="text-input"
      type="text"
      title={title}
      placeholder={placeholder}
      value={text}
      style={width ? { width } : undefined}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true);
        setText(e.target.value);
        onChange?.(e.target.value);
      }}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

export function SelectField({ value, options, onChange, width = 0, title = "" }) {
  return (
    <select
      className="select"
      value={value}
      title={title}
      style={width ? { width } : undefined}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ checked, onChange, label = "", title = "" }) {
  return (
    <label className="checkbox" title={title}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange?.(e.target.checked)} />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, title = "" }) {
  return (
    <input
      className="slider"
      type="range"
      title={title}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange?.(Number(e.target.value))}
    />
  );
}

export function Btn({ children, onClick, title = "", variant = "", small = false, disabled = false, iconName, active = false }) {
  return (
    <button
      type="button"
      className={`btn${variant ? ` btn--${variant}` : ""}${small ? " btn--sm" : ""}${active ? " is-active" : ""}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {iconName ? <Icon name={iconName} size={13} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ name, title, onClick, active = false, size = 15, disabled = false }) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? " is-active" : ""}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={name} size={size} />
    </button>
  );
}

export function Swatch({ color, none = false, size = 17, active = false, title = "", onClick }) {
  return (
    <button
      type="button"
      className={`swatch${none ? " swatch--none" : ""}${active ? " is-active" : ""}`}
      title={title || color}
      aria-label={title || color}
      style={{ width: size, height: size, ...(none ? {} : { background: color }) }}
      onClick={onClick}
    />
  );
}

export function ColorField({ label, value, onChange, width = 74 }) {
  const id = useId();
  return (
    <div className="row">
      <span className="label" style={{ minWidth: 34 }}>{label}</span>
      <label
        className="appearance-row__swatch"
        style={{ width: 20, height: 20, background: value || "transparent", cursor: "pointer" }}
        title={`${label}: ${value}`}
      >
        <input
          id={id}
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value || "") ? value : "#000000"}
          onChange={(e) => onChange?.(e.target.value)}
          style={{ opacity: 0, width: "100%", height: "100%", cursor: "pointer" }}
        />
      </label>
      <TextField value={value} onChange={(next) => onChange?.(next.startsWith("#") ? next : `#${next}`)} width={width} />
    </div>
  );
}

/* ---------------------------------------------------------------- layout */

export function Row({ children, className = "", tight = false, wrap = false, style }) {
  return (
    <div className={`row${tight ? " row--tight" : ""}${wrap ? " row--wrap" : ""} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

export function RowLabel({ children, width = 34 }) {
  return <span className="label" style={{ minWidth: width }}>{children}</span>;
}

export function Divider({ vertical = false }) {
  return <div className={vertical ? "controlbar__divider" : "panel__divider"} />;
}

/**
 * Dock panel frame: header with tabs and actions, collapsible body.
 */
export function Panel({ group, title, tabs = [], actions = null, children, collapsed = false, onToggle }) {
  const [active, setActive] = useState(0);
  const current = tabs[active] || { id: group, title };
  return (
    <section className={`panel${collapsed ? " panel--collapsed" : ""}`} data-group={group}>
      <header className="panel__header">
        <div className="panel__tabs" role="tablist">
          {(tabs.length ? tabs : [{ id: group, title: title || group }]).map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={index === active}
              className={`panel__tab${index === active ? " is-active" : ""}`}
              onClick={() => {
                setActive(index);
                if (collapsed) onToggle?.();
              }}
            >
              {tab.title}
            </button>
          ))}
        </div>
        <div className="panel__actions">
          {actions}
          <IconButton name={collapsed ? "chevronDown" : "chevronUp"} title="Collapse panel" onClick={onToggle} size={12} />
        </div>
      </header>
      {collapsed ? null : <div className="panel__tabs-body">{children(current)}</div>}
    </section>
  );
}
