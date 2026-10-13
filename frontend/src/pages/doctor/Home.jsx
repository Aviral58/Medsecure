import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AccessBand from "../../components/AccessBand.jsx";
import { Empty, PageHead, SearchBox, Skeleton } from "../../components/Bits.jsx";
import Icon from "../../components/Icon.jsx";
import { useAuth } from "../../lib/auth.jsx";
import { count, formatDate, initials, opensLeft } from "../../lib/format.js";
import { OpenButton, useDoctor } from "./DoctorData.jsx";

/** Shown on every doctor page until the hospital admin has verified the account. */
export function VerificationNotice() {
  const { user } = useAuth();
  if (user.verified) return null;
  return (
    <p className="notice notice-waiting">
      <Icon name="info" />
      <span>
        <strong>Waiting for verification.</strong> The admin of {user.hospitalName} has to confirm that you work there. Until then you cannot add or open
        records. This notice goes away once they have verified you.
      </span>
    </p>
  );
}

export default function DoctorHome() {
  const { shared, liveShared, liveEmergency, now } = useDoctor();
  const [query, setQuery] = useState("");

  // One group of wristbands per patient.
  const byPatient = useMemo(() => {
    const groups = new Map();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    for (const item of liveShared) {
      if (!words.every((word) => `${item.patientName} ${item.recordType}`.toLowerCase().includes(word))) continue;
      if (!groups.has(item.patientId)) groups.set(item.patientId, { patientName: item.patientName, items: [] });
      groups.get(item.patientId).items.push(item);
    }
    return [...groups.values()];
  }, [liveShared, query]);

  const patients = new Set(liveShared.map((item) => item.patientId)).size;
  const title =
    shared === null
      ? "Shared with you"
      : liveShared.length === 0
        ? "No patient is sharing a record with you right now."
        : `${count(liveShared.length, "record is", "records are")} open to you right now, from ${count(patients, "patient")}.`;

  return (
    <>
      <PageHead title={title}>
        A patient decides which records you can open, and for how long. Each time you open one, they see it in their activity log.
      </PageHead>
      <VerificationNotice />

      {shared === null && <Skeleton rows={3} />}

      {liveEmergency.length > 0 && (
        <ul className="bands">
          {liveEmergency.map((item) => (
            <AccessBand
              key={`emergency-${item.patientId}`}
              emergency
              title={`${item.patientName}: ${item.recordType}`}
              subtitle="Emergency summary, opened under emergency access"
              expiry={item.expiry}
              now={now}
            >
              <OpenButton item={item} />
            </AccessBand>
          ))}
        </ul>
      )}

      {shared !== null && liveShared.length === 0 && (
        <Empty icon="access" title="Nothing to open">
          Ask the patient to share the record from their own account: they choose you by name under “Share with a doctor”. It appears here within half a
          minute. For a patient who cannot consent, see <Link to="/emergency">emergency access</Link>.
        </Empty>
      )}

      {liveShared.length > 4 && <SearchBox value={query} onChange={setQuery} placeholder="Find a patient or a kind of record" />}

      {byPatient.map((group) => (
        <section key={group.patientName} className="section doctor-group">
          <div className="doctor-group-head">
            <span className="avatar" aria-hidden="true">
              {initials(group.patientName)}
            </span>
            <div>
              <h2>{group.patientName}</h2>
              <p>{count(group.items.length, "record")} shared with you</p>
            </div>
          </div>
          <ul className="bands">
            {group.items.map((item) => (
              <AccessBand
                key={item.recordId}
                title={item.recordType}
                subtitle={[`Added to the file on ${formatDate(item.recordDate)}`, opensLeft(item.viewsLeft)].filter(Boolean).join(", ")}
                grantedAt={item.grantedAt}
                expiry={item.expiry}
                now={now}
              >
                <OpenButton item={item} />
              </AccessBand>
            ))}
          </ul>
        </section>
      ))}

      {liveShared.length > 0 && byPatient.length === 0 && (
        <Empty icon="search" title="No shared record matches">
          Try fewer words.
        </Empty>
      )}
    </>
  );
}
