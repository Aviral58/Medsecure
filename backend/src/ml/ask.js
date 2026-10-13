import { LAB_TESTS, STOP, linesOf } from "./summarize.js";
import { loadTextModel } from "./textModel.js";

// "Ask about this report": answers a typed question about ONE open record.
//
// How an answer is produced:
//   0. fix spelling mistakes in the names of tests and medicines
//      ("haemoglobn", "paracetmol"), and say so in the reply
//   1. find which tests or medicines of this record the question mentions.
//      A follow-up such as "is it normal?" or "what about TSH?" is understood
//      from the question before it
//   2. decide what kind of question it is (its "intent"): a few sure-fire
//      keyword rules first, then a trained classifier for everything else
//   3. answer from the facts the summariser extracted from this record
//   4. if no fact fits, search the document for the lines closest to the
//      question and quote them
//   5. if nothing fits, say so
// Each reply also offers two or three questions that follow on from it.
//
// Every answer is built from this one document and shows the lines it rests
// on. Questions that ask for medical advice ("should I...", "is it
// serious?") are not answered: the reply states what the document says and
// points to the doctor.

const intentModel = loadTextModel("question-intent.json");

// Everyday words people use for a test, mapped to the test's proper name.
const TEST_WORDS = [
  ["Haemoglobin", /h(a)?emoglobin|\bhb\b|blood count/i],
  ["White blood cell count", /wbc|white (blood )?cells?|leu[ck]ocytes?|\btlc\b/i],
  ["Platelet count", /platelets?/i],
  ["Fasting blood sugar", /sugar|glucose|\bfbs\b/i],
  ["HbA1c", /hba1c|a1c/i],
  ["Serum creatinine", /creatinine|kidney/i],
  ["Blood urea", /\burea\b|\bbun\b/i],
  ["Total cholesterol", /cholesterol/i],
  ["Triglycerides", /triglycerides?/i],
  ["HDL cholesterol", /\bhdl\b|good cholesterol/i],
  ["LDL cholesterol", /\bldl\b|bad cholesterol/i],
  ["SGPT (ALT)", /sgpt|\balt\b|liver/i],
  ["SGOT (AST)", /sgot|\bast\b/i],
  ["Bilirubin", /bilirubin|jaundice/i],
  ["TSH", /\btsh\b|thyroid/i],
  ["Vitamin D", /vitamin d\b|vit\.? ?d\b/i],
  ["Vitamin B12", /b ?12/i],
  ["Serum sodium", /sodium/i],
  ["Serum potassium", /potassium/i],
  ["ESR", /\besr\b/i],
  ["Uric acid", /uric acid/i],
  ["C-reactive protein", /\bcrp\b|c-?reactive/i],
];

// Questions that ask what to DO or what will HAPPEN, rather than what the
// document says. "When should I take it?" is not one of these: that is a
// question about what is written.
const ADVICE =
  /\bshould i (be |get |take )?(worr|stop|skip|more|increase|reduce|see\b|go\b|do\b|eat|avoid|start|change|continue|exercise|rest)|\bwhat should i\b|\bdo i (need|have)\b|\bwhat (can|do) i do\b|is (it|this|that|my [a-z ]+?) (serious|dangerous|bad|fatal|life.?threatening|cancer|safe)|\bworr(y|ied)\b|\bwill i\b|\bam i going\b|\bcan i (stop|skip|take|double|eat|drink|exercise)\b|\bcure\b|treatment for\b|how (to|do i|can i) (reduce|increase|lower|raise|treat|cure|fix|improve)|what (food|diet)|do you (advise|recommend|think)|\brecommend\b|\badvise\b|natural(ly)?\b|\b(double|halve|skip|miss|change|adjust) (the |my |a )?dos(e|age)\b|\b(fix|improve|boost|normalise|normalize|bring (up|down)) (my |the )?(testname|result|level|report)/i;

// Words that show a question is about the open record at all.
const ON_TOPIC = /report|document|result|test|scan|x-?ray|medicine|tablet|summary|explain|record|prescription|doctor|hospital|patient|vaccine|\bthis\b|\bmy\b|\bme\b|\bi\b/i;

