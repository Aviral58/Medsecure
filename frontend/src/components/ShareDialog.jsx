import { useState } from "react";
import { api } from "../lib/api.js";
import { SHARE_DURATIONS, VIEW_LIMITS, count, formatDate } from "../lib/format.js";
import Dialog from "./Dialog.jsx";
import Icon, { recordIcon } from "./Icon.jsx";
import PasswordField from "./PasswordField.jsx";
import { useToast } from "./Toasts.jsx";

/** A row of round options where exactly one is chosen. */
function OptionRow({ legend, name, options, value, onChange }) {
  return (
    <fieldset className="option-row">
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label key={option.label} className={String(value) === String(option.value) ? "option option-on" : "option"}>
            <input type="radio" name={name} checked={String(value) === String(option.value)} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const DURATIONS = SHARE_DURATIONS.map((duration) => ({ label: duration.label, value: duration.minutes }));
const LIMITS = VIEW_LIMITS.map((limit) => ({ label: limit.value === null ? "No limit" : limit.label, value: String(limit.value) }));

/**
 * Share records with one doctor: who, for how long, how many opens, and the
 * patient's password to confirm.
 *
 *   records    every record of the patient
 *   recordIds  the ones to share. When empty, the patient ticks them here.
 */
export default function ShareDialog({ records, recordIds = [], doctors, onClose, onShared }) {
  const toast = useToast();
  const pickHere = recordIds.length === 0;
  const [picked, setPicked] = useState(() => new Set(recordIds));
  const [doctorId, setDoctorId] = useState(doctors.length === 1 ? doctors[0].id : "");
  const [minutes, setMinutes] = useState(60);
  const [viewLimit, setViewLimit] = useState("3");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const chosen = records.filter((record) => picked.has(record.id));
  const doctor = doctors.find((entry) => entry.id === doctorId);
  const duration = DURATIONS.find((entry) => entry.value === minutes);

  function toggle(recordId) {
    const next = new Set(picked);
    if (next.has(recordId)) next.delete(recordId);
    else next.add(recordId);
    setPicked(next);
  }

  async function submit(event) {
    event.preventDefault();
    if (chosen.length === 0) {
      setProblem("Tick at least one record to share.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      await api("/patient/grants", {
        method: "POST",
        body: { doctorId, recordIds: chosen.map((record) => record.id), minutes, maxViews: viewLimit === "null" ? null : Number(viewLimit), password },
      });
      toast.success(`${count(chosen.length, "record")} shared with ${doctor.name} for ${duration.label}.`);
      onShared();
    } catch (error) {
      setProblem(error.message);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  if (doctors.length === 0) {
    return (
      <Dialog title="Share with a doctor" size="small" onClose={onClose}>
        <div className="dialog-text">
          <p>No verified doctors are on the network yet. A doctor signs up, and their hospital's admin verifies them. After that they appear here.</p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Share with a doctor"
      intro="The doctor can open only what you choose here, only for this long. You can take it back at any time."
      onClose={onClose}
    >
      <form className="share-form" onSubmit={submit}>
        {pickHere ? (
          <fieldset className="pick-records">
            <legend>Records to share</legend>
            <ul>
              {records.map((record) => (
                <li key={record.id}>
                  <label>
                    <input type="checkbox" checked={picked.has(record.id)} onChange={() => toggle(record.id)} />
                    <Icon name={recordIcon(record.recordType)} size={18} />
                    <span>
                      <strong>{record.recordType}</strong>
                      <small>
                        {record.hospitalId ? record.uploaderHospital : "Added by you"}, {formatDate(record.timestamp)}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : (
          <div className="share-what">
            <span className="field-label">Sharing</span>
            <ul>
              {chosen.map((record) => (
                <li key={record.id}>
                  <Icon name={recordIcon(record.recordType)} size={18} />
                  <strong>{record.recordType}</strong>
                  <span>
                    {record.hospitalId ? record.uploaderHospital : "added by you"}, {formatDate(record.timestamp)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="field">
          <span>Doctor</span>
          <select value={doctorId} onChange={(event) => setDoctorId(event.target.value)} required>
            <option value="">Choose a doctor</option>
            {doctors.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}, {entry.hospitalName}
              </option>
            ))}
          </select>
          <small>Only doctors verified by their hospital are listed.</small>
        </label>

        <OptionRow legend="For how long" name="share-duration" options={DURATIONS} value={minutes} onChange={setMinutes} />
        <OptionRow legend="How many times each record can be opened" name="share-opens" options={LIMITS} value={viewLimit} onChange={setViewLimit} />

        <PasswordField
          label="Your password, to confirm"
          value={password}
          onChange={setPassword}
          hint="Asked every time you share, so nobody can do it from a screen you left unlocked."
        />

        {problem && (
          <p className="notice notice-error" role="alert">
            {problem}
          </p>
        )}

        <div className="form-actions form-actions-end">
          <button type="button" className="button button-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? "Sharing…" : chosen.length > 1 ? `Share ${chosen.length} records` : "Share record"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
