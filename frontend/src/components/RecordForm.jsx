import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { RECORD_TYPES, formatBytes } from "../lib/format.js";
import Icon from "./Icon.jsx";
import RecordReceipt from "./RecordReceipt.jsx";
import { useToast } from "./Toasts.jsx";

const MAX_BYTES = 15 * 1024 * 1024;

/** One line saying what the AI made of the chosen file. */
function describeSuggestion(suggestion) {
  if (suggestion.state === "checking") return "Reading the file to suggest a record type…";
  const fromPicture = suggestion.readFrom === "ocr";
  if (suggestion.state === "suggested") {
    return `${fromPicture ? "Read from the picture. " : ""}This looks like a ${suggestion.recordType.toLowerCase()} (${Math.round(suggestion.confidence * 100)}% sure). Change the type below if that is wrong.`;
  }
  if (suggestion.reason === "scanned-pdf") return "This PDF is a scan with no text layer, so the AI cannot read it. Choose the type yourself.";
  if (suggestion.reason === "no-text") return "The AI found too little readable text in this file, so choose the type yourself.";
  return `${fromPicture ? "Read from the picture, but the" : "The"} AI is not sure what kind of record this is, so choose the type yourself.`;
}

/**
 * Add one file to a patient's record: choose or drop the file, confirm the
 * record type the AI suggests, and store it. Afterwards it shows a receipt.
 *
 *   endpoint     where to send it ("/patient/records" or "/doctor/records")
 *   extraFields  added to the upload (the patient id, for a doctor)
 *   owner        whose file it goes into, when that is not the person uploading
 *   onStored     called with the receipt after a successful upload
 */
export default function RecordForm({ endpoint, extraFields = {}, owner, disabled = false, onStored, onDone }) {
  const inputRef = useRef(null);
  const latestCheck = useRef(0);
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [recordType, setRecordType] = useState(RECORD_TYPES[0]);
  const [suggestion, setSuggestion] = useState(null); // { state, recordType?, confidence?, reason?, readFrom? }
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState(null); // { receipt, fileName }

  // A small picture of the chosen file, when it is an image.
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function choose(chosen) {
    const check = ++latestCheck.current;
    setFile(chosen || null);
    if (!chosen) {
      setSuggestion(null);
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setSuggestion(null);
      setFile(null);
      toast.error(`${chosen.name} is ${formatBytes(chosen.size)}. The limit is 15 MB.`);
      return;
    }
    setSuggestion({ state: "checking" });
    try {
      const form = new FormData();
      form.append("file", chosen);
      const data = await api("/ai/classify", { method: "POST", form });
      if (check !== latestCheck.current) return; // a newer file was chosen meanwhile
      if (data.suggestion) {
        setRecordType(data.suggestion.recordType);
        setSuggestion({ state: "suggested", ...data.suggestion, readFrom: data.readFrom });
      } else {
        setSuggestion({ state: "none", reason: data.reason, readFrom: data.readFrom });
      }
    } catch {
      if (check === latestCheck.current) setSuggestion(null); // the suggestion is optional
    }
  }

  function reset() {
    latestCheck.current += 1;
    setFile(null);
    setSuggestion(null);
    setStored(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit(event) {
    event.preventDefault();
    if (!file) return;
    const form = new FormData();
    for (const [key, value] of Object.entries(extraFields)) form.append(key, value);
    form.append("recordType", recordType);
    form.append("file", file);

    setBusy(true);
    try {
      const receipt = await api(endpoint, { method: "POST", form });
      setStored({ receipt, fileName: file.name });
      if (onStored) onStored(receipt);
    } catch (problem) {
      toast.error(problem);
    } finally {
      setBusy(false);
    }
  }

  if (stored) {
    return (
      <div className="record-form">
        <RecordReceipt receipt={stored.receipt} fileName={stored.fileName} owner={owner} />
        <div className="form-actions">
          <button type="button" className="button button-primary" onClick={reset}>
            Add another record
          </button>
          {onDone && (
            <button type="button" className="button button-quiet" onClick={onDone}>
              Done
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="record-form" onSubmit={submit}>
      <input
        ref={inputRef}
        type="file"
        className="visually-hidden"
        id="record-file"
        disabled={disabled}
        accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.txt,application/pdf,image/*,text/plain"
        onChange={(event) => choose(event.target.files[0])}
      />

      {!file ? (
        <label
          htmlFor="record-file"
          className={`drop ${dragging ? "drop-over" : ""} ${disabled ? "drop-disabled" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled) choose(event.dataTransfer.files[0]);
          }}
        >
          <Icon name="upload" size={28} />
          <span className="drop-title">Drop a file here, or choose one</span>
          <span className="drop-note">A PDF, a photo or scan of a report, or a text file, up to 15 MB. It is encrypted before it is stored.</span>
        </label>
      ) : (
        <div className="chosen-file">
          {preview ? <img src={preview} alt="" /> : <span className="chosen-file-icon"><Icon name="file" size={26} /></span>}
          <div className="chosen-file-text">
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)}</span>
          </div>
          <button type="button" className="button button-quiet" onClick={reset} disabled={busy}>
            Choose another
          </button>
        </div>
      )}

      {file && suggestion && (
        <p className={`ai-note ${suggestion.state === "suggested" ? "ai-note-sure" : ""}`} aria-live="polite">
          <Icon name={suggestion.readFrom === "ocr" ? "camera" : "spark"} size={18} />
          <span>{describeSuggestion(suggestion)}</span>
        </p>
      )}

      {file && (
        <div className="record-form-end">
          <label className="field">
            <span>Record type</span>
            <select value={recordType} onChange={(event) => setRecordType(event.target.value)} disabled={disabled || busy}>
              {RECORD_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="button button-primary" disabled={busy || disabled}>
            <Icon name="lock" size={18} />
            {busy ? "Encrypting and storing…" : "Encrypt and store"}
          </button>
        </div>
      )}
      {busy && <p className="record-form-wait">Encrypting the file, storing it on IPFS and writing its fingerprint to the blockchain. A photo takes a few seconds longer because its text is read first.</p>}
    </form>
  );
}
