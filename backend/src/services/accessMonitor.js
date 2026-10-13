import { accessModelInfo, scoreAccessEvents } from "../ml/accessAnomaly.js";
import { blockTime, queryEvents } from "./chain.js";
import { buildDirectory } from "./registry.js";

// Watches the audit trail for unusual behaviour.
//
// Input: only blockchain events (who opened which record and when, and who
// used emergency access). Output: the one-hour windows of a doctor's activity
// that the Isolation Forest scores as unusual, with reasons in plain words.
// Nothing here reads a medical record, and nothing is written anywhere: the
// result is recomputed from the chain whenever someone asks.

/** Every flagged window on the network, newest first. */
export async function findUnusualAccess() {
  const [opened, emergencies, directory] = await Promise.all([
    queryEvents("RecordAccessed"),
    queryEvents("EmergencyAccessUsed"),
    buildDirectory(),
  ]);

  const events = [];
  for (const log of opened) {
    events.push({
      kind: "open",
      doctor: log.args.accessor,
      patient: log.args.patient,
      recordId: Number(log.args.recordId),
      time: Number(log.args.timestamp),
    });
  }
  for (const log of emergencies) {
    events.push({
      kind: "emergency",
      doctor: log.args.doctor,
      patient: log.args.patient,
      time: await blockTime(log.blockNumber),
    });
  }

  return scoreAccessEvents(events)
    .filter((window) => window.flagged)
    .map((window) => ({ ...window, doctorInfo: directory.lookup(window.doctor) }))
    .sort((a, b) => b.start - a.start);
}

/** The part of a flagged window that is safe to show to anyone entitled to see the alert. */
export function publicAlert(window) {
  return {
    doctorName: window.doctorInfo.name,
    hospitalName: window.doctorInfo.hospitalName,
    start: window.start,
    end: window.end,
    score: Number(window.score.toFixed(3)),
    reasons: window.reasons,
    opens: window.features.opens,
    patients: window.features.patients,
    emergencyUses: window.features.emergency_uses,
  };
}

export { accessModelInfo };
