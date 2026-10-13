import { useState } from "react";
import Icon from "../../components/Icon.jsx";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";
import { initials } from "../../lib/format.js";

/**
 * Find a patient by their exact email address. There is deliberately no list
 * of patients to browse. Calls onFound({ id, name, email }) or onFound(null).
 */
export default function PatientLookup({ patient, onFound, disabled }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setMissing("");
    try {
      const data = await api(`/doctor/patients?email=${encodeURIComponent(email)}`);
      onFound(data.patient);
    } catch (problem) {
      onFound(null);
      if (problem.status === 404) setMissing(email);
      else toast.error(problem);
    } finally {
      setBusy(false);
    }
  }

  if (patient) {
    return (
      <div className="found">
        <span className="avatar" aria-hidden="true">
          {initials(patient.name)}
        </span>
        <div>
          <strong>{patient.name}</strong>
          <span>{patient.email}</span>
        </div>
        <button
          type="button"
          className="button button-quiet"
          onClick={() => {
            onFound(null);
            setEmail("");
          }}
        >
          Choose another patient
        </button>
      </div>
    );
  }

  return (
    <form className="lookup" onSubmit={submit}>
      <label className="field">
        <span>Patient's email address</span>
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={disabled} placeholder="name@example.com" />
        <small>Type it exactly. Patients cannot be searched by name, so nobody can browse who is on the network.</small>
      </label>
      <button type="submit" className="button button-primary" disabled={busy || disabled}>
        <Icon name="search" size={18} />
        {busy ? "Looking…" : "Find patient"}
      </button>
      {missing && (
        <p className="notice notice-error" role="alert">
          No patient is registered with {missing}. Check the spelling, or ask the patient to create an account first.
        </p>
      )}
    </form>
  );
}
