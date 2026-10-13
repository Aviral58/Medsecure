import { useState } from "react";
import AccessBand from "../../components/AccessBand.jsx";
import { Empty, PageHead, Section } from "../../components/Bits.jsx";
import { ConfirmDialog } from "../../components/Dialog.jsx";
import Icon from "../../components/Icon.jsx";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { OpenButton, useDoctor } from "./DoctorData.jsx";
import { VerificationNotice } from "./Home.jsx";
import PatientLookup from "./PatientLookup.jsx";

export default function DoctorEmergency() {
  const { user } = useAuth();
  const { liveEmergency, now, loadShared } = useDoctor();
  const toast = useToast();
  const [patient, setPatient] = useState(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0); // goes up after each use, to clear the patient search box

  async function open() {
    setBusy(true);
    try {
      await api("/doctor/emergency", { method: "POST", body: { patientId: patient.id, reason } });
      await loadShared();
      toast.success(`Emergency access opened for ${patient.name}'s emergency summary. The patient can see this.`);
      setPatient(null);
      setReason("");
      setRound((value) => value + 1);
    } catch (problem) {
      toast.error(problem);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <PageHead title="Emergency access">
        For a patient who cannot give permission. It opens only the one record they chose as their emergency summary, for one hour, and it is recorded
        permanently with your name and your reason.
      </PageHead>
      <VerificationNotice />

      {liveEmergency.length > 0 && (
        <Section title="Open now">
          <ul className="bands">
            {liveEmergency.map((item) => (
              <AccessBand
                key={`${item.patientId}-${item.recordId}`}
                emergency
                title={`${item.patientName}: ${item.recordType}`}
                subtitle="Emergency summary"
                expiry={item.expiry}
                now={now}
              >
                <OpenButton item={item} />
              </AccessBand>
            ))}
          </ul>
        </Section>
      )}

      {!user.emergencyDoctor ? (
        <Empty icon="emergency" title="You do not hold the emergency role">
          Only doctors their hospital has named for emergencies can use this. Your hospital admin can give you the role. Open this page again after they do.
        </Empty>
      ) : (
        <>
          <Section title="Which patient" className="section-step">
            <PatientLookup key={round} patient={patient} onFound={setPatient} />
          </Section>
          {patient && (
            <Section title="Why you need it" className="section-step">
              <form
                className="form form-narrow"
                onSubmit={(event) => {
                  event.preventDefault();
                  setConfirming(true);
                }}
              >
                <label className="field">
                  <span>Reason</span>
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={5} rows={3} placeholder="For example: brought in unconscious after a road accident" />
                  <small>{patient.name} will read this reason in their activity log, and your hospital can see that you used emergency access.</small>
                </label>
                <button type="submit" className="button button-danger-solid">
                  <Icon name="emergency" size={18} />
                  Open emergency access
                </button>
              </form>
            </Section>
          )}
        </>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Open ${patient.name}'s emergency summary?`}
          confirmLabel="Open emergency access"
          busyLabel="Opening…"
          busy={busy}
          danger
          onConfirm={open}
          onCancel={() => setConfirming(false)}
        >
          <p>
            You are opening a record without the patient's permission. This is written to the blockchain with your name and this reason, and it cannot be
            removed:
          </p>
          <blockquote>{reason}</blockquote>
        </ConfirmDialog>
      )}
    </>
  );
}
