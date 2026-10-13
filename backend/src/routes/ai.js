import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { accessModelInfo } from "../ml/accessAnomaly.js";
import { extractDocument } from "../ml/extractText.js";
import { ocrModelInfo } from "../ml/ocr.js";
import fs from "node:fs";
import { llmEnabled } from "../ml/llm.js";
import { classifyRecordText, recordTypeModelInfo } from "../ml/recordType.js";
import { summaryModelInfo } from "../ml/summarize.js";
import { askModelInfo } from "../ml/ask.js";
import { askInSession, closeReadingSession, redeemSummaryTicket } from "../services/summaries.js";

const askMetrics = JSON.parse(fs.readFileSync(new URL("../ml/models/ask-metrics.json", import.meta.url), "utf8"));

const summaryMetrics = JSON.parse(fs.readFileSync(new URL("../ml/models/summary-metrics.json", import.meta.url), "utf8"));
const ocrMetrics = JSON.parse(fs.readFileSync(new URL("../ml/models/ocr-metrics.json", import.meta.url), "utf8"));

// AI helpers. Both models run inside this backend process: no document and
// no log entry is ever sent to another service.
export const aiRouter = Router();
aiRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

// Suggest a record type for a file that is about to be uploaded.
// The file is read in memory, classified and forgotten. Nothing is stored,
// and the person uploading still decides the type.
aiRouter.post("/classify", requireRole("patient", "doctor"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a file first." });

  const { text, source } = await extractDocument(req.file);
  // readFrom tells the form how the file was read: "ocr" means from a picture.
  if (text.trim().length < 40) {
    return res.json({ suggestion: null, reason: source === "scanned-pdf" ? "scanned-pdf" : "no-text", readFrom: source });
  }
  const result = classifyRecordText(text);
  if (!result.confident) {
    return res.json({ suggestion: null, reason: "unsure", readFrom: source });
  }
  res.json({ suggestion: { recordType: result.recordType, confidence: Number(result.confidence.toFixed(3)) }, readFrom: source });
});

// Swap the one-time ticket that came with an opened record for its AI summary.
aiRouter.get("/summary/:ticket", (req, res) => {
  const opened = redeemSummaryTicket(req.user, req.params.ticket);
  if (opened === undefined) return res.status(404).json({ error: "This summary link has already been used or has expired." });
  res.json(opened); // { summary, ask: { token, suggestions } | null }
});

// Ask a question about the record that is open. The answer comes only from
// that record, and requests for medical advice are declined.
aiRouter.post("/ask/:token", (req, res) => {
  const question = String(req.body?.question || "").trim();
  if (question.length < 2) return res.status(400).json({ error: "Type a question about this report." });
  if (question.length > 300) return res.status(400).json({ error: "Keep the question under 300 characters." });

  const result = askInSession(req.user, req.params.token, question);
  if (!result) return res.status(410).json({ error: "This record is no longer open for questions. Open it again to ask." });
  res.json({
    question,
    answer: result.answer,
    basis: result.basis,
    kind: result.kind,
    corrections: result.corrections || [], // misspelt names that were understood, e.g. "haemoglobn"
    followUps: result.followUps || [], // questions that follow on from this answer
    carriedOver: Boolean(result.carriedOver), // the subject came from the previous question
  });
});

// Called when the viewer is closed: forget the record's text straight away.
aiRouter.delete("/ask/:token", (req, res) => {
  closeReadingSession(req.user, req.params.token);
  res.json({ ok: true });
});

// What the models are and how they were built and tested.
aiRouter.get("/models", (req, res) => {
  res.json({
    models: [
      { ...summaryModelInfo, metrics: summaryMetrics, languageModel: llmEnabled() ? config.aiSummaryModel : null },
      { ...askModelInfo, metrics: { ...askModelInfo.metrics, ...askMetrics } },
      { ...ocrModelInfo, metrics: ocrMetrics },
      recordTypeModelInfo,
      accessModelInfo,
    ],
  });
});
