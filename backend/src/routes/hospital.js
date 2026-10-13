import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { Hospital, parseHospitalDetails } from "../models/Hospital.js";
import { User } from "../models/User.js";
import { accessModelInfo, findUnusualAccess, publicAlert } from "../services/accessMonitor.js";
import { getSigner } from "../services/accounts.js";
import { getContract, sendContractTx } from "../services/chain.js";
import { listHospitals, publicHospital } from "../services/registry.js";

// Routes for a hospital admin: verify the hospital's own doctors.
export const hospitalRouter = Router();
hospitalRouter.use(requireAuth, requireRole("hospitalAdmin"));

async function findOwnDoctor(req) {
  const doctor = await User.findOne({ _id: req.params.id, role: "doctor", hospitalId: req.user.hospitalId }).catch(() => null);
  if (!doctor) throw Object.assign(new Error("Doctor not found in your hospital."), { status: 404 });
  return doctor;
}

// The admin's own hospital: its on-chain name plus its details.
hospitalRouter.get("/profile", async (req, res) => {
  const hospital = (await listHospitals()).find((h) => h.id === req.user.hospitalId);
  res.json({ hospital: publicHospital(hospital) });
});

// A hospital admin keeps their own hospital's details up to date.
hospitalRouter.put("/profile", async (req, res) => {
  const details = parseHospitalDetails(req.body);
  await Hospital.updateOne({ hospitalId: req.user.hospitalId }, { $set: details }, { upsert: true });
  res.json({ ok: true });
});

// Unusual access by this hospital's own doctors, found by the anomaly model.
// The admin sees what the doctor did in numbers, never which patients.
hospitalRouter.get("/alerts", async (req, res) => {
  const alerts = (await findUnusualAccess())
    .filter((window) => window.doctorInfo.hospitalId === req.user.hospitalId)
    .map(publicAlert);
  res.json({ alerts, model: accessModelInfo });
});

hospitalRouter.get("/doctors", async (req, res) => {
  const contract = getContract();
  const doctors = await User.find({ role: "doctor", hospitalId: req.user.hospitalId }).sort({ createdAt: 1 });
  const result = [];
  for (const doctor of doctors) {
    const onChain = await contract.getUser(doctor.address);
    result.push({
      id: String(doctor._id),
      name: doctor.name,
      email: doctor.email,
      address: doctor.address,
      verified: onChain.verified,
      emergencyDoctor: onChain.emergencyDoctor,
      joined: doctor.createdAt,
    });
  }
  res.json({ doctors: result });
});

hospitalRouter.post("/doctors/:id/verify", async (req, res) => {
  const doctor = await findOwnDoctor(req);
  await sendContractTx(getSigner(req.user), "verifyDoctor", [doctor.address], `Verify doctor ${doctor.email}`);
  res.json({ ok: true });
});

hospitalRouter.post("/doctors/:id/emergency", async (req, res) => {
  const doctor = await findOwnDoctor(req);
  const enabled = Boolean(req.body?.enabled);
  await sendContractTx(
    getSigner(req.user),
    "setEmergencyDoctor",
    [doctor.address, enabled],
    `${enabled ? "Give" : "Remove"} emergency role: ${doctor.email}`,
  );
  res.json({ ok: true });
});
