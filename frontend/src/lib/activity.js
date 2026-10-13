import { formatDateTime } from "./format.js";

// Turns one entry of a patient's blockchain activity log into a sentence.

export const ACTIVITY_KINDS = {
  recordAdded: { icon: "records", group: "added" },
  accessGranted: { icon: "share", group: "sharing" },
  accessRevoked: { icon: "close", group: "sharing" },
  recordOpened: { icon: "eye", group: "opened" },
  emergencyRecordSet: { icon: "emergency", group: "emergency" },
  emergencyAccessUsed: { icon: "emergency", group: "emergency" },
};

export function describeActivity(entry) {
  const who = entry.actor.role === "patient" ? "You" : entry.actor.name;
  const where = entry.actor.hospitalName ? ` (${entry.actor.hospitalName})` : "";
  switch (entry.type) {
    case "recordAdded":
      return `${who}${where} added a record: ${entry.recordType}.`;
    case "accessGranted":
      return `You shared ${entry.recordType} with ${entry.actor.name}${where} until ${formatDateTime(entry.expiry)}${
        entry.maxViews ? `, for up to ${entry.maxViews} ${entry.maxViews === 1 ? "open" : "opens"}` : ""
      }.`;
    case "accessRevoked":
      return `You revoked ${entry.actor.name}'s access to ${entry.recordType}.`;
    case "recordOpened":
      return `${who}${where} opened ${entry.recordType}.`;
    case "emergencyRecordSet":
      return `You set ${entry.recordType} as your emergency summary.`;
    case "emergencyAccessUsed":
      return `${entry.actor.name}${where} used emergency access. Reason given: “${entry.reason}”.`;
    default:
      return entry.type;
  }
}

/** The activity log as a CSV file the patient can keep. */
export function activityCsv(activity) {
  const cell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [["Time", "What happened", "Block", "Transaction"]];
  for (const entry of activity) {
    rows.push([new Date(entry.time * 1000).toISOString(), describeActivity(entry), entry.blockNumber, entry.txHash]);
  }
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
