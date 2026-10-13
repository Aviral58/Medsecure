import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { User } from "../models/User.js";
import { accessModelInfo, findUnusualAccess, publicAlert } from "../services/accessMonitor.js";
import { badRequest, confirmPassword, getPrivateKey, getSigner } from "../services/accounts.js";
import { patientActivity } from "../services/audit.js";
import { blockTime, getContract, queryEvents, sendContractTx } from "../services/chain.js";
import { emergencyKeys, unwrapKey, wrapKey } from "../services/crypto.js";
import { findReportDate, rangeBounds, testKey } from "../ml/summarize.js";
import { loadRecord, openRecord, sendFile, storeRecord } from "../services/records.js";
import { readingMaterial } from "../services/summaries.js";
import { buildDirectory, formatRecord, listHospitals, publicHospital } from "../services/registry.js";

// Routes for a patient: their records, who can see them, and the activity log.
export const patientRouter = Router();
patientRouter.use(requireAuth, requireRole("patient"));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });
const nowSeconds = () => Math.floor(Date.now() / 1000);
const UNLIMITED_VIEWS = 0xffffffff; // UNLIMITED_VIEWS in the contract
const viewsLeft = (grant) => (Number(grant.viewsLeft) === UNLIMITED_VIEWS ? null : Number(grant.viewsLeft));

// ---- Records ---------------------------------------------------------------

patientRouter.get("/records", async (req, res) => {
  const contract = getContract();
  const [records, profile, directory, hospitals] = await Promise.all([
    contract.getRecords(req.user.address),
    contract.getEmergencyProfile(req.user.address),
    buildDirectory(),
    listHospitals(),
  ]);
  // Full details of every hospital that has added to this patient's file.
  const counts = new Map();
  for (const record of records) {
    const hospitalId = directory.lookup(record.uploader).hospitalId;
    if (hospitalId) counts.set(hospitalId, (counts.get(hospitalId) || 0) + 1);
  }
  res.json({
    hospitals: hospitals
      .filter((hospital) => counts.has(hospital.id))
      .map((hospital) => ({ ...publicHospital(hospital), recordCount: counts.get(hospital.id) })),
    records: Array.from(records)
      .map((record, id) => {
        const uploader = directory.lookup(record.uploader);
        return {
          ...formatRecord(record, id),
          uploaderName: uploader.address === req.user.address ? "You" : uploader.name,
          uploaderHospital: uploader.hospitalName,
          hospitalId: uploader.hospitalId, // 0 when the patient added it themselves
          isEmergencySummary: profile.isSet && Number(profile.recordId) === id,
        };
      })
      .reverse(),
  });
});

patientRouter.post("/records", upload.single("file"), async (req, res) => {
  const result = await storeRecord({
    uploader: req.user,
    patient: req.user,
    file: req.file,
    recordType: req.body.recordType,
  });
  res.status(201).json(result);
});

patientRouter.get("/records/:id/file", async (req, res) => {
  const record = await loadRecord(req.user.address, req.params.id);
  const fileKey = unwrapKey(getPrivateKey(req.user), record.wrappedKey);
  await sendFile(res, await openRecord({ record, fileKey }), req.user);
});

// Nominate one record as the critical summary for emergencies. Its key is
// additionally wrapped with the network emergency key.
patientRouter.post("/records/:id/emergency", async (req, res) => {
  const record = await loadRecord(req.user.address, req.params.id);
  const fileKey = unwrapKey(getPrivateKey(req.user), record.wrappedKey);
  await sendContractTx(
    getSigner(req.user),
    "setEmergencyRecord",
    [Number(req.params.id), wrapKey(emergencyKeys.publicKey, fileKey)],
    `Set emergency summary (${req.user.email})`,
  );
  res.json({ ok: true });
});

// ---- Health trends -----------------------------------------------------------