const RULES = [
  ["advice", ADVICE],
  ["normal_range", /\bnormal (range|value|level|limits?)|reference range|what should .* be\b|healthy range|expected value|supposed to be|ideal .* level|how much .* is normal/i],
  ["abnormal", /abnormal|out of range|outside (the |normal )?(range|limits)|anything wrong|(all|everything) .*(normal|clear)|red flags?|flagged|not normal|high or low|which .*(are|is) (high|low)|needs attention|bad values|what is off|any problems/i],
  ["medicine_purpose", /what (is|are) .* for\b|used for|why (was|did|do|am) .*|what does medname (do|treat|help)|purpose of medname|meant to do|what condition is|use of medname|medname is for/i, "medicine"],
  ["how_to_take", /how (do|should|to|is|often|long|many)|when (should|do|to)|before or after|after food|before food|\bdos(e|age)\b|timing|schedule|instructions|till when|at what time|morning or night/i, "medicine"],
  ["test_meaning", /what (does|is) .*(mean|measure|show)|meaning of|explain testname|tell me about|understand|what is testname( test)?\b(?! (level|value|result|count))|why (is|does) testname|purpose of the testname|in simple words|testname means/i, "test"],
  ["diagnosis", /diagnos|what was wrong|admitted for|reason for admission|suffering from|illness|what disease|cause of admission|what condition|the problem|complaint/i],
  ["treatment", /procedure|surgery|operation|operated|treatment (was |did )|how was .*(treated|managed)|what was done|course in hospital|management|what did (they|the doctors) do|what treatment/i],
  ["dates_followup", /\bwhen\b|what date|which date|date of|how long was|how many days was|follow.?up|next (visit|appointment|dose|vaccine)|come back|return for|due\b/i],
  ["conclusion", /impression|conclusion|scan|x-?ray|ultrasound|\bmri\b|\bct\b|radiolog|imaging|findings|verdict/i],
  ["overview", /summar|explain (this|the|in)|what is this|key points|main points|gist|walk me through|what does this report say|what is written|break .* down|what kind of|what does this report mean|vaccines? (were|are)/i],
  ["medicines", /medicines?|medications?|tablets?|drugs?|pills?|prescribed|prescription|prescribe/i],
];

const DECLINE = {
  patient: "I can only tell you what this document says. What it means for your health, and what to do about it, is a question for your doctor.",
  doctor: "This tool only reports what the document contains. It does not give clinical recommendations.",
};

// ---------------------------------------------------------------------------
// Step 0: spelling mistakes in the names of tests and medicines
// ---------------------------------------------------------------------------

// Plain words people type for the tests above. Misspellings are matched to these.
const TEST_SPELLINGS = [
  "haemoglobin", "hemoglobin", "platelet", "platelets", "glucose", "sugar", "creatinine", "kidney", "cholesterol", "triglycerides",
  "bilirubin", "jaundice", "thyroid", "sodium", "potassium", "vitamin", "leukocytes", "liver", "uric",
];

/** Edit distance where swapping two neighbouring letters counts as one mistake ("thyriod"). */
function typoDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/** May `typed` be a misspelling of `word`? Short words must match more closely than long ones. */
function isMisspellingOf(typed, word) {
  if (typed === word || Math.abs(typed.length - word.length) > 2) return false;
  const distance = typoDistance(typed, word);
  if (typed[0] !== word[0]) return false; // people rarely get the first letter wrong, and it rules out "podium" for "sodium"
  if (typed.length <= 5) return distance === 1 && typed.at(-1) === word.at(-1);
  if (typed.length <= 8) return distance === 1;
  return distance <= 2;
}

/**
 * Replace misspelt test and medicine names in a question with the right spelling.
 * Ordinary English words are never touched. Returns { question, corrections }.
 */
