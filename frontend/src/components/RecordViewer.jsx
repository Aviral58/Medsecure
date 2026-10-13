import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import Icon from "./Icon.jsx";

// Only these types are shown inside the page. Everything else is download-only,
// so an uploaded file can never run as a web page inside MedSecure.
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp"];

function previewKind(mimeType) {
  if (IMAGE_TYPES.includes(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/plain") return "text";
  return "none";
}

const STATUS = {
  high: { label: "High", tone: "alert" },
  low: { label: "Low", tone: "alert" },
  normal: { label: "Normal", tone: "ok" },
  unclear: { label: "Unclear", tone: "warning" },
};

/** The two ends of a range written as "12.0 - 15.0", "< 200" or "> 40". */
function bounds(reference) {
  const text = String(reference || "");
  const range = text.match(/([\d.]+)\s*-\s*([\d.]+)/);
  if (range) return { low: Number(range[1]), high: Number(range[2]) };
  const below = text.match(/<\s*([\d.]+)/);
  if (below) return { low: null, high: Number(below[1]) };
  const above = text.match(/>\s*([\d.]+)/);
  if (above) return { low: Number(above[1]), high: null };
  return null;
}

/**
 * A small picture of where a result sits: the shaded part is the normal
 * range and the mark is the result.
 */
function RangeBar({ finding }) {
  const range = bounds(finding.reference);
  if (!range || finding.status === "unclear") return null;
  const { low, high } = range;
  const value = finding.value;
  let zoneStart = 30;
  let zoneEnd = 70;
  let position;
  if (low !== null && high !== null && high > low) {
    position = 30 + ((value - low) / (high - low)) * 40;
  } else if (high !== null) {
    zoneStart = 0;
    position = (value / high) * 70;
  } else {
    zoneEnd = 100;
    position = value < low ? (value / low) * 30 : 30 + Math.min(1, (value - low) / low) * 60;
  }
  position = Math.min(97, Math.max(3, position));
  return (
    <span className={`range-bar range-bar-${finding.status}`} aria-hidden="true">
      <span className="range-bar-zone" style={{ left: `${zoneStart}%`, width: `${zoneEnd - zoneStart}%` }} />
      <span className="range-bar-mark" style={{ left: `${position}%` }} />
    </span>
  );
}

function FindingsTable({ findings }) {
  const outside = findings.filter((finding) => finding.status !== "normal");
  const canFilter = findings.length > 6 && outside.length > 0 && outside.length < findings.length;
  const [onlyOutside, setOnlyOutside] = useState(false);
  const shown = canFilter && onlyOutside ? outside : findings;

  return (
    <div className="findings">
      {canFilter && (
        <label className="check-line">
          <input type="checkbox" checked={onlyOutside} onChange={(event) => setOnlyOutside(event.target.checked)} />
          Show only the {outside.length} that need a look
        </label>
      )}
      <div className="table-wrap">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Test</th>
              <th>Result</th>
              <th>Normal range</th>
              <th>Reading</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((finding) => {
              const status = STATUS[finding.status] || STATUS.normal;
              return (
                <tr key={finding.name} className={finding.status === "normal" ? "" : "row-flagged"}>
                  <td>{finding.name}</td>
                  <td className="numeric">
                    <strong>{finding.status === "unclear" ? `${finding.valueAsRead ?? finding.value}?` : finding.value}</strong> {finding.unit}
                  </td>
                  <td>
                    {finding.reference}
                    {finding.referenceAssumed && <small className="cell-note">typical adult range</small>}
                    {finding.referenceCorrected && <small className="cell-note">decimal point restored</small>}
                  </td>
                  <td>
                    <span className="reading">
                      <span className={`tag tag-${status.tone}`} title={finding.status === "unclear" ? "The picture is unclear here. Check the original document." : undefined}>
                        {status.label}
                      </span>
                      <RangeBar finding={finding} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MedicinesTable({ medicines, plain }) {
  return (
    <div className="table-wrap">
      <table className="table table-compact">
        <thead>
          <tr>
            <th>Medicine</th>
            <th>When</th>
            <th>For how long</th>
            {plain && <th>What it is</th>}
          </tr>
        </thead>
        <tbody>
          {medicines.map((medicine) => (
            <tr key={`${medicine.name}-${medicine.strength}`}>
              <td>
                <strong>{medicine.name}</strong> {medicine.strength}
              </td>
              <td>{[medicine.frequency, medicine.timing].filter(Boolean).join(", ") || <span className="muted">Not stated</span>}</td>
              <td>{medicine.duration || <span className="muted">Not stated</span>}</td>
              {plain && <td>{medicine.purpose || <span className="muted">Not in the built-in list</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The AI summary of the open record. It has two versions of the same facts:
 * clinical wording for doctors and plain language for patients. Each reader
 * starts on their own version and can switch to see the other.
 */
function SummaryPanel({ summary, audience }) {
  const [view, setView] = useState(audience === "doctor" ? "doctor" : "patient");

  if (!summary) {
    return (
      <section className="summary summary-none" aria-label="AI summary">
        <p>
          <strong>No AI summary for this record.</strong> The file has too little readable text to summarise, for example an X-ray film, or a
          scanned PDF with no text layer.
        </p>
      </section>
    );
  }

  const part = view === "doctor" ? summary.forDoctor : summary.forPatient;
  const medicines = summary.medicines || [];
  return (
    <section className="summary" aria-label="AI summary">
      <div className="summary-head">
        <h3>
          <Icon name="spark" size={18} />
          AI summary
        </h3>
        <div className="switch" role="group" aria-label="Choose the wording">
          <button type="button" aria-pressed={view === "doctor"} onClick={() => setView("doctor")}>
            For doctors
          </button>
          <button type="button" aria-pressed={view === "patient"} onClick={() => setView("patient")}>
            Plain language
          </button>
        </div>
      </div>

      {summary.source === "ocr" && (
        <p className="summary-ocr">
          <Icon name="camera" size={18} />
          <span>
            This record is a picture, so its text was read by OCR
            {summary.ocrConfidence ? ` (the reader was ${summary.ocrConfidence}% confident)` : ""}. A digit or a decimal point can be misread. Values the
            AI could not trust are marked Unclear. Compare with the document.
          </span>
        </p>
      )}

      <p className="summary-headline">{part.headline}</p>
      {part.points.length > 0 && (
        <ul className="summary-points">
          {part.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}

      {summary.findings?.length > 0 && <FindingsTable findings={summary.findings} />}
      {medicines.length > 0 && summary.findings?.length === 0 && <MedicinesTable medicines={medicines} plain={view === "patient"} />}

      <p className="summary-caution">
        {summary.caution} Written by: {summary.generatedBy}.
      </p>
    </section>
  );
}

function Turn({ turn }) {
  return (
    <li className="turn">
      <p className="turn-question">{turn.question}</p>
      <div className={`turn-answer turn-${turn.kind}`}>
        {turn.corrections.length > 0 && (
          <p className="turn-note">
            Read {turn.corrections.map((fix) => `“${fix.typed}” as “${fix.meant}”`).join(" and ")}.
          </p>
        )}
        <p>{turn.answer}</p>
        {turn.basis.length > 0 && (
          <div className="turn-basis">
            <span>From the document</span>
            <ul>
              {turn.basis.map((line) => (
                <li key={line} className="mono">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The right-hand side of the viewer: the summary, then questions and answers
 * about this record, with the question box always in reach at the bottom.
 *
 * The backend answers only from this record's own text, shows the lines the
 * answer rests on, and declines requests for medical advice.
 */
function SidePanel({ file, audience }) {
  const ask = file.ask;
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const endRef = useRef(null);

  async function send(text) {
    const asked = text.trim();
    if (!asked || busy) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await api(`/ai/ask/${ask.token}`, { method: "POST", body: { question: asked } });
      setTurns((earlier) => [...earlier, result]);
      setQuestion("");
    } catch (error) {
      setProblem(error.message);
    } finally {
      setBusy(false);
    }
  }

  // Bring the newest answer into view.
  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length]);

  const lastTurn = turns[turns.length - 1];
  const chips = lastTurn ? lastTurn.followUps : ask?.suggestions || [];

  return (
    <aside className="viewer-side">
      <div className="viewer-side-scroll">
        {file.summary !== undefined && <SummaryPanel summary={file.summary} audience={audience} />}

        {ask && (
          <section className="ask" aria-label="Ask about this report">
            <h3>Ask about this report</h3>
            <p className="ask-note">
              Answers come only from this document and show the lines they rest on.{" "}
              {audience === "doctor" ? "It does not give clinical recommendations." : "It cannot give medical advice."}
            </p>
            {turns.length > 0 && (
              <ol className="turns" aria-live="polite">
                {turns.map((turn, index) => (
                  <Turn key={index} turn={turn} />
                ))}
              </ol>
            )}
            {chips.length > 0 && (
              <div className="ask-chips">
                <span>{lastTurn ? "You could ask next" : "Try asking"}</span>
                {chips.map((suggestion) => (
                  <button key={suggestion} type="button" className="chip" disabled={busy} onClick={() => send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div ref={endRef} />
          </section>
        )}
      </div>

      {ask && (
        <form
          className="ask-form"
          onSubmit={(event) => {
            event.preventDefault();
            send(question);
          }}
        >
          {problem && (
            <p className="notice notice-error" role="alert">
              {problem}
            </p>
          )}
          <div className="ask-form-row">
            <label className="visually-hidden" htmlFor="ask-input">
              Your question about this report
            </label>
            <input
              id="ask-input"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={300}
              autoComplete="off"
              placeholder={audience === "doctor" ? "Ask, for example: which values are abnormal?" : "Ask, for example: is my haemoglobin normal?"}
            />
            <button type="submit" className="button button-primary" disabled={busy || !question.trim()}>
              <Icon name="send" size={18} />
              {busy ? "Finding…" : "Ask"}
            </button>
          </div>
        </form>
      )}
    </aside>
  );
}

/**
 * Shows a decrypted record: the document on one side, its AI summary and
 * questions on the other. On a phone the two sides become two tabs.
 * `file` comes from fetchRecordFile(). `audience` is "doctor" or "patient".
 */
export default function RecordViewer({ file, title, audience = "patient", onClose }) {
  const dialogRef = useRef(null);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [pane, setPane] = useState(file.summary ? "side" : "document"); // which side a phone shows
  const kind = previewKind(file.mimeType);

  // Closing the viewer tells the backend to forget this record's text at once.
  function close() {
    if (file.ask) api(`/ai/ask/${file.ask.token}`, { method: "DELETE" }).catch(() => {});
    onClose();
  }

  useEffect(() => {
    const safeType = kind === "none" ? "application/octet-stream" : file.mimeType;
    const objectUrl = URL.createObjectURL(new Blob([file.blob], { type: safeType }));
    setUrl(objectUrl);
    if (kind === "text") {
      file.blob.slice(0, 200_000).text().then(setText);
    }
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, kind]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="viewer"
      aria-labelledby="viewer-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="viewer-head">
        <div className="viewer-title">
          <h2 id="viewer-title">{title || file.filename}</h2>
          <p>
            {title && <span className="viewer-filename">{file.filename}</span>}
            {file.verified && (
              <span className="viewer-verified">
                <Icon name="shield" size={16} />
                Unaltered: matches the fingerprint on the blockchain
              </span>
            )}
          </p>
        </div>
        <div className="viewer-actions">
          {url && (
            <a className="button" href={url} download={file.filename}>
              <Icon name="download" size={18} />
              Download
            </a>
          )}
          <button type="button" className="button button-primary" onClick={close}>
            Close
          </button>
        </div>
      </header>

      <div className="viewer-tabs switch" role="group" aria-label="Choose what to show">
        <button type="button" aria-pressed={pane === "side"} onClick={() => setPane("side")}>
          Summary and questions
        </button>
        <button type="button" aria-pressed={pane === "document"} onClick={() => setPane("document")}>
          Document
        </button>
      </div>

      <div className={`viewer-panes viewer-show-${pane}`}>
        <div className="viewer-document">
          {kind === "image" && url && <img src={url} alt={`The document ${file.filename}`} />}
          {kind === "pdf" && url && <iframe src={url} title={file.filename} />}
          {kind === "text" && <pre>{text}</pre>}
          {kind === "none" && <p className="viewer-no-preview">This kind of file cannot be shown here. Download it to open it.</p>}
        </div>
        <SidePanel file={file} audience={audience} />
      </div>
    </dialog>
  );
}
