import { config } from "../config.js";

// Optional: let a language model running ON THIS COMPUTER (through Ollama)
// reword the summary so it reads more naturally.
//
// It is off unless AI_SUMMARY_MODEL is set in backend/.env. The built-in
// summariser has already extracted the facts; the model is only asked to
// phrase them, and its answer is thrown away unless it passes two checks:
//   1. it is valid JSON in the expected shape
//   2. every number it mentions really appears in the document
// So a model that invents a value or a dose cannot get its text shown.
// Nothing is sent anywhere except to the local Ollama address.

export function llmEnabled() {
  return Boolean(config.aiSummaryModel);
}

function buildPrompt(summary, text) {
  const facts = {
    recordType: summary.recordType,
    keyPoints: summary.forDoctor.points,
    labValues: summary.findings.map((f) => `${f.name} ${f.value} ${f.unit} (${f.status}, reference ${f.reference})`),
    medicines: summary.medicines.map((m) => [m.name, m.strength, m.frequency, m.duration].filter(Boolean).join(", ")),
    ...summary.facts,
  };
  return [
    "You are writing two short summaries of ONE medical document.",
    "Rules:",
    "- Use ONLY facts found in the document or in the extracted facts below.",
    "- Do NOT add any diagnosis, cause, advice, value or number that is not there.",
    "- doctor: clinical wording, one headline sentence and at most 5 short points.",
    "- patient: plain everyday language with no medical jargon, one headline sentence and at most 5 short points.",
    'Answer with JSON only, in this shape: {"doctor":{"headline":"...","points":["..."]},"patient":{"headline":"...","points":["..."]}}',
    "",
    "Extracted facts: " + JSON.stringify(facts),
    "",
    "Document:",
    text.slice(0, 3500),
  ].join("\n");
}

function validShape(part) {
  return (
    part &&
    typeof part.headline === "string" &&
    part.headline.trim().length > 0 &&
    part.headline.length <= 400 &&
    Array.isArray(part.points) &&
    part.points.length <= 8 &&
    part.points.every((p) => typeof p === "string" && p.length <= 500)
  );
}

const UNIT_AFTER = /^\s?(mg|mcg|g\b|ml|iu|units?|%|g\/dl|mg\/dl|mmol|u\/l|days?|weeks?|months?|years?|yrs?|hours?|hrs?|times|cm|mm|kg|bpm|mmhg)/i;

/** Numbers in `output` that appear nowhere in `source`. Small plain counts ("3 medicines") are allowed. */
export function ungroundedNumbers(output, source) {
  const known = new Set((source.match(/\d+(?:\.\d+)?/g) || []).map(Number));
  const invented = [];
  for (const match of output.matchAll(/\d+(?:\.\d+)?/g)) {
    const value = Number(match[0]);
    if (known.has(value)) continue;
    const after = output.slice(match.index + match[0].length, match.index + match[0].length + 8);
    if (Number.isInteger(value) && value <= 10 && !UNIT_AFTER.test(after)) continue;
    invented.push(match[0]);
  }
  return invented;
}

/**
 * Ask the local model to reword a built-in summary.
 * Returns { forDoctor, forPatient, model } or { rejected: reason }.
 */
export async function rewordSummary(summary, text) {
  if (!llmEnabled()) return { rejected: "no local language model configured" };

  let answer;
  try {
    const response = await fetch(`${config.aiSummaryUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(config.aiSummaryTimeoutSeconds * 1000),
      body: JSON.stringify({
        model: config.aiSummaryModel,
        prompt: buildPrompt(summary, text),
        stream: false,
        format: "json",
        options: { temperature: 0.1, num_predict: 600 },
      }),
    });
    if (!response.ok) return { rejected: `the local model returned HTTP ${response.status}` };
    answer = (await response.json()).response;
  } catch (error) {
    return { rejected: error?.name === "TimeoutError" ? "the local model took too long" : "the local model is not running" };
  }

  let parsed;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return { rejected: "the local model did not return valid JSON" };
  }
  if (!validShape(parsed.doctor) || !validShape(parsed.patient)) {
    return { rejected: "the local model's answer was not in the expected shape" };
  }

  const said = JSON.stringify([parsed.doctor, parsed.patient]);
  const source = text + " " + JSON.stringify([summary.forDoctor, summary.forPatient, summary.findings, summary.medicines, summary.facts]);
  const invented = ungroundedNumbers(said, source);
  if (invented.length > 0) {
    return { rejected: `the local model mentioned numbers that are not in the document (${invented.slice(0, 3).join(", ")})` };
  }

  const clean = (part) => ({ headline: part.headline.trim(), points: part.points.map((p) => p.trim()).filter(Boolean) });
  return { forDoctor: clean(parsed.doctor), forPatient: clean(parsed.patient), model: config.aiSummaryModel };
}
