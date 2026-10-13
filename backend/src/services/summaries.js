import crypto from "node:crypto";
import { answerQuestion, suggestQuestions } from "../ml/ask.js";
import { extractDocument } from "../ml/extractText.js";
import { llmEnabled, rewordSummary } from "../ml/llm.js";
import { summariseDocument } from "../ml/summarize.js";

// Builds AI summaries and hands them to the browser.
//
// A summary is made once, when a record is uploaded, from the same plain
// bytes that are about to be encrypted. It is then stored INSIDE the
// encrypted record. It is never written to the database or the blockchain.

/**
 * Read and summarise an uploaded file.
 * Returns { summary, source, ocrText }:
 *   summary  the AI summary, or null if the file has no readable text
 *   source   how the text was obtained: "pdf", "text", "ocr", "scanned-pdf" or "none"
 *   ocrText  for a photo or scan, the text that was read from it (kept with the record)
 */
export async function buildSummary(file, recordType, { useLanguageModel = true } = {}) {
  const document = await extractDocument(file);
  const { text, source } = document;
  const summary = summariseDocument(text, recordType, { source, confidence: document.confidence });
  const result = { summary, source, ocrText: source === "ocr" && summary ? text : null };
  if (!summary) return result;

  if (useLanguageModel && llmEnabled()) {
    const reworded = await rewordSummary(summary, text);
    if (reworded.rejected) {
      summary.languageModel = { used: false, reason: reworded.rejected };
    } else {
      // Keep the standing safety line the model is not asked to write.
      const safety = summary.forPatient.points[summary.forPatient.points.length - 1];
      summary.forDoctor = reworded.forDoctor;
      summary.forPatient = { headline: reworded.forPatient.headline, points: [...reworded.forPatient.points, safety] };
      summary.generatedBy = `MedSecure summariser, worded by ${reworded.model} running on this computer`;
      summary.languageModel = { used: true, model: reworded.model };
    }
  }
  return result;
}

/**
 * What the AI needs for a record that has just been decrypted: its summary
 * (built on the spot for records uploaded before summaries existed) and its
 * plain text, so questions about it can be answered while it is open.
 */
export async function readingMaterial(file, { allowOcr = true } = {}) {
  let text = file.text || ""; // text read from a picture when the record was uploaded
  let source = text ? "ocr" : "text";
  let confidence = null;
  if (!text) {
    const isPicture = String(file.mimeType || "").startsWith("image/");
    if (isPicture && !allowOcr) return { summary: file.summary || null, text: "" };
    const document = await extractDocument({ buffer: file.data, mimetype: file.mimeType, originalname: file.filename });
    ({ text, source, confidence } = { confidence: null, ...document });
  }
  const summary = file.summary || summariseDocument(text, "", { source, confidence });
  return { summary: summary || null, text: summary ? text : "" };
}

// ---------------------------------------------------------------------------
// One-time tickets
// ---------------------------------------------------------------------------
// The file itself is sent as a download, so the summary cannot ride along in
// the same reply. Instead the reply carries a random ticket. The browser
// swaps it for the summary straight away. A ticket works once, for the same
// user, for two minutes, and lives only in memory. This way opening a record
// is still ONE access: one permission check, one audit entry, one "open" used.

const tickets = new Map(); // ticket -> { userId, summary, text, expires }

export function issueSummaryTicket(user, material) {
  const ticket = crypto.randomBytes(24).toString("hex");
  tickets.set(ticket, { userId: String(user._id), ...material, expires: Date.now() + 120_000 });
  return ticket;
}

/**
 * Swap a ticket for the summary. If the record has readable text, this also
 * opens a "reading session" so the person can ask questions about it.
 * Returns undefined for a ticket that is unknown, used, expired or someone else's.
 */
export function redeemSummaryTicket(user, ticket) {
  const entry = tickets.get(ticket);
  if (!entry || entry.userId !== String(user._id) || entry.expires < Date.now()) return undefined;
  tickets.delete(ticket);
  const audience = user.role === "doctor" ? "doctor" : "patient";
  return {
    summary: entry.summary,
    ask: entry.summary && entry.text ? openReadingSession(user, entry, audience) : null,
  };
}

// ---------------------------------------------------------------------------
// Reading sessions: asking questions about a record that is open
// ---------------------------------------------------------------------------
// While someone has a record open, its text and summary are held in memory so
// their questions can be answered without decrypting it again. That means:
//   - asking questions is part of the SAME access that opened the record:
//     no new permission is needed and none is bypassed
//   - the text is never stored. It is dropped when the viewer is closed, after
//     10 minutes without a question, or 30 minutes at most
//   - a session belongs to one user and cannot be used by anyone else

const READING_IDLE_MS = 10 * 60_000;
const READING_MAX_MS = 30 * 60_000;
const MAX_QUESTIONS = 40;
const readingSessions = new Map(); // token -> { userId, summary, text, audience, context, created, lastUsed, questions }

function openReadingSession(user, material, audience) {
  const token = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  readingSessions.set(token, {
    userId: String(user._id),
    summary: material.summary,
    text: material.text,
    audience,
    context: null, // what the last question was about, for follow-ups
    created: now,
    lastUsed: now,
    questions: 0,
  });
  return { token, suggestions: suggestQuestions(material.summary, audience) };
}

function liveSession(user, token) {
  const session = readingSessions.get(token);
  if (!session || session.userId !== String(user._id)) return null;
  const now = Date.now();
  if (now - session.lastUsed > READING_IDLE_MS || now - session.created > READING_MAX_MS) {
    readingSessions.delete(token);
    return null;
  }
  return session;
}

/** Answer a question inside a reading session. Returns null if the session is gone. */
export function askInSession(user, token, question) {
  const session = liveSession(user, token);
  if (!session) return null;
  if (session.questions >= MAX_QUESTIONS) {
    return {
      kind: "limit",
      answer: "That is the limit of questions for one opening of this record. Close it and open it again to continue.",
      basis: [],
      followUps: [],
      corrections: [],
    };
  }
  session.questions += 1;
  session.lastUsed = Date.now();
  const result = answerQuestion({
    question,
    text: session.text,
    summary: session.summary,
    audience: session.audience,
    context: session.context,
  });
  session.context = result.context;
  return result;
}

export function closeReadingSession(user, token) {
  const session = readingSessions.get(token);
  if (session && session.userId === String(user._id)) readingSessions.delete(token);
}

setInterval(() => {
  const now = Date.now();
  for (const [ticket, entry] of tickets) if (entry.expires < now) tickets.delete(ticket);
  for (const [token, session] of readingSessions) {
    if (now - session.lastUsed > READING_IDLE_MS || now - session.created > READING_MAX_MS) readingSessions.delete(token);
  }
}, 30_000).unref();
