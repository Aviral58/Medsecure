import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { User } from "../models/User.js";
import { touchSession } from "../services/accounts.js";

/** A login token names the user and the one session it belongs to. */
export function issueToken(user, sessionId) {
  return jwt.sign({ sub: String(user._id), sid: sessionId }, config.jwtSecret, { expiresIn: `${config.sessionMaxHours}h` });
}

/** Require a valid login token whose session is still alive. */
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Log in to continue.", code: "NOT_LOGGED_IN" });

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: "Your session has ended. Log in again.", code: "SESSION_EXPIRED" });
  }

  const user = await User.findById(payload.sub);
  // touchSession also enforces the idle and maximum-length timeouts.
  // Requests a page makes by itself (marked X-Background) must not keep an
  // unattended session alive, so they do not reset the idle timer.
  const countsAsActivity = req.headers["x-background"] !== "1";
  if (!user || !touchSession(payload.sid, user, { countsAsActivity })) {
    return res.status(401).json({ error: "Your session has ended. Log in again.", code: "SESSION_EXPIRED" });
  }
  req.user = user;
  next();
}

/** Allow only the listed roles. Use after requireAuth. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Your account type cannot do this." });
    }
    next();
  };
}
