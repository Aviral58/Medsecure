import { useState } from "react";
import { PageHead, Section } from "../../components/Bits.jsx";
import RecordForm from "../../components/RecordForm.jsx";
import { useAuth } from "../../lib/auth.jsx";
import { VerificationNotice } from "./Home.jsx";
import PatientLookup from "./PatientLookup.jsx";

export default function DoctorAdd() {
  const { user } = useAuth();
  const [patient, setPatient] = useState(null);

  return (
    <>
      <PageHead title="Add a record">
        Put a report into a patient's file. It is encrypted for the patient alone: after you add it, you cannot open it again unless they share it with
        you.
      </PageHead>
      <VerificationNotice />

      <Section title="Whose file" className="section-step">
        <PatientLookup patient={patient} onFound={setPatient} disabled={!user.verified} />
      </Section>

      {patient && (
        <Section title="The record" className="section-step">
          <RecordForm key={patient.id} endpoint="/doctor/records" extraFields={{ patientId: patient.id }} owner={patient.name} disabled={!user.verified} />
        </Section>
      )}
    </>
  );
}
