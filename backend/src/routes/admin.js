import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { Hospital, parseHospitalDetails } from "../models/Hospital.js";
import { User } from "../models/User.js";
import {
  badRequest,
  createFundedWallet,
  normalizeEmail,
  saveUser,
  validateNewAccount,
} from "../services/accounts.js";
import { Transaction } from "ethers";
import { JournalEntry } from "../models/JournalEntry.js";
import { chainStatus, findEvent, iface, owner, provider, queryEvents, sendContractTx } from "../services/chain.js";
import { ipfsVersion } from "../services/ipfs.js";
import { listHospitals, publicHospital } from "../services/registry.js";

// Routes for the network owner: the party that admits hospitals to the network.
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("owner"));

adminRouter.get("/hospitals", async (req, res) => {
  const [hospitals, users] = await Promise.all([listHospitals(), User.find({}, "name email role address hospitalId")]);
  res.json({
    hospitals: hospitals.map((hospital) => {
      const admin = users.find((u) => u.address.toLowerCase() === hospital.admin.toLowerCase());
      return {
        ...publicHospital(hospital),
        adminName: admin?.name || "",
        adminEmail: admin?.email || "",
        doctorCount: users.filter((u) => u.role === "doctor" && u.hospitalId === hospital.id).length,
      };
    }),
  });
});

// Register a hospital on-chain and create the login for its admin.
adminRouter.post("/hospitals", async (req, res) => {
  const { hospitalName, adminName, adminEmail, adminPassword } = req.body || {};
  if (!hospitalName || String(hospitalName).trim().length < 2) throw badRequest("Enter the hospital name.");
  const details = parseHospitalDetails(req.body);
  validateNewAccount({ name: adminName, email: adminEmail, password: adminPassword });
  if (await User.exists({ email: normalizeEmail(adminEmail) })) throw badRequest("An account with this email already exists.");

  const wallet = await createFundedWallet(`Fund hospital admin account (${normalizeEmail(adminEmail)})`);
  const receipt = await sendContractTx(
    owner,
    "registerHospital",
    [wallet.address, String(hospitalName).trim()],
    `Register hospital ${String(hospitalName).trim()}`,
  );
  const hospitalId = Number(findEvent(receipt, "HospitalRegistered").hospitalId);
  await Hospital.updateOne({ hospitalId }, { $set: details }, { upsert: true });
  await saveUser({
    name: adminName,
    email: adminEmail,
    password: adminPassword,
    role: "hospitalAdmin",
    hospitalId,
    wallet,
  });

  res.status(201).json({ hospital: { id: hospitalId, name: String(hospitalName).trim(), ...details } });
});

// Correct or complete a hospital's details. The name is fixed: it is on the blockchain.
adminRouter.put("/hospitals/:id", async (req, res) => {
  const hospitalId = Number(req.params.id);
  const hospitals = await listHospitals();
  if (!hospitals.some((hospital) => hospital.id === hospitalId)) throw badRequest("Hospital not found.");
  const details = parseHospitalDetails(req.body);
  await Hospital.updateOne({ hospitalId }, { $set: details }, { upsert: true });
  res.json({ ok: true });
});

// A snapshot of the running system, for the owner's dashboard.
// Counts only: the owner never sees whose records these are.
adminRouter.get("/status", async (req, res) => {
  const [chain, ipfs, patients, doctors, hospitals, added, granted, opened, emergencies] = await Promise.all([
    chainStatus(),
    ipfsVersion().catch(() => null),
    User.countDocuments({ role: "patient" }),
    User.countDocuments({ role: "doctor" }),
    User.countDocuments({ role: "hospitalAdmin" }),
    queryEvents("RecordAdded"),
    queryEvents("AccessGranted"),
    queryEvents("RecordAccessed"),
    queryEvents("EmergencyAccessUsed"),
  ]);
  res.json({
    chain,
    ipfs,
    patients,
    doctors,
    hospitals,
    activity: { records: added.length, shares: granted.length, opens: opened.length, emergencyUses: emergencies.length },
  });
});

// What each smart contract function means, in plain words.
const ACTIONS = {
  registerHospital: "Hospital registered",
  registerPatient: "Patient registered",
  registerDoctor: "Doctor registered",
  verifyDoctor: "Doctor verified",
  setEmergencyDoctor: "Emergency role changed",
  addRecord: "Record added",
  grantAccess: "Access granted",
  revokeAccess: "Access revoked",
  logAccess: "Record opened",
  setEmergencyRecord: "Emergency summary set",
  emergencyAccess: "Emergency access used",
};

// The blockchain ledger: the most recent transactions, newest first.
// It shows what a node operator can see anyway: the kind of action, the
// sending address and the time. Names, emails and record contents are not here.
adminRouter.get("/ledger", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 200);
  const [entries, total] = await Promise.all([
    JournalEntry.find({ timestamp: { $ne: null } }).sort({ seq: -1 }).limit(limit),
    JournalEntry.countDocuments(),
  ]);
  const transactions = [];
  for (const entry of entries) {
    const tx = Transaction.from(entry.raw);
    let action = "Other";
    let contractCall = "";
    if (tx.to === null) action = "Smart contract deployed";
    else if (tx.data === "0x") action = "Account funded with test ETH";
    else {
      contractCall = iface.parseTransaction({ data: tx.data })?.name || "";
      action = ACTIONS[contractCall] || contractCall || "Other";
    }
    const receipt = await provider.getTransactionReceipt(entry.hash).catch(() => null);
    transactions.push({
      number: entry.seq,
      hash: entry.hash,
      block: receipt ? receipt.blockNumber : null,
      gasUsed: receipt ? Number(receipt.gasUsed) : null,
      succeeded: receipt ? receipt.status === 1 : null,
      action,
      contractCall,
      from: tx.from,
      time: entry.timestamp,
    });
  }
  res.json({ transactions, total });
});