export function correctSpelling(question, summary) {
  const vocabulary = new Set(TEST_SPELLINGS);
  for (const finding of summary.findings) for (const word of finding.name.toLowerCase().match(/[a-z]{5,}/g) || []) vocabulary.add(word);
  for (const medicine of summary.medicines) for (const word of medicine.name.toLowerCase().match(/[a-z]{5,}/g) || []) vocabulary.add(word);

  const corrections = [];
  const fixed = question.replace(/[A-Za-z]{5,}/g, (typed) => {
    const lower = typed.toLowerCase();
    if (vocabulary.has(lower) || intentModel.knownWords.has(lower)) return typed;
    const matches = [...vocabulary]
      .filter((word) => isMisspellingOf(lower, word))
      .map((word) => ({ word, distance: typoDistance(lower, word) }))
      .sort((a, b) => a.distance - b.distance);
    // No match, or two equally close ones: leave the word alone.
    if (matches.length === 0 || (matches.length > 1 && matches[0].distance === matches[1].distance)) return typed;
    corrections.push({ typed, meant: matches[0].word });
    return matches[0].word;
  });
  return { question: fixed, corrections };
}

// ---------------------------------------------------------------------------
// Step 1: which tests and medicines does the question mention?
// ---------------------------------------------------------------------------

function canonicalTest(name) {
  return LAB_TESTS.find((test) => test.match.test(name));
}

function findEntities(question, summary) {
  const tests = [];
  const missingTests = [];
  let shape = question.toLowerCase();

  for (const [testName, words] of TEST_WORDS) {
    if (!words.test(question)) continue;
    const hits = summary.findings.filter((finding) => canonicalTest(finding.name)?.name === testName);
    if (hits.length) tests.push(...hits);
    else missingTests.push(testName);
    shape = shape.replace(new RegExp(words.source, "gi"), "testname");
  }
  // Tests on this report that are not in the list above: match by their own name.
  for (const finding of summary.findings) {
    const name = finding.name.toLowerCase();
    if (!tests.includes(finding) && name.length >= 3 && shape.includes(name)) {
      tests.push(finding);
      shape = shape.split(name).join("testname");
    }
  }

  const medicines = [];
  for (const medicine of summary.medicines) {
    const word = medicine.name.toLowerCase().split(/\s+/)[0];
    if (word.length >= 4 && shape.includes(word)) {
      medicines.push(medicine);
      shape = shape.split(medicine.name.toLowerCase()).join("medname").split(word).join("medname");
    }
  }
  return { tests: [...new Set(tests)], missingTests, medicines, shape };
}

