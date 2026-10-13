// Measures "Ask about this report":
//   1. how often the full resolver (keyword rules + trained model) picks the
//      right kind of question, on phrasings held out of training
//   2. how reliably requests for medical advice are caught
//   3. a set of real questions against sample documents, with expected answers
//   4. spelling mistakes: how many misspelt test and medicine names are
//      corrected, and how often an ordinary word is wrongly "corrected"
//   5. conversations: follow-up questions that depend on the one before
//   node test/ask-eval.mjs
import fs from "node:fs";
import { answerQuestion, correctSpelling, resolveIntent } from "../src/ml/ask.js";
import { summariseDocument } from "../src/ml/summarize.js";

const held = JSON.parse(fs.readFileSync(new URL("./fixtures/question-intent-test.json", import.meta.url), "utf8"));
let right = 0;
let byRule = 0;
const advice = { asked: 0, caught: 0, falseAlarms: 0 };
for (const { text, intent } of held) {
  const resolved = resolveIntent(text.toLowerCase());
  if (resolved.intent === intent) right += 1;
  if (resolved.by === "rule") byRule += 1;
  if (intent === "advice") {
    advice.asked += 1;
    if (resolved.intent === "advice") advice.caught += 1;
  } else if (resolved.intent === "advice") advice.falseAlarms += 1;
}
const pct = (a, b) => Number(((100 * a) / b).toFixed(1));
const resolver = {
  held_out_questions: held.length,
  intent_accuracy: pct(right, held.length),
  decided_by_rule: pct(byRule, held.length),
  advice_requests_caught: pct(advice.caught, advice.asked),
  other_questions_wrongly_refused: pct(advice.falseAlarms, held.length - advice.asked),
};
console.log(`intent, full resolver: ${resolver.intent_accuracy}% of ${held.length} held-out questions (${resolver.decided_by_rule}% decided by a rule)`);
console.log(`advice requests caught: ${resolver.advice_requests_caught}%   other questions wrongly refused: ${resolver.other_questions_wrongly_refused}%`);

const lab = "Sunrise Diagnostics, Kanpur\nPatient: Meera Nair  Age 34 F\nReferred by: Dr. Asha Verma\nTest name   Result   Unit   Reference range\nHaemoglobin 9.8 g/dL 12.0 - 15.0\nFasting blood sugar 96 mg/dL 70 - 100\nTSH 6.2 uIU/mL 0.4 - 4.0\nSerum creatinine 0.8 mg/dL 0.6 - 1.2\nSample: serum. Verified by pathologist.";
const rx = "Dr. R. K. Gupta MBBS MD\nPatient Meera Nair 34 F\nC/o fever and cough for 3 days\nRx\n1. Tab. Paracetamol 500 mg 1-0-1 x 5 days after food\n2. Cap. Amoxicillin 500 mg thrice daily x 7 days\nAdvice: plenty of fluids. Review after 5 days.";
const discharge = "DISCHARGE SUMMARY\nPatient Name: Meera Nair  Age 34 F\nDate of admission: 01/10/2026   Date of discharge: 05/10/2026\nFinal diagnosis: Acute appendicitis\nProcedure done: Laparoscopic appendicectomy\nCondition at discharge: stable\nFollow up in OPD after 1 week.";
const scan = "RADIOLOGY REPORT\nStudy: X-RAY CHEST PA VIEW\nPatient Meera Nair 34 F\nBoth lung fields are clear.\nCardiac size is within normal limits.\nNo pleural effusion seen.\nIMPRESSION: Normal study.";
const cases = [
  [lab, "Lab report", "patient", "Is my haemoglobin normal?", /9\.8.*lower than the normal range/, "fact"],
  [lab, "Lab report", "doctor", "hb?", /Haemoglobin: 9\.8 g\/dL, low/, "fact"],
  [lab, "Lab report", "patient", "what does thyroid mean", /hormone that controls the thyroid/, "fact"],
  [lab, "Lab report", "patient", "which results are abnormal", /2 of 4 results/, "fact"],
  [lab, "Lab report", "patient", "what is my sugar", /96 mg\/dL.*within the normal range/, "fact"],
  [lab, "Lab report", "patient", "what is the normal range for creatinine", /0\.6 - 1\.2/, "fact"],
  [lab, "Lab report", "patient", "what is my vitamin d", /no result for Vitamin D/, "not-found"],
  [lab, "Lab report", "patient", "should I be worried about my TSH?", /6\.2.*question for your doctor/, "advice-declined"],
  [lab, "Lab report", "patient", "how can I increase my haemoglobin", /question for your doctor/, "advice-declined"],
  [lab, "Lab report", "doctor", "what treatment do you recommend", /does not give clinical recommendations/, "advice-declined"],
  [lab, "Lab report", "patient", "who referred me", /closest lines/, "document"],
  [lab, "Lab report", "patient", "what is the capital of France", /could not find/, "not-found"],
  [rx, "Prescription", "patient", "how do I take paracetamol", /morning and night, after food, for 5 days/, "fact"],
  [rx, "Prescription", "patient", "what is amoxicillin for", /antibiotic/, "fact"],
  [rx, "Prescription", "patient", "what medicines are prescribed", /2 medicines are listed/, "fact"],
  [rx, "Prescription", "patient", "can i stop taking amoxicillin early", /question for your doctor/, "advice-declined"],
  [rx, "Prescription", "patient", "when should I come back", /closest lines/, "document"],
  [rx, "Prescription", "patient", "should I take paracetamol after food", /after food/, "fact"],
  [discharge, "Discharge summary", "patient", "what was the diagnosis", /Acute appendicitis/, "fact"],
  [discharge, "Discharge summary", "patient", "was any surgery done", /Laparoscopic appendicectomy/, "fact"],
  [discharge, "Discharge summary", "patient", "when was I discharged", /05\/10\/2026/, "fact"],
  [discharge, "Discharge summary", "patient", "when is the follow up", /OPD after 1 week/, "fact"],
  [scan, "Scan or imaging", "patient", "is the scan normal", /Normal study/, "fact"],
  [scan, "Scan or imaging", "doctor", "what is the impression", /Normal study/, "fact"],
];
let passed = 0;
for (const [text, type, audience, question, expected, kind] of cases) {
  const result = answerQuestion({ question, text, summary: summariseDocument(text, type), audience });
  const ok = result.kind === kind && expected.test(result.answer + " " + result.basis.join(" "));
  if (ok) passed += 1;
  else console.log(`  WRONG  "${question}" -> [${result.intent}/${result.kind}] ${result.answer} ${result.basis.join(" | ")}`);
}
console.log(`worked examples: ${passed}/${cases.length} answered as expected`);

