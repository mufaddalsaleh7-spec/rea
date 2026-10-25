/**
 * Shared UI vocabulary.
 *
 * Dense, keyboard-first, accounting-shaped: numbers align on the right, totals
 * sit in a heavier row, nothing animates that could distract while posting.
 */

import { useEffect } from "react";
import { Link } from "./link.jsx";

export function Card({ title, subtitle, actions, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "" }) {
  return (
    <div className={`stat ${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

const ALIGN = { left: "left", right: "right", center: "center" };

export function Table({ columns, rows, empty = "Nothing to show yet.", footer, rowKey }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={`align-${ALIGN[column.align] ?? "left"}`} style={column.width ? { width: column.width } : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={rowKey ? rowKey(row) : (row.id ?? index)} className={row.__total ? "total-row" : undefined}>
              {columns.map((column) => (
                <td key={column.key} className={`align-${ALIGN[column.align] ?? "left"} ${column.numeric ? "num" : ""}`}>
                  {column.render ? column.render(row, index) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Field({ label, hint, children, wide = false }) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Button({ variant = "default", as = "button", ...props }) {
  if (as === "link") {
    return <Link className={`button ${variant}`} {...props} />;
  }
  return <button type="button" className={`button ${variant}`} {...props} />;
}

export function Badge({ tone = "neutral", children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Notice({ tone = "info", title, children }) {
  return (
    <div className={`notice ${tone}`}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

export function Loading({ label = "Loading…" }) {
  return <p className="muted loading">{label}</p>;
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  return (
    <Notice tone="bad" title={error.code ?? "Something went wrong"}>
      <p>{error.message}</p>
      {error.details?.next && <p className="muted">Next available number: {error.details.next}</p>}
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </Notice>
  );
}

export function Page({ title, subtitle, actions, children }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

/** A report header that carries the period control and a print button. */
export function ReportHead({ title, subtitle, actions, children }) {
  return (
    <div className="report-head">
      <div>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      <div className="report-actions">
        {actions}
        {children}
        <Button variant="ghost" onClick={() => globalThis.print()}>
          Print
        </Button>
      </div>
    </div>
  );
}

/** Focus the first input of a screen, the way a data-entry form should. */
export function useAutoFocus(ref, deps = []) {
  useEffect(() => {
    ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
