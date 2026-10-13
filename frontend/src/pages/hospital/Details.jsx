import { useEffect, useState } from "react";
import { PageHead, Skeleton } from "../../components/Bits.jsx";
import { EMPTY_HOSPITAL_DETAILS, HospitalFacts, HospitalFields, detailsOf } from "../../components/HospitalDetails.jsx";
import { useToast } from "../../components/Toasts.jsx";
import { api } from "../../lib/api.js";
import { useHospital } from "./HospitalData.jsx";

export default function HospitalDetailsPage() {
  const { hospital, loadHospital } = useHospital();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(EMPTY_HOSPITAL_DETAILS);
  const [busy, setBusy] = useState(false);

  // An incomplete hospital opens straight in the form.
  useEffect(() => {
    if (hospital && !hospital.complete) {
      setDetails(detailsOf(hospital));
      setEditing(true);
    }
  }, [hospital]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/hospital/profile", { method: "PUT", body: details });
      await loadHospital();
      setEditing(false);
      toast.success("Hospital details saved.");
    } catch (problem) {
      toast.error(problem);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Hospital details">
        Patients see these details next to every record your doctors add, so keep them correct. The hospital's name is on the blockchain and cannot be
        changed here.
      </PageHead>

      {!hospital && <Skeleton rows={3} />}
      {hospital && !editing && (
        <section className="section">
          <h2>{hospital.name}</h2>
          <HospitalFacts hospital={hospital} />
          <button
            type="button"
            className="button facts-action"
            onClick={() => {
              setDetails(detailsOf(hospital));
              setEditing(true);
            }}
          >
            Edit details
          </button>
        </section>
      )}
      {hospital && editing && (
        <form className="form form-grid" onSubmit={save}>
          <HospitalFields value={details} onChange={(field, value) => setDetails({ ...details, [field]: value })} />
          <div className="form-grid-end form-actions">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? "Saving…" : "Save details"}
            </button>
            {hospital.complete && (
              <button type="button" className="button button-quiet" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </>
  );
}
