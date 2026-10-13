import bcrypt from "bcryptjs";
import { Router } from "express";
import { issueToken, requireAuth } from "../middleware/auth.js";
import { User } from "../models/User.js";
import { config } from "../config.js";
import {
  assertNotLocked,
  badRequest,
  clearWrongPasswords,
  closeSession,
  createFundedWallet,
  normalizeEmail,
  openSession,
  publicUser,
  recordWrongPassword,
  saveUser,
  validateNewAccount,
} from "../services/accounts.js";
import { getContract, sendContractTx } from "../services/chain.js";
import { hospitalLabel, listHospitals } from "../services/registry.js";

export const authRouter = Router();

/** Everything the frontend needs to know about the logged-in user. */
async function sessionPayload(user) {
  const payload = publicUser(user);
  payload.sessionIdleMinutes = config.sessionIdleMinutes;
  if (user.hospitalId) {
    payload.hospitalName = await hospitalLabel(user.hospitalId);
  }
  if (user.role === "doctor") {
    const onChain = await getContract().getUser(user.address);
    payload.verified = onChain.verified;
    payload.emergencyDoctor = onChain.emergencyDoctor;
  }
  return payload;
}

// Hospitals a new doctor can choose from.
authRouter.get("/hospitals", async (req, res) => {
  const hospitals = await listHospitals();
  res.json({
    hospitals: hospitals.map(({ id, label, state }) => ({ id, name: state ? `${label}, ${state}` : label })),
  });
});

// Patients and doctors sign themselves up. Hospital admins are created by the
// network owner, and the owner account is created at first start.
authRouter.post("/signup", async (req, res) => {
  const { name, email, password, role } = req.body || {};
  validateNewAccount({ name, email, password });
  if (!["patient", "doctor"].includes(role)) throw badRequest("Choose patient or doctor.");
  if (await User.exists({ email: normalizeEmail(email) })) throw badRequest("An account with this email already exists.");

  let hospitalId = 0;
  if (role === "doctor") {
    hospitalId = Number(req.body.hospitalId);
    const count = Number(await getContract().hospitalCount());
    if (!Number.isInteger(hospitalId) || hospitalId < 1 || hospitalId > count) throw badRequest("Choose your hospital.");
  }

  // 1. key pair + gas money  2. register on-chain, signed by the new user  3. save
  const wallet = await createFundedWallet(`Fund new ${role} account (${normalizeEmail(email)})`);
  const publicKey = wallet.signingKey.compressedPublicKey;
  if (role === "patient") {
    await sendContractTx(wallet, "registerPatient", [publicKey], `Register patient ${normalizeEmail(email)}`);
  } else {
    await sendContractTx(wallet, "registerDoctor", [publicKey, hospitalId], `Register doctor ${normalizeEmail(email)}`);
  }
  const user = await saveUser({ name, email, password, role, hospitalId, wallet });

  const sessionId = openSession(user, password);
  res.status(201).json({ token: issueToken(user, sessionId), user: await sessionPayload(user) });
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const address = normalizeEmail(email);
  assertNotLocked(address);

  const user = await User.findOne({ email: address });
  if (!user || !password || !(await bcrypt.compare(String(password), user.passwordHash))) {
    // Count the miss whether or not the account exists, so the reply never
    // reveals which emails are registered.
    if (recordWrongPassword(address)) assertNotLocked(address);
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  clearWrongPasswords(address);
  const sessionId = openSession(user, String(password));
  res.json({ token: issueToken(user, sessionId), user: await sessionPayload(user) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: await sessionPayload(req.user) });
});

authRouter.post("/logout", requireAuth, (req, res) => {
  closeSession(req.user);
  res.json({ ok: true });
});