// Each lab result the AI found in the patient's reports, grouped by test and
// put in date order, so a test can be followed from one report to the next.
//
// The patient's own key opens each of their records here, in memory, exactly
// as when they open one by hand. Nothing is stored, and no doctor can call
// this: a doctor sees only the single records shared with them.
patientRouter.get("/trends", async (req, res) => {
  const records = await getContract().getRecords(req.user.address);
  const privateKey = getPrivateKey(req.user);
  const series = new Map(); // "test|unit" -> { test, unit, points }
  let reportsRead = 0;

  for (let id = 0; id < records.length; id++) {
    const record = records[id];
    let material;
    try {
      const file = await openRecord({ record, fileKey: unwrapKey(privateKey, record.wrappedKey) });
      // Pictures uploaded before OCR existed are skipped rather than read again on every visit.
      material = await readingMaterial(file, { allowOcr: false });
    } catch {
      continue; // a record that cannot be opened is left out, not fatal
    }
    const findings = (material.summary?.findings || []).filter((finding) => finding.status !== "unclear");
    if (findings.length === 0) continue;
    reportsRead += 1;

    const uploaded = new Date(Number(record.timestamp) * 1000).toISOString().slice(0, 10);
    const reportDate = material.summary.facts?.reportDate || findReportDate(material.text) || "";
    for (const finding of findings) {
      const test = finding.key || testKey(finding.name);
      const unit = finding.unit || "";
      const key = `${test}|${unit.toLowerCase()}`;
      if (!series.has(key)) series.set(key, { test, unit, points: [] });
      series.get(key).points.push({
        date: reportDate || uploaded,
        dateFromReport: Boolean(reportDate), // false: the report had no date, so the upload date is used
        value: finding.value,
        status: finding.status,
        reference: finding.reference,
        ...rangeBounds(finding.reference),
        recordId: id,
        recordType: record.recordType,
        readFromPicture: material.summary.source === "ocr",
      });
    }
  }

  const tests = [...series.values()].map((entry) => {
    // The same report is sometimes in a file twice (a PDF and a photo of it).
    // Two results with the same date and value are one measurement, so only
    // one is kept: the one read from typed text, if there is a choice.
    const points = [];
    for (const point of entry.points.sort((a, b) => a.date.localeCompare(b.date) || Number(a.readFromPicture) - Number(b.readFromPicture) || a.recordId - b.recordId)) {
      const previous = points[points.length - 1];
      if (previous && previous.date === point.date && previous.value === point.value) continue;
      points.push(point);
    }
    const latest = points[points.length - 1];
    const previous = points.length > 1 ? points[points.length - 2] : null;
    return {
      ...entry,
      points,
      latest,
      // How the newest result compares with the one before it.
      change: previous ? Number((latest.value - previous.value).toFixed(3)) : null,
    };
  });
  // Tests seen in several reports first, then those whose newest result is out of range.
  tests.sort(
    (a, b) =>
      Math.min(b.points.length, 2) - Math.min(a.points.length, 2) ||
      Number(b.latest.status !== "normal") - Number(a.latest.status !== "normal") ||
      b.points.length - a.points.length ||
      a.test.localeCompare(b.test),
  );
  res.json({ tests, reportsRead, records: records.length });
});

// ---- Sharing ---------------------------------------------------------------

// Verified doctors the patient can share with.
patientRouter.get("/doctors", async (req, res) => {
  const contract = getContract();
  const [doctors, directory] = await Promise.all([User.find({ role: "doctor" }).sort({ name: 1 }), buildDirectory()]);
  const result = [];
  for (const doctor of doctors) {
    if (await contract.isVerifiedDoctor(doctor.address)) {
      result.push({
        id: String(doctor._id),
        name: doctor.name,
        hospitalName: directory.hospitalNames.get(doctor.hospitalId) || "",
      });
    }
  }
  res.json({ doctors: result });
});

// Share one or several records with one doctor, for a limited time and a
// limited number of opens. The patient must re-enter their password: an
// unlocked screen is not enough to give someone access.
//
// A patient's file can hold records from many hospitals, so `recordIds` lets
// them hand a new doctor the relevant history in one step. On the blockchain
// each record still gets its own grant, with its own key and its own limits.
patientRouter.post("/grants", async (req, res) => {
  const { doctorId, recordId, recordIds, minutes, maxViews, password } = req.body || {};
  const duration = Math.round(Number(minutes) * 60);
  if (!Number.isFinite(duration) || duration < 60) throw badRequest("Choose how long to share for.");
  if (duration > config.maxShareDays * 24 * 3600) {
    throw badRequest(`Sharing is limited to ${config.maxShareDays} days at a time.`);
  }
  const unlimited = maxViews === null || maxViews === undefined || maxViews === "";
  const views = unlimited ? UNLIMITED_VIEWS : Number(maxViews);
  if (!Number.isInteger(views) || views < 1 || (!unlimited && views > 1000)) {
    throw badRequest("Choose how many times the record may be opened.");
  }
  const ids = [...new Set((Array.isArray(recordIds) ? recordIds : [recordId]).map(Number))];
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id))) throw badRequest("Choose at least one record.");
  if (ids.length > 50) throw badRequest("Share at most 50 records at a time.");

  await confirmPassword(req.user, password);

  const doctor = await User.findOne({ _id: doctorId, role: "doctor" }).catch(() => null);
  if (!doctor) throw badRequest("Choose a doctor.");

  const contract = getContract();
  const onChainDoctor = await contract.getUser(doctor.address);
  // Load every record first, so a bad id stops the request before anything is shared.
  const records = [];
  for (const id of ids) records.push(await loadRecord(req.user.address, id));

  const privateKey = getPrivateKey(req.user);
  const signer = getSigner(req.user);
  for (let i = 0; i < ids.length; i++) {
    // Unwrap the file key with the patient's key, re-wrap it for the doctor.
    const fileKey = unwrapKey(privateKey, records[i].wrappedKey);
    const wrappedForDoctor = wrapKey(onChainDoctor.publicKey, fileKey);
    await sendContractTx(
      signer,
      "grantAccess",
      [doctor.address, ids[i], duration, views, wrappedForDoctor],
      `Grant ${doctor.email} access to record ${ids[i]} of ${req.user.email}`,
    );
  }
  res.status(201).json({ ok: true, shared: ids.length, expiry: nowSeconds() + duration });
});

