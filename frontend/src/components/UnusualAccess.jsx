import { formatDateTime } from "../lib/format.js";
import { Empty } from "./Bits.jsx";

const timeOnly = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/**
 * Alerts from the unusual-access model.
 * `audience` is "hospital" (an admin looking at their own doctors) or
 * "patient" (someone whose records were touched).
 */
export default function UnusualAccess({ alerts, model, audience }) {
  if (!alerts) return null;
  if (alerts.length === 0) {
    if (audience === "patient") return null;
    return (
      <Empty icon="shield" title="Nothing unusual">
        No hour of access by your doctors stands out from normal work.
      </Empty>
    );
  }

  return (
    <>
      <ul className="alert-list">
        {alerts.map((alert) => (
          <li key={`${alert.doctorName}-${alert.start}`} className="alert">
            <p className="alert-title">
              <span>
                <strong>{alert.doctorName}</strong>
                {audience === "patient" && alert.hospitalName ? `, ${alert.hospitalName}` : ""}
              </span>
              <span className="muted">
                {formatDateTime(alert.start)} to {timeOnly.format(new Date(alert.end * 1000))}
              </span>
            </p>
            <ul className="alert-reasons">
              {alert.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {audience === "patient" && (
              <p>
                {alert.yourRecords?.length > 0 && (
                  <>
                    Your records opened in that hour:{" "}
                    {alert.yourRecords
                      .map((record) => `${record.recordType} (${record.times === 1 ? "once" : `${record.times} times`})`)
                      .join(", ")}
                    .{" "}
                  </>
                )}
                {alert.emergencyAccessToYou && <>Emergency access to your file was used in that hour.</>}
              </p>
            )}
            <p className="alert-numbers muted">
              In that hour: {alert.opens} {alert.opens === 1 ? "open" : "opens"}, {alert.patients}{" "}
              {alert.patients === 1 ? "patient" : "patients"}, {alert.emergencyUses} emergency{" "}
              {alert.emergencyUses === 1 ? "use" : "uses"}. Unusualness {alert.score} (flagged above{" "}
              {model?.threshold?.toFixed(2)}).
            </p>
          </li>
        ))}
      </ul>
      <p className="ai-footnote">
        These are found by an AI model (an Isolation Forest) that reads only the access log on the blockchain, never
        the records themselves. A flag means the pattern is worth a look; it is not proof of misuse. The model was
        trained on simulated logs.
      </p>
    </>
  );
}
