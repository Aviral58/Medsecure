import { useState } from "react";
import { Empty, PageHead, Skeleton, Tag } from "../../components/Bits.jsx";
import { ConfirmDialog } from "../../components/Dialog.jsx";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/auth.jsx";
import { formatDate, initials } from "../../lib/format.js";
import { useHospital } from "./HospitalData.jsx";

export default function HospitalDoctors() {
  const { user } = useAuth();
  const { doctors, waiting, loadDoctors } = useHospital();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  const [asking, setAsking] = useState(null); // { kind: "verify" | "emergency", doctor }

  async function run(key, action, successText) {
    setBusy(key);
    try {
      await action();
      await loadDoctors();
      toast.success(successText);
    } catch (problem) {
      toast.error(problem);
    } finally {
      setBusy("");
      setAsking(null);
    }
  }

  const verify = (doctor) =>
    run(`verify-${doctor.id}`, () => api(`/hospital/doctors/${doctor.id}/verify`, { method: "POST" }), `${doctor.name} is verified and can now add and open records.`);

  const setEmergency = (doctor, enabled) =>
    run(
      `emergency-${doctor.id}`,
      () => api(`/hospital/doctors/${doctor.id}/emergency`, { method: "POST", body: { enabled } }),
      enabled ? `${doctor.name} can now use emergency access.` : `${doctor.name} can no longer use emergency access.`,
    );

  return (
    <>
      <PageHead title="Doctors">
        Doctors sign up themselves and choose this hospital. Verify the ones who work here: only verified doctors can add or open patient records.
      </PageHead>

      {doctors === null && <Skeleton rows={3} />}
      {doctors?.length === 0 && (
        <Empty icon="doctor" title="No doctors yet">
          Ask each doctor to create a doctor account on the sign-up page and choose {user.hospitalName}. They appear here straight away.
        </Empty>
      )}

      {waiting.length > 0 && (
        <section className="section">
          <h2>Waiting for verification</h2>
          <ul className="rows">
            {waiting.map((doctor) => (
              <li key={doctor.id} className="row row-waiting">
                <span className="avatar" aria-hidden="true">
                  {initials(doctor.name)}
                </span>
                <div className="row-main">
                  <strong>{doctor.name}</strong>
                  <p className="row-meta">
                    {doctor.email}. Signed up {formatDate(doctor.joined)}.
                  </p>
                </div>
                <div className="row-actions">
                  <button type="button" className="button button-primary" disabled={busy === `verify-${doctor.id}`} onClick={() => setAsking({ kind: "verify", doctor })}>
                    Verify doctor
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {doctors?.some((doctor) => doctor.verified) && (
        <section className="section">
          <h2>Verified doctors</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Signed up</th>
                  <th>Emergency access</th>
                  <th>
                    <span className="visually-hidden">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {doctors
                  .filter((doctor) => doctor.verified)
                  .map((doctor) => (
                    <tr key={doctor.id}>
                      <td>
                        <strong>{doctor.name}</strong>
                        <br />
                        <span className="muted">{doctor.email}</span>
                      </td>
                      <td>{formatDate(doctor.joined)}</td>
                      <td>{doctor.emergencyDoctor ? <Tag tone="alert">Can use it</Tag> : <span className="muted">No</span>}</td>
                      <td className="cell-action">
                        {doctor.emergencyDoctor ? (
                          <button type="button" className="button" disabled={busy === `emergency-${doctor.id}`} onClick={() => setEmergency(doctor, false)}>
                            Remove emergency role
                          </button>
                        ) : (
                          <button type="button" className="button" disabled={busy === `emergency-${doctor.id}`} onClick={() => setAsking({ kind: "emergency", doctor })}>
                            Give emergency role
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {asking?.kind === "verify" && (
        <ConfirmDialog
          title={`Verify ${asking.doctor.name}?`}
          confirmLabel="Verify doctor"
          busyLabel="Verifying…"
          busy={busy !== ""}
          onConfirm={() => verify(asking.doctor)}
          onCancel={() => setAsking(null)}
        >
          <p>
            You are confirming that {asking.doctor.name} ({asking.doctor.email}) works at {user.hospitalName}. They will be able to add records to patients'
            files and open records that patients share with them. This is written to the blockchain under your hospital's name.
          </p>
        </ConfirmDialog>
      )}

      {asking?.kind === "emergency" && (
        <ConfirmDialog
          title={`Give ${asking.doctor.name} the emergency role?`}
          confirmLabel="Give emergency role"
          busyLabel="Saving…"
          busy={busy !== ""}
          onConfirm={() => setEmergency(asking.doctor, true)}
          onCancel={() => setAsking(null)}
        >
          <p>
            {asking.doctor.name} will be able to open any patient's emergency summary for one hour without the patient's permission, after giving a reason.
            Every use is recorded permanently and shown to the patient. Give this only to doctors who treat emergencies.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
