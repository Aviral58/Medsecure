import { Link } from "react-router-dom";
import { Empty, PageHead, Skeleton } from "../../components/Bits.jsx";
import { HospitalFacts } from "../../components/HospitalDetails.jsx";
import Icon from "../../components/Icon.jsx";
import { count } from "../../lib/format.js";
import { usePatient } from "./PatientData.jsx";

export default function PatientHospitals() {
  const { records, hospitals } = usePatient();

  return (
    <>
      <PageHead title="Hospitals in your file">
        Every hospital that has added a record for you, with its registered details. Wherever you are treated, the records land in this one file.
      </PageHead>

      {records === null && <Skeleton rows={2} />}
      {records !== null && hospitals.length === 0 && (
        <Empty icon="hospital" title="No hospital has added a record yet">
          Give your email address to a doctor at any hospital on the network. Once they add a record, the hospital appears here.
        </Empty>
      )}

      <ul className="hospital-list">
        {hospitals.map((hospital) => (
          <li key={hospital.id}>
            <div className="hospital-list-head">
              <span className="row-icon">
                <Icon name="hospital" />
              </span>
              <div>
                <h2>{hospital.name}</h2>
                <p>{[hospital.city, hospital.state].filter(Boolean).join(", ")}</p>
              </div>
              <Link className="button" to={`/records?from=${hospital.id}`}>
                See its {count(hospital.recordCount, "record")}
              </Link>
            </div>
            <HospitalFacts hospital={hospital} />
          </li>
        ))}
      </ul>
    </>
  );
}
