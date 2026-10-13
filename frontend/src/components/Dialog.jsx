import { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";

/**
 * A window that opens over the page and keeps the keyboard inside it.
 * Escape, the close button and a click outside all call onClose.
 */
export default function Dialog({ title, intro, onClose, children, footer, size = "medium", className = "" }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }, []);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${size} ${className}`}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onClose(); // a click on the dimmed page behind
      }}
    >
      <div className="dialog-frame">
        <header className="dialog-head">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {intro && <p>{intro}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}

/** Asks "are you sure?" before something that cannot be undone. */
export function ConfirmDialog({ title, children, confirmLabel, busyLabel, busy = false, danger = false, onConfirm, onCancel }) {
  return (
    <Dialog
      title={title}
      size="small"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`button ${danger ? "button-danger-solid" : "button-primary"}`} disabled={busy} onClick={onConfirm}>
            {busy ? busyLabel || "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="dialog-text">{children}</div>
    </Dialog>
  );
}