// Kinds of question that are about one particular test or medicine.
const ABOUT_A_TEST = new Set(["test_value", "test_meaning", "normal_range"]);
const ABOUT_A_MEDICINE = new Set(["how_to_take", "medicine_purpose"]);
const REFERS_BACK = /\b(it|its|it's|that|this one|that one|them|they|those|these|same)\b/i;
const CONTINUES = /^\s*(and|also|what about|how about|same for|then)\b/i;

/**
 * Understand a follow-up from the turn before it.
 *   "Is it normal?"   -> no test named, so it is about the test just discussed
 *   "What about TSH?" -> a test is named but nothing is asked, so the same
 *                        thing is asked about it as was asked last time
 * `firstIntent` is what the question looks like on its own.
 */
function applyContext(question, entities, firstIntent, context, summary) {
  if (!context) return { entities, inheritedIntent: null, carried: false };
  const named = entities.tests.length + entities.missingTests.length + entities.medicines.length > 0;

  if (!named) {
    const tests = summary.findings.filter((finding) => context.tests.includes(finding.name));
    const medicines = summary.medicines.filter((medicine) => context.medicines.includes(medicine.name));
    const pointsBack = REFERS_BACK.test(question) || CONTINUES.test(question);
    const useTests = tests.length > 0 && (pointsBack || ABOUT_A_TEST.has(firstIntent));
    const useMedicines = !useTests && medicines.length > 0 && (pointsBack || ABOUT_A_MEDICINE.has(firstIntent));
    if (useTests || useMedicines) {
      const placeholder = useTests ? "testname" : "medname";
      const shape = REFERS_BACK.test(entities.shape) ? entities.shape.replace(REFERS_BACK, placeholder) : `${entities.shape} ${placeholder}`;
      return {
        entities: { ...entities, tests: useTests ? tests : [], medicines: useMedicines ? medicines : [], shape },
        inheritedIntent: null,
        carried: true,
      };
    }
    return { entities, inheritedIntent: null, carried: false };
  }

  // "what about TSH?", "and platelets?", or just "tsh?"
  const otherWords = entities.shape.replace(/testname|medname|[^a-z ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if ((CONTINUES.test(question) || otherWords.length === 0) && context.intent) {
    const aboutTest = entities.tests.length + entities.missingTests.length > 0;
    if ((aboutTest ? ABOUT_A_TEST : ABOUT_A_MEDICINE).has(context.intent)) return { entities, inheritedIntent: context.intent, carried: false };
  }
  return { entities, inheritedIntent: null, carried: false };
}

// ---------------------------------------------------------------------------
// Step 2: what kind of question is it?
// ---------------------------------------------------------------------------

/** Returns { intent, by } where `by` says which step decided: "rule", "model" or "fallback". */
export function resolveIntent(shape, entities = { tests: [], medicines: [], missingTests: [] }) {
  const hasTest = entities.tests.length > 0 || entities.missingTests.length > 0 || shape.includes("testname");
  const hasMedicine = entities.medicines.length > 0 || shape.includes("medname") || /medicines?|tablets?|pills?|drugs?|medication/.test(shape);

  for (const [intent, pattern, needs] of RULES) {
    if (needs === "medicine" && !hasMedicine) continue;
    if (needs === "test" && !hasTest) continue;
    if (pattern.test(shape)) return { intent, by: "rule" };
  }
  const guess = intentModel.classify(shape);
  if (guess.known && guess.confidence >= 0.35 && (hasTest || hasMedicine || ON_TOPIC.test(shape))) {
    return { intent: guess.label, by: "model", confidence: guess.confidence };
  }
  if (hasTest) return { intent: "test_value", by: "fallback" };
  if (entities.medicines.length > 0) return { intent: "how_to_take", by: "fallback" };
  return { intent: "other", by: "fallback" };
}

// ---------------------------------------------------------------------------
// Step 4: search the document
// ---------------------------------------------------------------------------

const QUESTION_WORDS = new Set("what which who whom when where why how does did was were are is the this that report document tell say says mean please can could you me my".split(" "));

function wordsOf(text) {
  return (text.toLowerCase().match(/[a-z]{2,}|\d+(?:\.\d+)?/g) || []).filter((w) => !STOP.has(w) && !QUESTION_WORDS.has(w));
}

/** The lines of the document closest to the question, best first (BM25 scoring). */
export function searchDocument(question, text, count = 2) {
  const lines = linesOf(text).map((line) => line.trim()).filter((line) => line.length >= 4);
  const query = [...new Set(wordsOf(question))];
  if (query.length === 0 || lines.length === 0) return [];

  const bags = lines.map(wordsOf);
  const average = bags.reduce((sum, bag) => sum + bag.length, 0) / bags.length || 1;
  // Words match exactly, or by their first six letters ("referred" ~ "referral").
  const same = (a, b) => a === b || (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6));
  const containing = (word) => bags.filter((bag) => bag.some((w) => same(w, word))).length;

  const scored = lines.map((line, i) => {
    let score = 0;
    for (const word of query) {
      const frequency = bags[i].filter((w) => same(w, word)).length;
      if (!frequency) continue;
      const idf = Math.log(1 + (lines.length - containing(word) + 0.5) / (containing(word) + 0.5));
      score += (idf * frequency * 2.2) / (frequency + 1.2 * (0.25 + 0.75 * (bags[i].length / average)));
    }
    return { line, score };
  });
  const ranked = scored.filter((s) => s.score > 1.0).sort((a, b) => b.score - a.score);
  // Keep a second line only if it is nearly as good a match as the first.
  return ranked.filter((s) => s.score >= ranked[0].score * 0.6).slice(0, count).map((s) => s.line);
}

function sourceLine(text, needle) {
  const lower = needle.toLowerCase();
  return linesOf(text).map((l) => l.trim()).find((line) => line.toLowerCase().includes(lower)) || "";
}

// ---------------------------------------------------------------------------
// Step 3: answer from the extracted facts
// ---------------------------------------------------------------------------

function describeValue(finding, audience) {
  const value = `${finding.value}${finding.unit ? ` ${finding.unit}` : ""}`;
  if (finding.status === "unclear") {
    const read = `${finding.valueAsRead ?? finding.value}${finding.unit ? ` ${finding.unit}` : ""}`;
    return `${finding.name} was read from the picture as ${read}, but that reading is not reliable. Check it against the image.`;
  }
  const range =
    finding.reference +
    (finding.referenceAssumed ? " (a typical adult range; this report prints none)" : "") +
    (finding.referenceCorrected ? " (the range was unclear in the picture and has been corrected, so check it)" : "");
  if (audience === "doctor") return `${finding.name}: ${value}, ${finding.status} (reference ${range}).`;
  if (finding.status === "normal") return `${finding.name} is ${value}. That is within the normal range of ${range}.`;
  return `${finding.name} is ${value}. That is ${finding.status === "high" ? "higher" : "lower"} than the normal range of ${range}.`;
}

function describeMeaning(finding) {
  const known = canonicalTest(finding.name);
  if (!known) return `I do not have an explanation for ${finding.name}.`;
  const note = finding.status === "high" ? known.highNote : finding.status === "low" ? known.lowNote : "";
  return `${known.name} is ${known.about}.${note ? ` A ${finding.status} value ${note}.` : ""}`;
}

/** "On this report it is 9.8 g/dL (low)." */
function onThisReport(finding) {
  if (finding.status === "unclear") return "Its value could not be read reliably from the picture.";
  return `On this report it is ${finding.value}${finding.unit ? ` ${finding.unit}` : ""} (${finding.status}).`;
}

/** What the document says about results outside their range, in one or two sentences. */
function describeAbnormal(findings, audience) {
  const abnormal = findings.filter((f) => f.status === "high" || f.status === "low");
  const unclear = findings.filter((f) => f.status === "unclear");
  const judged = findings.length - unclear.length;
  const unclearNote = unclear.length
    ? ` ${unclear.length} ${unclear.length === 1 ? "result" : "results"} could not be read reliably from the picture (${unclear.map((f) => f.name).join(", ")}).`
    : "";
  if (abnormal.length === 0) {
    return { text: `${judged === findings.length ? `All ${judged}` : `The ${judged} readable`} results on this report are within their normal ranges.${unclearNote}`, items: unclear };
  }
  return {
    text: `${abnormal.length} of ${findings.length} results ${abnormal.length === 1 ? "is" : "are"} outside the normal range. ${abnormal.map((f) => describeValue(f, audience)).join(" ")}${unclearNote}`,
    items: abnormal,
  };
}

function describeTaking(medicine) {
  const parts = [medicine.frequency, medicine.timing, medicine.duration && (medicine.duration === "ongoing" ? "to be continued" : `for ${medicine.duration}`)].filter(Boolean);
  const label = `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ""}`;
  return parts.length ? `${label}: ${parts.join(", ")}.` : `${label}: the document does not say how or when to take it.`;
}

function reply(kind, answer, basis = []) {
  return { kind, answer: answer.trim(), basis: [...new Set(basis.filter(Boolean))].slice(0, 4) };
}

function fromDocument(question, text) {
  const lines = searchDocument(question, text);
  if (lines.length === 0) return reply("not-found", "I could not find that in this document.");
  return reply("document", `The closest lines in the document are shown below.`, lines);
}

function answerFor(intent, { question, text, summary, audience, entities, decidedBy }) {
  const { tests, missingTests, medicines } = entities;
  const facts = summary.facts || {};
  const findings = summary.findings;
  const part = audience === "doctor" ? summary.forDoctor : summary.forPatient;
  const linesFor = (items, key = "name") => items.map((item) => sourceLine(text, item[key]));
  const absent = missingTests.length ? ` This report has no result for ${missingTests.join(" or ")}.` : "";

  switch (intent) {
    case "test_value": {
      if (tests.length) return reply("fact", tests.map((t) => describeValue(t, audience)).join(" ") + absent, linesFor(tests));
      if (missingTests.length) return reply("not-found", absent.trim());
      if (findings.length) return reply("fact", findings.slice(0, 8).map((f) => describeValue(f, "doctor")).join(" "), linesFor(findings.slice(0, 4)));
      return fromDocument(question, text);
    }
    case "abnormal": {
      if (findings.length) {
        const { text: described, items } = describeAbnormal(findings, audience);
        return reply("fact", described, linesFor(items));
      }
      if (facts.impression) return reply("fact", `The report's conclusion is: ${facts.impression}`, [sourceLine(text, facts.impression.slice(0, 25))]);
      return reply("not-found", "This document has no test results to compare with a normal range.");
    }
    case "test_meaning": {
      if (tests.length) return reply("fact", tests.map((t) => `${describeMeaning(t)} ${onThisReport(t)}`).join(" "), linesFor(tests));
      if (missingTests.length) {
        const known = LAB_TESTS.find((t) => t.name === missingTests[0]);
        return reply("fact", `${known.name} is ${known.about}.${absent}`);
      }
      return fromDocument(question, text);
    }
    case "normal_range": {
      const chosen = tests.length ? tests : findings.slice(0, 8);
      if (chosen.length === 0) return missingTests.length ? reply("not-found", absent.trim()) : fromDocument(question, text);
      return reply(
        "fact",
        chosen
          .map(
            (f) =>
              `${f.name}: ${f.reference}${f.unit ? ` ${f.unit}` : ""}` +
              (f.referenceAssumed ? " (typical adult range, not printed on this report)" : "") +
              (f.referenceCorrected ? " (unclear in the picture and corrected, so check it)" : "") +
              ".",
          )
          .join(" ") + absent,
        linesFor(chosen.slice(0, 4)),
      );
    }
    case "medicines": {
      if (summary.medicines.length === 0) return reply("not-found", "This document does not list any medicines.");
      return reply("fact", `${summary.medicines.length} ${summary.medicines.length === 1 ? "medicine is" : "medicines are"} listed. ` + summary.medicines.map(describeTaking).join(" "), linesFor(summary.medicines));
    }
    case "how_to_take": {
      const chosen = medicines.length ? medicines : summary.medicines;
      if (chosen.length === 0) return reply("not-found", "This document does not list any medicines.");
      return reply("fact", chosen.map(describeTaking).join(" "), linesFor(chosen));
    }
    case "medicine_purpose": {
      const chosen = medicines.length ? medicines : summary.medicines;
      if (chosen.length === 0) return reply("not-found", "This document does not list any medicines.");
      const stated = facts.diagnosis || facts.complaint;
      return reply(
        "fact",
        chosen.map((m) => (m.purpose ? `${m.name} is commonly used ${m.purpose.replace(/^(an?|to) /, (x) => (x.trim() === "to" ? "to " : "as " + x))}.` : `I do not have a note on what ${m.name} is for.`)).join(" ") +
          (stated ? ` The document gives the reason for treatment as: ${stated}.` : " The document itself does not say why each medicine was given."),
        linesFor(chosen),
      );
    }
    case "diagnosis": {
      const value = facts.diagnosis || facts.complaint;
      if (value) return reply("fact", `The document records ${facts.diagnosis ? "the diagnosis" : "the complaint"} as: ${value}.`, [sourceLine(text, value.slice(0, 25))]);
      return fromDocument(question + " diagnosis", text);
    }
    case "treatment": {
      if (facts.procedure) return reply("fact", `The document records the treatment as: ${facts.procedure}.`, [sourceLine(text, facts.procedure.slice(0, 25))]);
      return fromDocument(question + " treatment procedure", text);
    }
    case "dates_followup": {
      const q = question.toLowerCase();
      const pieces = [];
      const basis = [];
      const wantsNext = /follow|next|come back|return|review|again|due/.test(q);
      if (wantsNext && (facts.followUp || facts.next)) {
        pieces.push(`The document says: ${facts.followUp || facts.next}.`);
        basis.push(sourceLine(text, (facts.followUp || facts.next).slice(0, 25)));
      }
      if (!wantsNext && facts.admitted && /admit|how long|how many days|stay/.test(q)) pieces.push(`Admitted on ${facts.admitted}.`);
      if (!wantsNext && facts.discharged && /discharg|go home|went home|how long|how many days|stay/.test(q)) pieces.push(`Discharged on ${facts.discharged}.`);
      if (pieces.length) return reply("fact", pieces.join(" "), basis);
      return fromDocument(question + (wantsNext ? " review follow up next visit due booster" : " date dated"), text);
    }
    case "conclusion": {
      if (facts.impression) return reply("fact", `The report's conclusion is: ${facts.impression}`, [sourceLine(text, facts.impression.slice(0, 25))]);
      if (decidedBy !== "rule") return fromDocument(question, text);
      return reply("fact", `${part.headline} ${part.points.slice(0, 3).join(" ")}`);
    }
    case "overview":
      return reply("fact", `${part.headline} ${part.points.slice(0, 4).join(" ")}`);
    case "advice": {
      // Decline the advice, but still say what the document itself shows.
      let known = [...tests.map((t) => describeValue(t, audience)), ...medicines.map(describeTaking)].join(" ");
      let basis = [...linesFor(tests), ...linesFor(medicines)];
      if (!known && /medicine|tablet|pill|drug|dose|medication/.test(question.toLowerCase()) && summary.medicines.length) {
        known = `This document lists ${summary.medicines.length} ${summary.medicines.length === 1 ? "medicine" : "medicines"}. ${summary.medicines.map(describeTaking).join(" ")}`;
        basis = linesFor(summary.medicines);
      } else if (!known && findings.length) {
        const described = describeAbnormal(findings, audience);
        known = described.text;
        basis = linesFor(described.items);
      } else if (!known && facts.diagnosis) {
        known = `The document records the diagnosis as: ${facts.diagnosis}.`;
      }
      return reply("advice-declined", `${known ? `${known} ` : ""}${DECLINE[audience]}`, basis);
    }
    default:
      return fromDocument(question, text);
  }
}

/**
 * Two or three questions that follow on naturally from an answer.
 * Only questions this record can actually answer are offered.
 */
function followUps(intent, kind, entities, summary, audience, asked) {
  const { findings, medicines, facts = {} } = summary;
  const my = audience === "doctor" ? "the" : "my";
  const test = entities.tests[0]?.name;
  const medicine = entities.medicines[0]?.name;
  const otherAbnormal = findings.find((f) => (f.status === "high" || f.status === "low") && f.name !== test);
  const nextMedicine = medicines.find((m) => m.name !== medicine);
  const ideas = [];

  if (kind === "not-found" || kind === "document") ideas.push(...suggestQuestions(summary, audience));
  else if (intent === "test_value" && test) ideas.push(`What does ${test} mean?`, `What is the normal range for ${test}?`, otherAbnormal && `Is ${my} ${otherAbnormal.name} normal?`);
  else if (intent === "test_meaning" && test) ideas.push(`What is the normal range for ${test}?`, otherAbnormal && `What does ${otherAbnormal.name} mean?`, "Which results are abnormal?");
  else if (intent === "normal_range" && test) ideas.push(`Is ${my} ${test} normal?`, `What does ${test} mean?`);
  else if (intent === "abnormal" || intent === "advice") {
    const abnormal = findings.filter((f) => f.status === "high" || f.status === "low");
    ideas.push(...abnormal.slice(0, 2).map((f) => `What does ${f.name} mean?`));
    if (medicines.length) ideas.push("What medicines are prescribed?");
    ideas.push("Summarise this report");
  } else if (intent === "medicines" && medicines.length) ideas.push(`How do I take ${medicines[0].name}?`, `What is ${medicines[0].name} for?`);
  else if (intent === "how_to_take" && medicines.length) ideas.push(`What is ${medicine || medicines[0].name} for?`, nextMedicine && `How do I take ${nextMedicine.name}?`);
  else if (intent === "medicine_purpose" && medicines.length) ideas.push(`How do I take ${medicine || medicines[0].name}?`, nextMedicine && `What is ${nextMedicine.name} for?`);
  else if (intent === "diagnosis") ideas.push(facts.procedure && "What treatment was given?", medicines.length && "What medicines are prescribed?", facts.followUp && "When is the follow up?");
  else if (intent === "treatment") ideas.push(medicines.length && "What medicines are prescribed?", facts.followUp && "When is the follow up?");
  else if (intent === "dates_followup") ideas.push(facts.diagnosis && "What was the diagnosis?", medicines.length && "What medicines are prescribed?");
  else ideas.push(...suggestQuestions(summary, audience));

  const same = (a, b) => a.toLowerCase().replace(/[^a-z]/g, "") === b.toLowerCase().replace(/[^a-z]/g, "");
  return [...new Set(ideas.filter(Boolean))].filter((idea) => !same(idea, asked)).slice(0, 3);
}

/**
 * Answer one question about one record.
 * `summary` is the record's AI summary and `text` its plain text.
 * `audience` is "doctor" or "patient".
 * `context` is what the previous question in this session was about (or null),
 * so follow-ups such as "is it normal?" can be understood. The reply carries
 * the context to pass in with the next question.
 */
export function answerQuestion({ question, text, summary, audience = "patient", context = null }) {
  const typed = String(question || "").trim().slice(0, 300);
  if (typed.length < 2) return { ...reply("not-found", "Type a question about this report."), followUps: [], corrections: [], context };
  const reader = audience === "doctor" ? "doctor" : "patient";

  const { question: asked, corrections } = correctSpelling(typed, summary);
  const found = findEntities(asked, summary);
  const first = resolveIntent(found.shape, found); // what the question looks like on its own
  const { entities, inheritedIntent, carried } = applyContext(asked, found, first.intent, context, summary);
  let resolved = first;
  // A request for advice stays one, however the follow-up is read.
  if (first.intent !== "advice") {
    if (inheritedIntent) resolved = { intent: inheritedIntent, by: "follow-up" };
    else if (carried) resolved = resolveIntent(entities.shape, entities);
  }
  const { intent, by } = resolved;

  const result = answerFor(intent, { question: asked, text, summary, audience: reader, entities, decidedBy: by });
  const names = { tests: entities.tests.map((t) => t.name), medicines: entities.medicines.map((m) => m.name) };
  const hasNames = names.tests.length + names.medicines.length > 0;
  return {
    ...result,
    intent,
    decidedBy: by,
    corrections,
    carriedOver: Boolean(carried), // the subject was taken from the previous question
    followUps: followUps(intent, result.kind, entities, summary, reader, typed),
    // Remember what this turn was about. A turn that names nothing keeps the earlier subject.
    context: {
      // After "which results are abnormal?", "what does that mean?" is about those results.
      tests:
        intent === "abnormal" && result.kind === "fact"
          ? summary.findings.filter((f) => f.status === "high" || f.status === "low").map((f) => f.name)
          : hasNames
            ? names.tests
            : context?.tests || [],
      medicines: hasNames ? names.medicines : context?.medicines || [],
      intent: ABOUT_A_TEST.has(intent) || ABOUT_A_MEDICINE.has(intent) ? intent : context?.intent || null,
    },
  };
}

/** Starter questions that make sense for this record. */
export function suggestQuestions(summary, audience) {
  const mine = audience === "doctor" ? "the" : "my";
  if (summary.findings.length) {
    const abnormal = summary.findings.find((f) => f.status === "high" || f.status === "low") || summary.findings[0];
    return ["Which results are abnormal?", `What does ${abnormal.name} mean?`, `What is the normal range for ${abnormal.name}?`];
  }
  if (summary.medicines.length && !summary.facts?.admitted) {
    return ["What medicines are prescribed?", `How do I take ${summary.medicines[0].name}?`, `What is ${summary.medicines[0].name} for?`];
  }
  if (summary.facts?.diagnosis) return ["What was the diagnosis?", "What treatment was given?", "When is the follow up?"];
  if (summary.facts?.impression) return ["What is the conclusion?", "Is the scan normal?", "Summarise this report"];
  return ["Summarise this report", `What is ${mine} document about?`];
}

export const askModelInfo = {
  name: "Ask about this report",
  method: "Spelling correction, question-intent classifier (TF-IDF of words and word pieces + logistic regression) with keyword rules, follow-up tracking, answers from extracted facts, BM25 search of the document as fallback",
  trainedOn: intentModel.info.trainedOn,
  metrics: intentModel.info.metrics,
  data: "Hand-written question phrasings. No real patient questions were used.",
};
