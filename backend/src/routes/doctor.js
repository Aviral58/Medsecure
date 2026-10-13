import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { User } from "../models/User.js";
import { badRequest, getPrivateKey, getSigner, normalizeEmail } from "../services/accounts.js";
import { blockTime, getContract, queryEvents, sendContractTx } from "../services/chain.js";
import { emergencyKeys, unwrapKey } from "../services/crypto.js";
import { loadRecord, openRecord, sendFile, storeRecord } from "../services/records.js";
import { buildDirectory } from "../services/registry.js";

// Routes for a doctor: add records, open shared records, emergency access.
export const doctorRouter = Router();
doctorRouter.use(requireAuth, requireRole("doctor"));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });
const nowSeconds = () => Math.floor(Date.now() / 1000);
const UNLIMITED_VIEWS = 0xffffffff; // UNLIMITED_VIEWS in the contract

async function findPatient(id) {
  const patient = await User.findOne({ _id: id, role: "patient" }).catch(() => null);
  if (!patient) throw Object.assign(new Error("Patient not found."), { status: 404 });
  return patient;
}

// Look a patient up by their exact email address. There is deliberately no
// way to browse or search the patient list.
doctorRouter.get("/patients", async (req, res) => {
  const email = normalizeEmail(req.query.email);
  if (!email) throw badRequest("Enter the patient's email address.");
  const patient = await User.findOne({ email, role: "patient" });
  if (!patient) return res.status(404).json({ error: "No patient is registered with that email." });
  res.json({ patient: { id: String(patient._id), name: patient.name, email: patient.email } });
});

// Add a record to a patient's file.
doctorRouter.post("/records", upload.single("file"), async (req, res) => {
  const patient = await findPatient(req.body.patientId);
  const result = await storeRecord({
    uploader: req.user,
    patient,
    file: req.file,
    recordType: req.body.recordType,
  });
  res.status(201).json(result);
});

// Records this doctor has added (details only; opening one needs a grant).
doctorRouter.get("/uploads", async (req, res) => {
  const [logs, directory] = await Promise.all([queryEvents("RecordAdded", [null, null, req.user.address]), buildDirectory()]);
  const contract = getContract();
  const uploads = [];
  for (const log of logs) {
    const record = await contract.getRecord(log.args.patient, log.args.recordId);
    const patient = directory.lookup(log.args.patient);
    uploads.push({
      patientName: patient.name,
      patientEmail: patient.email,
      recordId: Number(log.args.recordId),
      recordType: record.recordType,
      cid: record.cid,
      timestamp: Number(record.timestamp),
    });
  }
  res.json({ uploads: uploads.reverse() });
});

// Everything this doctor can open right now.
doctorRouter.get("/shared", async (req, res) => {
  const contract = getContract();
  const me = req.user.address;
  const [directory, grantLogs, emergencyLogs] = await Promise.all([
    buildDirectory(),
    queryEvents("AccessGranted", [null, me]),
    queryEvents("EmergencyAccessUsed", [null, me]),
  ]);
  const now = nowSeconds();

  const latest = new Map();
  for (const log of grantLogs) latest.set(`${log.args.patient}|${log.args.recordId}`, log);

  const shared = [];
  for (const log of latest.values()) {
    const recordId = Number(log.args.recordId);
    const grant = await contract.getGrant(log.args.patient, recordId, me);
    const expiry = Number(grant.expiry);
    if (expiry <= now) continue;
    const record = await contract.getRecord(log.args.patient, recordId);
    const patient = directory.lookup(log.args.patient);
    shared.push({
      viewsLeft: Number(grant.viewsLeft) === UNLIMITED_VIEWS ? null : Number(grant.viewsLeft),
      patientId: patient.id,
      patientName: patient.name,
      recordId,
      recordType: record.recordType,
      recordDate: Number(record.timestamp),
      grantedAt: await blockTime(log.blockNumber),
      expiry,
    });
  }
  shared.sort((a, b) => a.expiry - b.expiry);

  const emergency = [];
  const seen = new Set();
  for (const log of emergencyLogs) {
    if (seen.has(log.args.patient)) continue;
    seen.add(log.args.patient);
    const expiry = Number(await contract.getEmergencyExpiry(log.args.patient, me));
    if (expiry <= now) continue;
    const profile = await contract.getEmergencyProfile(log.args.patient);
    if (!profile.isSet) continue;
    const recordId = Number(profile.recordId);
    const record = await contract.getRecord(log.args.patient, recordId);
    const patient = directory.lookup(log.args.patient);
    emergency.push({
      patientId: patient.id,
      patientName: patient.name,
      recordId,
      recordType: record.recordType,
      recordDate: Number(record.timestamp),
      expiry,
    });
  }

  res.json({ shared, emergency, now });
});

// Open a patient's record. The contract decides whether this doctor may; the
// key only unwraps if the doctor truly holds a grant; and the access is
// written to the audit trail before the file is released.
doctorRouter.get("/records/:patientId/:recordId/file", async (req, res) => {
  const contract = getContract();
  const patient = await findPatient(req.params.patientId);
  const recordId = Number(req.params.recordId);
  const record = await loadRecord(patient.address, recordId);
  const me = req.user.address;
  const now = nowSeconds();

  if (!(await contract.hasAccess(patient.address, recordId, me, { blockTag: "pending" }))) {
    return res.status(403).json({ error: "You do not have access to this record. It may have expired or been revoked." });
  }

  let fileKey;
  const grant = await contract.getGrant(patient.address, recordId, me);
  if (Number(grant.expiry) > now) {
    fileKey = unwrapKey(getPrivateKey(req.user), grant.wrappedKey);
  } else {
    const profile = await contract.getEmergencyProfile(patient.address);
    const emergencyExpiry = Number(await contract.getEmergencyExpiry(patient.address, me));
    if (!profile.isSet || Number(profile.recordId) !== recordId || emergencyExpiry <= now) {
      return res.status(403).json({ error: "You do not have access to this record. It may have expired or been revoked." });
    }
    fileKey = unwrapKey(emergencyKeys.privateKey, profile.wrappedKey);
  }

  const file = await openRecord({ record, fileKey });
  await sendContractTx(
    getSigner(req.user),
    "logAccess",
    [patient.address, recordId],
    `${req.user.email} opened record ${recordId} of ${patient.email}`,
  );
  await sendFile(res, file, req.user);
});

// Break-glass: open a short window on a patient's critical summary.
doctorRouter.post("/emergency", async (req, res) => {
  const { patientId, reason } = req.body || {};
  const patient = await findPatient(patientId);
  const text = String(reason || "").trim();
  if (text.length < 5) throw badRequest("Give a reason for emergency access.");

  await sendContractTx(
    getSigner(req.user),
    "emergencyAccess",
    [patient.address, text],
    `Emergency access by ${req.user.email} to ${patient.email}`,
  );
  const contract = getContract();
  const profile = await contract.getEmergencyProfile(patient.address);
  const expiry = Number(await contract.getEmergencyExpiry(patient.address, req.user.address));
  res.status(201).json({ patientId: String(patient._id), recordId: Number(profile.recordId), expiry });
});