// ---- 4. Spelling mistakes ---------------------------------------------------
// Every name gets every possible single slip of the keyboard that still looks
// like the word: one letter dropped, two neighbours swapped, or one letter doubled.
function misspellings(word) {
  const out = new Set();
  for (let i = 1; i < word.length; i++) {
    out.add(word.slice(0, i) + word.slice(i + 1)); // dropped letter
    out.add(word.slice(0, i) + word[i] + word.slice(i)); // doubled letter
    if (i + 1 < word.length) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)); // swapped neighbours
  }
  out.delete(word);
  return [...out];
}
const everything = summariseDocument(
  "Lab and prescription\nHaemoglobin 9.8 g/dL 12.0 - 15.0\nSerum creatinine 0.8 mg/dL 0.6 - 1.2\nTotal cholesterol 212 mg/dL < 200\nTriglycerides 180 mg/dL < 150\nPlatelet count 2.6 lakh/cumm 1.5 - 4.5\nSerum potassium 4.1 mmol/L 3.5 - 5.1\nBilirubin 0.9 mg/dL 0.2 - 1.2\n1. Tab. Paracetamol 500 mg 1-0-1 x 5 days\n2. Cap. Amoxicillin 500 mg thrice daily x 7 days\n3. Tab. Atorvastatin 10 mg at night\n4. Tab. Metformin 500 mg twice daily\n5. Tab. Pantoprazole 40 mg before food",
  "Lab report",
);
everything.medicines = [{ name: "Paracetamol" }, { name: "Amoxicillin" }, { name: "Atorvastatin" }, { name: "Metformin" }, { name: "Pantoprazole" }];
const names = ["haemoglobin", "creatinine", "cholesterol", "triglycerides", "platelet", "potassium", "bilirubin", "thyroid", "glucose", "sugar", "paracetamol", "amoxicillin", "atorvastatin", "metformin", "pantoprazole"];
let typos = 0;
let fixed = 0;
let fixedWrong = 0;
for (const name of names) {
  for (const typo of misspellings(name)) {
    typos += 1;
    const { corrections } = correctSpelling(`what is my ${typo} level`, everything);
    if (corrections.length === 1 && (corrections[0].meant === name || corrections[0].meant.replace(/^hemo/, "haemo") === name)) fixed += 1;
    else if (corrections.length > 0) fixedWrong += 1;
  }
}
// Ordinary words must be left alone.
const ordinary = "surgery normal report doctor hospital should about results medicine tablets morning night before after level range which value sample blood count serum total daily twice thrice later liver podium metro format paragraph creation plate potato billing thyme glue amount patient written reading number today always never under worry healthy really please explain summary meaning reason follow visit review admitted discharge operation procedure condition diagnosis treatment".split(" ");
let touched = 0;
for (const word of ordinary) if (correctSpelling(`is my ${word} fine`, everything).corrections.length) touched += 1;
const spelling = {
  misspellings_tried: typos,
  corrected: pct(fixed, typos),
  corrected_to_the_wrong_word: pct(fixedWrong, typos),
  ordinary_words_tried: ordinary.length,
  ordinary_words_wrongly_changed: pct(touched, ordinary.length),
};
console.log(`spelling: ${spelling.corrected}% of ${typos} misspelt names corrected, ${spelling.corrected_to_the_wrong_word}% to the wrong word; ${touched}/${ordinary.length} ordinary words wrongly changed`);

