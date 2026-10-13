import { useState } from "react";
import { shorten } from "../lib/format.js";
import Icon from "./Icon.jsx";

// Small pieces used on many pages.

/** The title block at the top of a page. `actions` are buttons shown beside it. */
export function PageHead({ title, children, actions }) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

/** A titled part of a page. */
export function Section({ title, note, actions, children, className = "" }) {
  return (
    <section className={`section ${className}`}>
      {(title || actions) && (
        <div className="section-head">
          <div>
            {title && <h2>{title}</h2>}
            {note && <p className="section-note">{note}</p>}
          </div>
          {actions && <div className="section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Shown where a list would be, when there is nothing in it yet. */
export function Empty({ icon = "info", title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={24} />
      </span>
      <div>
        {title && <p className="empty-title">{title}</p>}
        {children && <p>{children}</p>}
        {action && <div className="empty-action">{action}</div>}
      </div>
    </div>
  );
}

/** Grey bars that stand in for a list while it loads. */
export function Skeleton({ rows = 3 }) {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row">
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

/** A long technical value (hash, address, CID) shortened, with a button to copy all of it. */
export function CopyValue({ value, label, head = 10, tail = 8, full = false }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the full value is still in the tooltip.
    }
  }

  return (
    <span className="copy-value">
      <span className="mono" title={value}>
        {full ? value : shorten(value, head, tail)}
      </span>
      <button type="button" className="icon-button icon-button-small" onClick={copy} aria-label={copied ? "Copied" : `Copy ${label || "value"}`}>
        <Icon name={copied ? "check" : "copy"} size={15} />
      </button>
    </span>
  );
}

/** A row of choices where one is on: used for filters. `options` is [{ id, label, count? }]. */
export function Chips({ options, value, onChange, label }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" className="chip" aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
          {option.label}
          {option.count !== undefined && <span className="chip-count">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A search box with its magnifying glass. */
export function SearchBox({ value, onChange, placeholder, label }) {
  return (
    <label className="search-box">
      <span className="visually-hidden">{label || placeholder}</span>
      <Icon name="search" size={18} />
      <input type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

/** A coloured word such as "Verified" or "High". */
export function Tag({ tone = "neutral", children }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}
