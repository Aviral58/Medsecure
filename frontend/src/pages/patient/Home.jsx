import { Link, useNavigate } from "react-router-dom";
import AccessBand from "../../components/AccessBand.jsx";
import { Empty, PageHead, Section, Skeleton } from "../../components/Bits.jsx";
import Icon, { recordIcon } from "../../components/Icon.jsx";
import { ACTIVITY_KINDS, describeActivity } from "../../lib/activity.js";
import { count, formatDate, opensLeft, timeAgo } from "../../lib/format.js";
import { usePatient } from "./PatientData.jsx";

/** The one sentence that answers "who can see my records right now?" */
function accessSentence(liveGrants, liveEmergency) {
  const doctors = new Set([...liveGrants.map((grant) => grant.doctorName), ...liveEmergency.map((window) => window.doctorName)]).size;
  const records = new Set(liveGrants.map((grant) => grant.recordId)).size;
  if (doctors === 0) return "Nobody but you can open your records right now.";
  if (records === 0) return `${count(doctors, "doctor has", "doctors have")} emergency access to your emergency summary right now.`;
  return `${count(doctors, "doctor")} can open ${records === 1 ? "one of your records" : `${records} of your records`} right now.`;
}

export default function PatientHome() {
  const { records, hospitals, activity, security, liveGrants, liveEmergency, access, now, opening, openRecord, share, revoke } = usePatient();
  const navigate = useNavigate();

  const loading = records === null || access === null;
  const alerts = security?.alerts.length || 0;
  const noEmergencySummary = records?.length > 0 && !records.some((record) => record.isEmergencySummary);
  const shownBands = liveGrants.slice(0, 4);

  return (
    <>
      <PageHead
        title={loading ? "Your health records" : accessSentence(liveGrants, liveEmergency)}
        actions={
          <>
            <button type="button" className="button button-primary" onClick={() => navigate("/records", { state: { add: true } })}>
              <Icon name="plus" size={18} />
              Add a record
            </button>
            {records?.length > 0 && (
              <button type="button" className="button" onClick={() => share()}>
                <Icon name="share" size={18} />
                Share with a doctor
              </button>
            )}
          </>
        }
      >
        {records?.length > 0
          ? `Your file holds ${count(records.length, "record")}${hospitals.length ? ` from ${count(hospitals.length, "hospital")}` : ""}. Each one is encrypted, and only your password unlocks it.`
          : "Every hospital you visit adds to this one file. Only you can open it, until you share a record with a doctor for a time you choose."}
      </PageHead>

      {(liveEmergency.length > 0 || shownBands.length > 0) && (
        <ul className="bands">
          {liveEmergency.map((window) => (
            <AccessBand
              key={`emergency-${window.doctorName}`}
              emergency
              title={window.doctorName}
              subtitle={`${window.hospitalName}. Opened your emergency summary under emergency access.`}
              expiry={window.expiry}
              now={now}
            />
          ))}
          {shownBands.map((grant) => (
            <AccessBand
              key={`${grant.doctorId}-${grant.recordId}`}
              title={grant.doctorName}
              subtitle={[`${grant.hospitalName}. Can open your ${grant.recordType.toLowerCase()}`, opensLeft(grant.viewsLeft)].filter(Boolean).join(", ")}
              grantedAt={grant.grantedAt}
              expiry={grant.expiry}
              now={now}
            >
              <button type="button" className="button button-danger" onClick={() => revoke([grant])}>
                Revoke
              </button>
            </AccessBand>
          ))}
        </ul>
      )}
      {liveGrants.length > shownBands.length && (
        <p className="more-link">
          <Link to="/sharing">See all {liveGrants.length} live shares</Link>
        </p>
      )}

      {(alerts > 0 || noEmergencySummary) && (
        <ul className="attention">
          {alerts > 0 && (
            <li className="attention-alert">
              <Icon name="alert" />
              <p>
                <strong>{count(alerts, "unusual access pattern")} involved your records.</strong> A doctor who opened them did so in a way that does not
                look like normal work.
              </p>
              <Link className="button" to="/activity">
                Look at it
              </Link>
            </li>
          )}
          {noEmergencySummary && (
            <li>
              <Icon name="emergency" />
              <p>
                <strong>No emergency summary chosen.</strong> If you were brought in unconscious, an emergency doctor could open nothing. Pick one record
                with your blood group, allergies and conditions.
              </p>
              <Link className="button" to="/records">
                Choose one
              </Link>
            </li>
          )}
        </ul>
      )}

      <div className="split">
        <Section title="Latest in your file" actions={records?.length > 4 && <Link to="/records">All {records.length} records</Link>}>
          {records === null && <Skeleton rows={3} />}
          {records?.length === 0 && (
            <Empty icon="records" title="Your file is empty">
              Add a report you already have, or give your email address to a doctor at any hospital on the network so they can add one.
            </Empty>
          )}
          {records?.length > 0 && (
            <ul className="rows rows-plain">
              {records.slice(0, 4).map((record) => (
                <li key={record.id} className="row">
                  <span className="row-icon">
                    <Icon name={recordIcon(record.recordType)} />
                  </span>
                  <div className="row-main">
                    <strong>{record.recordType}</strong>
                    <p className="row-meta">
                      {record.hospitalId ? record.uploaderHospital : "Added by you"}, {formatDate(record.timestamp)}
                    </p>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="button" disabled={opening === record.id} onClick={() => openRecord(record)}>
                      {opening === record.id ? "Decrypting…" : "Open"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Recent activity" actions={activity?.length > 5 && <Link to="/activity">All activity</Link>}>
          {activity === null && <Skeleton rows={3} />}
          {activity?.length === 0 && (
            <Empty icon="activity" title="Nothing has happened yet">
              Every time a record is added, shared or opened, it is written to the blockchain and listed here.
            </Empty>
          )}
          {activity?.length > 0 && (
            <ol className="feed">
              {activity.slice(0, 5).map((entry) => (
                <li key={`${entry.txHash}-${entry.type}-${entry.recordId ?? ""}`} className={`feed-item feed-${ACTIVITY_KINDS[entry.type]?.group || "other"}`}>
                  <span className="feed-icon">
                    <Icon name={ACTIVITY_KINDS[entry.type]?.icon || "info"} size={16} />
                  </span>
                  <p>{describeActivity(entry)}</p>
                  <time>{timeAgo(entry.time, now)}</time>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </>
  );
}