// ---- 5. Conversations --------------------------------------------------------
const talks = [
  [lab, "Lab report", "patient", [
    ["is my haemoglobn normal", /9\.8.*lower than the normal range/, "fact"],
    ["what does it mean?", /carries oxygen.*anaemia/, "fact"],
    ["and the normal range?", /^Haemoglobin: 12\.0 - 15\.0 g\/dL\./, "fact"],
    ["is it serious?", /9\.8.*question for your doctor/, "advice-declined"],
    ["what about TSH?", /^TSH: 0\.4 - 4\.0/, "fact"],
    ["is it high", /6\.2.*higher than the normal range/, "fact"],
    ["who referred me", /closest lines/, "document"],
    ["which results are abnormal", /2 of 4 results are outside/, "fact"],
    ["what does that mean", /carries oxygen.*thyroid gland/, "fact"],
  ]],
  [rx, "Prescription", "patient", [
    ["how do i take paracetmol", /morning and night, after food, for 5 days/, "fact"],
    ["what is it for", /fever and pain/, "fact"],
    ["and amoxicilin?", /antibiotic/, "fact"],
    ["how long do i take it", /Amoxicillin 500 mg: three times a day, for 7 days/, "fact"],
    ["can i stop it early", /Amoxicillin.*question for your doctor/, "advice-declined"],
  ]],
  [lab, "Lab report", "doctor", [
    ["tsh?", /TSH: 6\.2 uIU\/mL, high/, "fact"],
    ["creatinine?", /Serum creatinine: 0\.8 mg\/dL, normal/, "fact"],
    ["reference range?", /^Serum creatinine: 0\.6 - 1\.2/, "fact"],
  ]],
];
let turns = 0;
let turnsRight = 0;
for (const [text, type, audience, steps] of talks) {
  const summary = summariseDocument(text, type);
  let context = null;
  for (const [question, expected, kind] of steps) {
    const result = answerQuestion({ question, text, summary, audience, context });
    context = result.context;
    turns += 1;
    if (result.kind === kind && expected.test(result.answer + " " + result.basis.join(" ")) && result.followUps.length <= 3) turnsRight += 1;
    else console.log(`  WRONG  (conversation) "${question}" -> [${result.intent}/${result.kind}] ${result.answer}`);
  }
}
console.log(`conversations: ${turnsRight}/${turns} follow-up turns answered as expected`);

fs.mkdirSync(new URL("../../ml/reports/", import.meta.url), { recursive: true });
fs.writeFileSync(
  new URL("../../ml/reports/ask_resolver.json", import.meta.url),
  JSON.stringify({ resolver, worked_examples: { passed, total: cases.length }, spelling, conversations: { passed: turnsRight, total: turns } }, null, 2),
);
fs.writeFileSync(
  new URL("../src/ml/models/ask-metrics.json", import.meta.url),
  JSON.stringify({
    intentAccuracy: resolver.intent_accuracy,
    adviceCaught: resolver.advice_requests_caught,
    wronglyRefused: resolver.other_questions_wrongly_refused,
    typosCorrected: spelling.corrected,
  }),
);
process.exit(passed === cases.length && turnsRight === turns ? 0 : 1);
