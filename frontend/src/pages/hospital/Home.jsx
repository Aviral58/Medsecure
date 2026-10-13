import { Link } from "react-router-dom";
import { PageHead, Section, Skeleton } from "../../components/Bits.jsx";
import { HospitalFacts } from "../../components/HospitalDetails.jsx";
import Icon from "../../components/Icon.jsx";
import { useAuth } from "../../lib/auth.jsx";
import { count } from "../../lib/format.js";
import { useHospital } from "./HospitalData.jsx";

export default function HospitalHome() {
  const { user } = useAuth();
  const { doctors, hospital, security, waiting } = useHospital();

  const verified = (doctors || []).filter((doctor) => doctor.verified);
  const emergency = verified.filter((doctor) => doctor.emergencyDoctor);
  const alerts = security?.alerts.length || 0;
  const title =
    doctors === null
      ? user.hospitalName
      : waiting.length > 0
        ? `${count(waiting.length, "doctor is", "doctors are")} waiting for you to verify them.`
        : doctors.length === 0
          ? "No doctor has signed up for this hospital yet."
          : `All ${count(doctors.length, "doctor")} at this hospital ${doctors.length === 1 ? "is" : "are"} verified.`;

  return (
    <>
      <PageHead title={title}>
        You look after {user.hospitalName}'s place on the network: who its doctors are, and whether their use of patient records looks normal. You cannot
        read any patient record.
      </PageHead>

      {doctors === null ? (
        <Skeleton rows={3} />
      ) : (
        <ul className="attention">
          {waiting.length > 0 && (
            <li className="attention-alert">
              <Icon name="doctor" />
              <p>
                <strong>{waiting.map((doctor) => doctor.name).join(", ")}</strong> {waiting.length === 1 ? "has" : "have"} signed up and cannot add or open
                records until you confirm they work here.
              </p>
              <Link className="button button-primary" to="/doctors">
                Verify
              </Link>
            </li>
          )}
          {alerts > 0 && (
            <li className="attention-alert">
              <Icon name="alert" />
              <p>
                <strong>{count(alerts, "unusual access pattern")}.</strong> The AI model flagged hours in which one of your doctors used the system in a way
                that does not look like normal work.
              </p>
              <Link className="button" to="/alerts">
                Look at {alerts === 1 ? "it" : "them"}
              </Link>
            </li>
          )}
          {hospital && !hospital.complete && (
            <li>
              <Icon name="hospital" />
              <p>
                <strong>Some hospital details are missing.</strong> Patients see these next to every record your doctors add.
              </p>
              <Link className="button" to="/details">
                Complete them
              </Link>
            </li>
          )}
          {doctors.length === 0 && (
            <li>
              <Icon name="info" />
              <p>
                <strong>How doctors join.</strong> Each doctor creates their own account on the sign-up page and chooses {user.hospitalName}. They then
                appear here for you to verify.
              </p>
            </li>
          )}
        </ul>
      )}

      <div className="split">
        <Section title="Doctors" actions={<Link to="/doctors">Manage doctors</Link>}>
          <dl className="tally">
            <div>
              <dt>Verified</dt>
              <dd>{verified.length}</dd>
            </div>
            <div>
              <dt>Waiting</dt>
              <dd>{waiting.length}</dd>
            </div>
            <div>
              <dt>With the emergency role</dt>
              <dd>{emergency.length}</dd>
            </div>
          </dl>
          {verified.length > 0 && emergency.length === 0 && (
            <p className="section-note">Nobody here can use emergency access yet. Give the role to doctors who work in casualty.</p>
          )}
        </Section>

        <Section title="This hospital" actions={<Link to="/details">Edit details</Link>}>
          {hospital ? <HospitalFacts hospital={hospital} /> : <Skeleton rows={2} />}
        </Section>
      </div>
    </>
  );
}
