/**
 * Overlay host: modal dialogs published by the studio core, alerts, toasts and
 * the tooltip layer. Dialog bodies/footers are DOM nodes produced by the widget
 * kit; React owns the frame, focus handling and dismissal.
 */

import { useEffect, useRef } from "react";
import { ui, setUI, closeTopDialog, notify } from "../ui/overlays.js";
import { Icon } from "./ui.jsx";

function DialogFrame({ dialog }) {
  const bodyRef = useRef(null);
  const footerRef = useRef(null);
  const titleRef = useRef(null);

  useEffect(() => {
    const body = bodyRef.current;
    const footer = footerRef.current;
    if (body && dialog.nodes?.body) body.replaceChildren(...dialog.nodes.body);
    if (footer && dialog.nodes?.footer) footer.replaceChildren(...dialog.nodes.footer);
    const firstField = body?.querySelector("input, select, textarea");
    firstField?.focus?.();
    titleRef.current?.focus?.();
  }, [dialog]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeTopDialog();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) closeTopDialog();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={dialog.title} style={{ width: dialog.width }}>
        <div className="dialog__titlebar">
          <strong ref={titleRef} tabIndex={-1}>{dialog.title}</strong>
          <button type="button" className="dialog__close" aria-label="Close" onClick={() => closeTopDialog()}>
            <Icon name="close" size={12} />
          </button>
        </div>
        {dialog.kind === "alert" ? (
          <>
            <p className="dialog__hint" style={{ margin: 0, padding: "14px 16px", fontSize: 12, lineHeight: 1.6 }}>
              {dialog.meta?.message}
            </p>
            <div className="dialog__footer">
              <button type="button" className="btn btn--primary" onClick={() => closeTopDialog()}>
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dialog__body" ref={bodyRef} />
            <div className="dialog__footer" ref={footerRef} />
          </>
        )}
      </div>
    </div>
  );
}

export function DialogHost() {
  return <div id="modal-root">{ui.dialog ? <DialogFrame dialog={ui.dialog} /> : null}</div>;
}

export function ToastHost() {
  if (!ui.toast) return <div id="toast" className="toast" hidden />;
  return (
    <div id="toast" className="toast" role="status" aria-live="polite">
      {ui.toast.message}
    </div>
  );
}

/** React-owned confirmation dialog used by the cloud workflows. */
export function ConfirmDialog() {
  const prompt = ui.confirm;
  if (!prompt) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) setUI({ confirm: null });
    }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={prompt.title} style={{ width: 420 }}>
        <div className="dialog__titlebar">
          <strong>{prompt.title}</strong>
          <button type="button" className="dialog__close" aria-label="Close" onClick={() => setUI({ confirm: null })}>
            <Icon name="close" size={12} />
          </button>
        </div>
        <div className="dialog__body">
          <p className="dialog__hint" style={{ margin: 0 }}>{prompt.message}</p>
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn" onClick={() => setUI({ confirm: null })}>
            {prompt.cancelLabel || "Cancel"}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setUI({ confirm: null });
              prompt.onConfirm?.();
              notify();
            }}
          >
            {prompt.confirmLabel || "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
