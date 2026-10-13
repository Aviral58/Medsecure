import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Wallet } from "ethers";
import { config } from "../config.js";
import { User } from "../models/User.js";
import { fundAccount, owner, provider } from "./chain.js";
import { lockPrivateKey, unlockPrivateKey } from "./crypto.js";

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
//
// A user's private key exists in memory only while they have a live session.
// It is unlocked from the keystore with their password at login and wiped:
//   - at logout,
//   - after SESSION_IDLE_MINUTES without any request,
//   - after SESSION_MAX_HOURS in any case,
//   - when the backend restarts.
// Each login gets its own random session id, carried inside the login token,
// so a token stops working the moment its session is closed.

const sessions = new Map(); // session id -> { userId, privateKey, createdAt, lastSeen }

const idleMs = () => config.sessionIdleMinutes * 60_000;
const maxMs = () => config.sessionMaxHours * 3_600_000;

function isExpired(session, now = Date.now()) {
  return now - session.lastSeen > idleMs() || now - session.createdAt > maxMs();
}

/** Start a session for a user who has just proved their password. Returns the session id. */
export function openSession(user, password) {
  const privateKey = user.role === "owner" ? config.ownerPrivateKey : unlockPrivateKey(user.keystore, password);
  const sessionId = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  sessions.set(sessionId, { userId: String(user._id), privateKey, createdAt: now, lastSeen: now });
  user._sessionId = sessionId;
  return sessionId;
}

/**
 * Check a session on every request. Returns true and resets the idle clock
 * if it is still alive; otherwise wipes it and returns false.
 */
export function touchSession(sessionId, user, { countsAsActivity = true } = {}) {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== String(user._id)) return false;
  if (isExpired(session)) {
    sessions.delete(sessionId);
    return false;
  }
  // A page refreshing itself in the background is not the person doing something.
  if (countsAsActivity) session.lastSeen = Date.now();
  user._sessionId = sessionId;
  return true;
}

export function closeSession(user) {
  sessions.delete(user._sessionId);
}

/** End every session of one user (used when their account is locked). */
export function closeAllSessions(user) {
  for (const [sessionId, session] of sessions) {
    if (session.userId === String(user._id)) sessions.delete(sessionId);
  }
}

// Wipe keys of abandoned sessions promptly, even if no request ever arrives.
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (isExpired(session, now)) sessions.delete(sessionId);
  }
}, 15_000).unref();

export function getPrivateKey(user) {
  const session = sessions.get(user._sessionId);
  if (!session) {
    throw Object.assign(new Error("Your session has ended. Log in again."), { status: 401, code: "SESSION_EXPIRED" });
  }
  return session.privateKey;
}

/** The wallet that signs blockchain transactions as this user. */
export function getSigner(user) {
  return user.role === "owner" ? owner : new Wallet(getPrivateKey(user), provider);
}

// ---------------------------------------------------------------------------
// Wrong-password protection
// ---------------------------------------------------------------------------
//
// After LOGIN_MAX_ATTEMPTS wrong passwords in a row, the account is locked
// for LOGIN_LOCK_MINUTES. This slows down password guessing, which matters
// here because the password also unlocks the user's encryption key.

const failures = new Map(); // email -> { count, lockedUntil }

/** Throws if the account is currently locked. */
export function assertNotLocked(email) {
  const entry = failures.get(email);
  if (entry && entry.lockedUntil > Date.now()) {
    const minutes = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
    throw Object.assign(
      new Error(`Too many wrong passwords. This account is locked for ${minutes} more ${minutes === 1 ? "minute" : "minutes"}.`),
      { status: 429, code: "ACCOUNT_LOCKED" },
    );
  }
}

/** Record a wrong password. Returns true if this attempt locked the account. */
export function recordWrongPassword(email) {
  const entry = failures.get(email) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= config.loginMaxAttempts) {
    entry.count = 0;
    entry.lockedUntil = Date.now() + config.loginLockMinutes * 60_000;
  }
  failures.set(email, entry);
  return entry.lockedUntil > Date.now();
}

export function clearWrongPasswords(email) {
  failures.delete(email);
}

/**
 * Ask a logged-in user to prove their password again before a sensitive
 * action. Wrong answers count toward the lock, and a lock ends their sessions.
 */
export async function confirmPassword(user, password) {
  assertNotLocked(user.email);
  if (!password || !(await bcrypt.compare(String(password), user.passwordHash))) {
    if (recordWrongPassword(user.email)) {
      closeAllSessions(user);
      assertNotLocked(user.email);
    }
    throw Object.assign(new Error("Password is incorrect."), { status: 403, code: "WRONG_PASSWORD" });
  }
  clearWrongPasswords(user.email);
}

// ---------------------------------------------------------------------------
// Account creation
// ---------------------------------------------------------------------------

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validateNewAccount({ name, email, password }) {
  if (!name || String(name).trim().length < 2) throw badRequest("Enter a full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))) throw badRequest("Enter a valid email address.");
  const pw = String(password || "");
  if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    throw badRequest("Password must be at least 10 characters and include a letter and a number.");
  }
}

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * Create a blockchain key pair for a new user and give it test ETH for gas.
 * Returns the wallet; the caller registers it on-chain and then saves the user.
 */
export async function createFundedWallet(label) {
  const wallet = Wallet.createRandom().connect(provider);
  await fundAccount(wallet.address, label);
  return wallet;
}

/** Save the user with their password hash and password-locked private key. */
export async function saveUser({ name, email, password, role, hospitalId = 0, wallet }) {
  return User.create({
    name: String(name).trim(),
    email: normalizeEmail(email),
    passwordHash: await bcrypt.hash(password, 10),
    role,
    hospitalId,
    address: wallet.address,
    publicKey: wallet.signingKey.compressedPublicKey,
    keystore: lockPrivateKey(wallet.privateKey, password),
  });
}

/** Make sure the network owner login exists and matches the .env settings. */
export async function ensureOwnerAccount() {
  const passwordHash = await bcrypt.hash(config.ownerPassword, 10);
  await User.deleteMany({ role: "owner", address: { $ne: owner.address } });
  await User.updateOne(
    { address: owner.address },
    {
      $set: { email: config.ownerEmail, passwordHash, role: "owner" },
      $setOnInsert: { name: "Network owner", publicKey: owner.signingKey.compressedPublicKey, hospitalId: 0 },
    },
    { upsert: true },
  );
}

/** Public view of a user, safe to send to the browser. */
export function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    address: user.address,
    hospitalId: user.hospitalId || 0,
  };
}
