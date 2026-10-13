import { blockTime, getContract, queryEvents } from "./chain.js";
import { buildDirectory } from "./registry.js";

// Builds a patient's activity history straight from blockchain events.
// Nothing here comes from the database except the names shown next to
// each address.

export async function patientActivity(patientAddress) {
  const contract = getContract();
  const [directory, records, added, granted, revoked, accessed, emergencySet, emergencyUsed] = await Promise.all([
    buildDirectory(),
    contract.getRecords(patientAddress),
    queryEvents("RecordAdded", [patientAddress]),
    queryEvents("AccessGranted", [patientAddress]),
    queryEvents("AccessRevoked", [patientAddress]),
    queryEvents("RecordAccessed", [patientAddress]),
    queryEvents("EmergencyRecordSet", [patientAddress]),
    queryEvents("EmergencyAccessUsed", [patientAddress]),
  ]);

  const recordType = (id) => records[Number(id)]?.recordType || "record";
  const person = (address) => {
    const p = directory.lookup(address);
    return { name: p.name, role: p.role, hospitalName: p.hospitalName, address: p.address };
  };

  const items = [];
  const push = (log, fields) => items.push({ log, ...fields });

  for (const log of added) {
    push(log, {
      type: "recordAdded",
      actor: person(log.args.uploader),
      recordId: Number(log.args.recordId),
      recordType: recordType(log.args.recordId),
    });
  }
  for (const log of granted) {
    push(log, {
      type: "accessGranted",
      actor: person(log.args.provider),
      recordId: Number(log.args.recordId),
      recordType: recordType(log.args.recordId),
      expiry: Number(log.args.expiry),
      maxViews: Number(log.args.maxViews) === 0xffffffff ? null : Number(log.args.maxViews),
    });
  }
  for (const log of revoked) {
    push(log, {
      type: "accessRevoked",
      actor: person(log.args.provider),
      recordId: Number(log.args.recordId),
      recordType: recordType(log.args.recordId),
    });
  }
  for (const log of accessed) {
    push(log, {
      type: "recordOpened",
      actor: person(log.args.accessor),
      recordId: Number(log.args.recordId),
      recordType: recordType(log.args.recordId),
    });
  }
  for (const log of emergencySet) {
    push(log, {
      type: "emergencyRecordSet",
      actor: person(patientAddress),
      recordId: Number(log.args.recordId),
      recordType: recordType(log.args.recordId),
    });
  }
  for (const log of emergencyUsed) {
    push(log, {
      type: "emergencyAccessUsed",
      actor: person(log.args.doctor),
      reason: log.args.reason,
      expiry: Number(log.args.expiry),
    });
  }

  items.sort((a, b) => b.log.blockNumber - a.log.blockNumber || b.log.index - a.log.index);

  const result = [];
  for (const { log, ...fields } of items) {
    result.push({
      ...fields,
      time: await blockTime(log.blockNumber),
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
    });
  }
  return result;
}
