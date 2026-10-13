import { useEffect, useMemo, useState } from "react";
import { Chips, CopyValue, Empty, PageHead, Section, Skeleton } from "../../components/Bits.jsx";
import Icon from "../../components/Icon.jsx";
import UnusualAccess from "../../components/UnusualAccess.jsx";
import { ACTIVITY_KINDS, activityCsv, describeActivity } from "../../lib/activity.js";
import { dayLabel, formatTime } from "../../lib/format.js";
import { usePatient } from "./PatientData.jsx";

const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "added", label: "Records added" },
  { id: "sharing", label: "Sharing" },
  { id: "opened", label: "Opened" },
  { id: "emergency", label: "Emergency" },
];

export default function PatientActivity() {
  const { activity, security, loadActivity, loadSecurity } = usePatient();
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    Promise.all([loadActivity(), loadSecurity()]).catch(() => {});
  }, [loadActivity, loadSecurity]);

  const options = useMemo(
    () =>
      FILTERS.map((option) => ({
        ...option,
        count: option.id === "all" ? activity?.length || 0 : (activity || []).filter((entry) => ACTIVITY_KINDS[entry.type]?.group === option.id).length,
      })).filter((option) => option.id === "all" || option.count > 0),
    [activity],
  );

  // The log, cut into days.
  const days = useMemo(() => {
    const groups = [];
    for (const entry of activity || []) {
      if (filter !== "all" && ACTIVITY_KINDS[entry.type]?.group !== filter) continue;
      const label = dayLabel(entry.time);
      if (groups.length === 0 || groups[groups.length - 1].label !== label) groups.push({ label, entries: [] });
      groups[groups.length - 1].entries.push(entry);
    }
    return groups;
  }, [activity, filter]);

  function download() {
    const url = URL.createObjectURL(new Blob([activityCsv(activity)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "medsecure-activity.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHead
        title="Activity"
        actions={
          activity?.length > 0 && (
            <button type="button" className="button" onClick={download}>
              <Icon name="download" size={18} />
              Download as CSV
            </button>
          )
        }
      >
        Everything that has happened to your records. This list is read from the blockchain, so nobody can edit or delete an entry, including the
        hospitals.
      </PageHead>

      {security?.alerts.length > 0 && (
        <Section
          className="section-alert"
          title="Unusual activity involving your records"
          note="A doctor who opened your records did so during an hour that does not look like normal work. You may want to revoke their access or ask the hospital about it."
        >
          <UnusualAccess alerts={security.alerts} model={security.model} audience="patient" />
        </Section>
      )}

      {activity === null && <Skeleton rows={5} />}
      {activity?.length === 0 && (
        <Empty icon="activity" title="Nothing yet">
          Adding, sharing or opening a record will show up here, with the time and the blockchain transaction that recorded it.
        </Empty>
      )}

      {activity?.length > 0 && (
        <>
          {options.length > 2 && <Chips options={options} value={filter} onChange={setFilter} label="Kind of activity" />}
          {days.map((day) => (
            <section key={day.label} className="day">
              <h2>{day.label}</h2>
              <ol className="feed feed-full">
                {day.entries.map((entry) => (
                  <li key={`${entry.txHash}-${entry.type}-${entry.recordId ?? ""}`} className={`feed-item feed-${ACTIVITY_KINDS[entry.type]?.group || "other"}`}>
                    <span className="feed-icon">
                      <Icon name={ACTIVITY_KINDS[entry.type]?.icon || "info"} size={16} />
                    </span>
                    <div>
                      <p>{describeActivity(entry)}</p>
                      <p className="feed-proof">
                        Block {entry.blockNumber}, transaction <CopyValue value={entry.txHash} label="transaction" head={10} tail={6} />
                      </p>
                    </div>
                    <time>{formatTime(entry.time)}</time>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </>
      )}
    </>
  );
}