patientRouter.post("/grants/revoke", async (req, res) => {
  const { doctorId, recordId } = req.body || {};
  const doctor = await User.findOne({ _id: doctorId, role: "doctor" }).catch(() => null);
  if (!doctor) throw badRequest("Choose a doctor.");
  await sendContractTx(
    getSigner(req.user),
    "revokeAccess",
    [doctor.address, Number(recordId)],
    `Revoke ${doctor.email} access to record ${recordId} of ${req.user.email}`,
  );
  res.json({ ok: true });
});

// Everyone who can currently open one of the patient's records.
patientRouter.get("/grants", async (req, res) => {
  const contract = getContract();
  const me = req.user.address;
  const [records, directory, grantLogs, emergencyLogs] = await Promise.all([
    contract.getRecords(me),
    buildDirectory(),
    queryEvents("AccessGranted", [me]),
    queryEvents("EmergencyAccessUsed", [me]),
  ]);
  const now = nowSeconds();

  // The newest grant event per (doctor, record) pair tells us when it started.
  const latest = new Map();
  for (const log of grantLogs) latest.set(`${log.args.provider}|${log.args.recordId}`, log);

  const grants = [];
  for (const log of latest.values()) {
    const recordId = Number(log.args.recordId);
    const grant = await contract.getGrant(me, recordId, log.args.provider);
    const expiry = Number(grant.expiry);
    if (expiry <= now) continue; // expired, revoked or used up
    const doctor = directory.lookup(log.args.provider);
    grants.push({
      viewsLeft: viewsLeft(grant),
      doctorId: doctor.id,
      doctorName: doctor.name,
      hospitalName: doctor.hospitalName,
      recordId,
      recordType: records[recordId]?.recordType || "record",
      grantedAt: await blockTime(log.blockNumber),
      expiry,
    });
  }
  grants.sort((a, b) => a.expiry - b.expiry);

  const emergencyWindows = [];
  const seen = new Set();
  for (const log of emergencyLogs) {
    if (seen.has(log.args.doctor)) continue;
    seen.add(log.args.doctor);
    const expiry = Number(await contract.getEmergencyExpiry(me, log.args.doctor));
    if (expiry <= now) continue;
    const doctor = directory.lookup(log.args.doctor);
    emergencyWindows.push({ doctorName: doctor.name, hospitalName: doctor.hospitalName, expiry });
  }

  res.json({ grants, emergencyWindows, now });
});

// ---- Activity --------------------------------------------------------------

// Unusual activity that touched this patient's records. The patient is told
// which of their own records were involved, and how the doctor's hour looked
// in total, but nothing about any other patient.
patientRouter.get("/alerts", async (req, res) => {
  const me = req.user.address.toLowerCase();
  const records = await getContract().getRecords(req.user.address);
  const alerts = (await findUnusualAccess())
    .filter((window) => window.patients.includes(me))
    .map((window) => {
      const mine = window.events.filter((event) => event.patient.toLowerCase() === me);
      const opens = mine.filter((event) => event.kind === "open");
      const timesByRecord = new Map();
      for (const event of opens) timesByRecord.set(event.recordId, (timesByRecord.get(event.recordId) || 0) + 1);
      return {
        ...publicAlert(window),
        yourOpens: opens.length,
        yourRecords: [...timesByRecord].map(([recordId, times]) => ({
          recordType: records[recordId]?.recordType || "record",
          times,
        })),
        emergencyAccessToYou: mine.some((event) => event.kind === "emergency"),
      };
    });
  res.json({ alerts, model: accessModelInfo });
});

patientRouter.get("/activity", async (req, res) => {
  res.json({ activity: await patientActivity(req.user.address) });
});
