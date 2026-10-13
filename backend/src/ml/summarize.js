import { classifyRecordText } from "./recordType.js";

// Report summariser.
//
// Turns the text of a medical document into two short summaries: one in
// clinical wording for doctors, one in plain language for patients.
//
// It is a pipeline of classic NLP steps, all running in this process:
//
//   1. the record-type classifier decides what kind of document it is
//   2. a type-specific extractor pulls out the facts
//        lab report  -> each test, its value, its reference range, high/low/normal
//        prescription -> each medicine, strength, how often, how long
//        discharge   -> diagnosis, procedure, dates, condition, follow-up
//        scan        -> the study, the impression, findings that are not normal
//        vaccination -> vaccines given and the next one due
//   3. TextRank picks the most central sentences when no extractor fits
//   4. the facts are written out twice, for the two audiences
//
// Everything the summary says is taken from the document. It never adds a
// diagnosis or advice of its own. An optional local language model can
// rephrase the result (see llm.js); this file works without one.

export const SUMMARY_CAUTION = "AI-generated from this document. It can be wrong, so check the original.";
export const OCR_CAUTION =
  "AI-generated from a picture of this document. Reading a picture is less exact than reading typed text, so check every number against the image.";

// ---------------------------------------------------------------------------
// Knowledge: common lab tests and medicines
// ---------------------------------------------------------------------------
// Reference ranges are typical adult values, used ONLY when the report itself
// prints no range. The plain-language notes say what a test measures and what
// a high or low value is commonly associated with, never what it means for
// this patient.

export const LAB_TESTS = [
  { name: "Haemoglobin", match: /h(a)?emoglobin|\bhb\b/i, low: 12, high: 17, about: "the protein in red blood cells that carries oxygen", lowNote: "can be a sign of anaemia", highNote: "can happen with dehydration or some lung and blood conditions" },
  { name: "White blood cell count", match: /wbc|white blood|leu[ck]ocyte|\btlc\b/i, low: 4000, high: 11000, about: "the cells that fight infection", lowNote: "can lower resistance to infection", highNote: "is often seen with infection or inflammation" },
  { name: "Platelet count", match: /platelet/i, low: 1.5, high: 4.5, about: "the cells that help blood to clot", lowNote: "can make bleeding more likely", highNote: "can be seen with inflammation or some blood conditions" },
  { name: "Fasting blood sugar", match: /fasting (blood )?(sugar|glucose)|\bfbs\b/i, low: 70, high: 100, about: "the sugar level in the blood after not eating", lowNote: "is low blood sugar", highNote: "can point towards diabetes or pre-diabetes" },
  { name: "HbA1c", match: /hba[1il|]c|glycated|glycosylated/i, low: 4, high: 5.6, about: "the average blood sugar over about three months", lowNote: "is uncommon and worth asking about", highNote: "suggests blood sugar has been running high" },
  { name: "Serum creatinine", match: /creatinine/i, low: 0.6, high: 1.2, about: "a waste product the kidneys clear from the blood", lowNote: "is usually not a concern", highNote: "can mean the kidneys are under strain" },
  { name: "Blood urea", match: /\burea\b|\bbun\b/i, low: 15, high: 40, about: "a waste product the kidneys remove", lowNote: "is usually not a concern", highNote: "can be seen with dehydration or reduced kidney function" },
  { name: "Total cholesterol", match: /total cholesterol|^cholesterol/i, low: null, high: 200, about: "the total fat-like substance in the blood", highNote: "raises the long-term risk of heart disease" },
  { name: "Triglycerides", match: /triglyceride/i, low: null, high: 150, about: "a type of fat in the blood", highNote: "is linked with heart disease risk" },
  { name: "HDL cholesterol", match: /\bhdl\b/i, low: 40, high: null, about: "the 'good' cholesterol", lowNote: "gives less protection against heart disease" },
  { name: "LDL cholesterol", match: /\bldl\b/i, low: null, high: 100, about: "the 'bad' cholesterol", highNote: "raises the long-term risk of heart disease" },
  { name: "SGPT (ALT)", match: /sgpt|\balt\b/i, low: 7, high: 56, about: "a liver enzyme", lowNote: "is usually not a concern", highNote: "can mean the liver is irritated or inflamed" },
  { name: "SGOT (AST)", match: /sgot|\bast\b/i, low: 5, high: 40, about: "an enzyme found in the liver and muscles", lowNote: "is usually not a concern", highNote: "can mean liver or muscle irritation" },
  { name: "Bilirubin", match: /bilirubin/i, low: 0.2, high: 1.2, about: "a yellow substance made when red blood cells break down", lowNote: "is usually not a concern", highNote: "can cause jaundice and may point to a liver or bile problem" },
  { name: "TSH", match: /\btsh\b|thyroid stimulating/i, low: 0.4, high: 4.0, about: "the hormone that controls the thyroid gland", lowNote: "can mean an overactive thyroid", highNote: "can mean an underactive thyroid" },
  { name: "Vitamin D", match: /vitamin d|25-?oh/i, low: 30, high: 100, about: "a vitamin needed for strong bones", lowNote: "is a deficiency, which is common and treatable", highNote: "can happen with too many supplements" },
  { name: "Vitamin B12", match: /b12|cobalamin/i, low: 200, high: 900, about: "a vitamin needed for nerves and blood cells", lowNote: "is a deficiency that can cause tiredness and numbness", highNote: "is usually from supplements" },
  { name: "Serum sodium", match: /sodium/i, low: 135, high: 145, about: "a salt that controls the body's fluid balance", lowNote: "can cause weakness or confusion", highNote: "is often linked with dehydration" },
  { name: "Serum potassium", match: /potassium/i, low: 3.5, high: 5.1, about: "a salt that keeps the heart and muscles working", lowNote: "can cause weakness or an irregular heartbeat", highNote: "can affect the heart rhythm" },
  { name: "ESR", match: /\besr\b|sedimentation/i, low: 0, high: 20, about: "a general marker of inflammation", highNote: "suggests inflammation or infection somewhere in the body" },
  { name: "Uric acid", match: /uric acid/i, low: 3.5, high: 7.2, about: "a waste product from breaking down food", lowNote: "is usually not a concern", highNote: "can lead to gout or kidney stones" },
  { name: "C-reactive protein", match: /c-?reactive|\bcrp\b/i, low: null, high: 5, about: "a marker of inflammation", highNote: "suggests inflammation or infection" },
];

const MEDICINES = [
  [/paracetamol|acetaminophen/i, "for fever and pain"],
  [/amoxicillin|azithromycin|cefixime|ciprofloxacin|doxycycline/i, "an antibiotic for bacterial infection"],
  [/metformin|glimepiride|sitagliptin|insulin/i, "to control blood sugar"],
  [/amlodipine|telmisartan|losartan|enalapril|atenolol/i, "to control blood pressure"],
  [/atorvastatin|rosuvastatin/i, "to lower cholesterol"],
  [/pantoprazole|omeprazole|ranitidine/i, "to reduce stomach acid"],
  [/cetirizine|levocetirizine|loratadine/i, "for allergy"],
  [/levothyroxine|thyroxine/i, "thyroid hormone replacement"],
  [/ibuprofen|diclofenac|aceclofenac/i, "for pain and swelling"],
  [/montelukast/i, "for asthma and allergy"],
  [/vitamin d|calcium|vitamin b|iron|folic/i, "a supplement"],
  [/ondansetron|domperidone/i, "for nausea and vomiting"],
  [/salbutamol|levosalbutamol/i, "to open the airways"],
  [/\bors\b/i, "to replace fluids and salts"],
];

const FREQUENCIES = [
  [/\b1\s*-\s*0\s*-\s*1\b/, "morning and night"],
  [/\b1\s*-\s*1\s*-\s*1\b/, "morning, afternoon and night"],
  [/\b0\s*-\s*0\s*-\s*1\b/, "at night"],
  [/\b1\s*-\s*0\s*-\s*0\b/, "in the morning"],
  [/\b0\s*-\s*1\s*-\s*0\b/, "in the afternoon"],
  [/\bonce a week\b|\bweekly\b/i, "once a week"],
  [/\b(thrice|three times) (daily|a day)\b|\bTDS\b|\bTID\b/i, "three times a day"],
  [/\b(twice|two times) (daily|a day)\b|\bBD\b|\bBID\b/i, "twice a day"],
  [/\bonce (daily|a day)[^.\n]*night\b|\bat (bedtime|night)\b|\bHS\b/i, "at bedtime"],
  [/\bonce (daily|a day)\b|\bOD\b/i, "once a day"],
  [/\bQID\b|\bfour times\b/i, "four times a day"],
  [/\bSOS\b|\bas (needed|required)\b|\bwhen (needed|required)\b/i, "only when needed"],
];

const VACCINES = /\b(BCG|Hepatitis [AB]|OPV|IPV|Pentavalent|Rotavirus|PCV|Measles|MR\b|MMR|DPT|DTP|Typhoid|Td\b|Tetanus|Covishield|Covaxin|Influenza|HPV|Varicella|Japanese Encephalitis|Rabies|ARV)\b[^\n,;]*/gi;

const ABNORMAL_TERMS = /\b(fracture|dislocation|mass|lesion|nodule|effusion|consolidation|calcul(us|i)|stone|cyst|enlarge[d]?|hepatomegaly|splenomegaly|cardiomegaly|infarct|h(a)?emorrhage|thickening|collapse|obstruction|stenosis|osteophytes?|reduced|degenerative|fatty change|opacity|oedema|edema|abscess|tumou?r|lymphadenopathy|fibroid|hernia|thickened|stranding|dilated|dilatation|inflamed|inflammation|swollen|swelling|rupture[d]?|tear|narrowing|displaced|collection)\b/i;
const NEGATION = /\b(no|not|without|free of|absence of|negative for|unremarkable|normal)\b/i;

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

const DATE = /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/;

/** Turn "12/09/2026" into "2026-09-12". Dates are read day first, as written in India. */
function isoDate(written) {
  const parts = String(written).split(/[\/.\-]/).map(Number);
  if (parts.length !== 3) return "";
  let [day, month, year] = parts;
  if (month > 12 && day <= 12) [day, month] = [month, day];
  if (year < 100) year += 2000;
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1990 && year <= 2100)) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The date a document is about: when the sample was taken, the report made or the patient seen. */
export function findReportDate(text) {
  const labels = [
    "collected(?: on)?", "sample (?:date|collected)", "blood drawn", "report(?:ed)?(?: on| date)?", "date of report",
    "date of discharge", "discharged on", "\\bDOD\\b", "dated?", "date of dose", "scanned", "examination performed",
  ];
  const notBirth = linesOf(text).filter((line) => !/\b(d\.?o\.?b|birth|born)\b/i.test(line)).join("\n");
  for (const label of labels) {
    const match = notBirth.match(new RegExp(`${label}\\s*[:\\-]?\\s*[^\\n]{0,24}?(${DATE.source})`, "i"));
    if (match && isoDate(match[1])) return isoDate(match[1]);
  }
  for (const line of linesOf(text)) {
    if (/\b(d\.?o\.?b|birth|born)\b/i.test(line)) continue;
    const match = line.match(DATE);
    if (match && isoDate(match[0])) return isoDate(match[0]);
  }
  return "";
}

export function linesOf(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/g, ""))
    .filter((line) => line.trim().length > 0);
}

function sentencesOf(text) {
  return linesOf(text)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z(])/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

function tidy(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:\-–|>*.,;]+|[\s:\-–|;,]+$/g, "")
    .trim();
}

/** How many single-character changes turn one word into another (Levenshtein distance). */
export function editDistance(a, b) {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

function capitalise(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function plural(count, word) {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

/** Find the value written after one of several labels, e.g. "Final diagnosis: ...". */
function fieldAfter(text, labels) {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|\\n)[^\\n]{0,12}?${label}\\s*(?:[:\\-–]|\\bis\\b|\\bwas\\b)?\\s*([^\\n]+)`, "i"));
    if (match && tidy(match[1]).length > 2) return tidy(match[1]).replace(/\.$/, "");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Lab reports
// ---------------------------------------------------------------------------

const NOT_A_TEST = /\b(patient|name|age|sex|gender|date|dated|uhid|reg|phone|mobile|tel|lab no|barcode|page|sample|specimen|collected|received|reported|printed|referred|ref\.? by|doctor|dr\.|bill|id\b|dob|ward|bed|token|pin|road|nagar|lines|blood drawn|client|method)\b/i;
// A number that stands alone: not part of a word such as B12, HbA1c or (25-OH).
const VALUE = /(?<![A-Za-z0-9(.\-\/])([<>]?\s?\d+(?:\.\d+)?)(?![A-Za-z0-9]|\.\d|-[A-Za-z]|\/\d)/;

function parseReference(text) {
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
  if (range) return { low: Number(range[1]), high: Number(range[2]), text: `${range[1]} - ${range[2]}`, raw: [range[1], range[2]] };
  const below = text.match(/(?:<|less than|up ?to|below)\s*(\d+(?:\.\d+)?)/i);
  if (below) return { low: null, high: Number(below[1]), text: `< ${below[1]}`, raw: [null, below[1]] };
  const above = text.match(/(?:>|more than|above|over)\s*(\d+(?:\.\d+)?)/i);
  if (above) return { low: Number(above[1]), high: null, text: `> ${above[1]}`, raw: [above[1], null] };
  return null;
}

function referenceText(test) {
  if (test.low !== null && test.high !== null) return `${test.low} - ${test.high}`;
  return test.high !== null ? `< ${test.high}` : `> ${test.low}`;
}

// ---- Checks for text that was read from a picture (OCR) --------------------
//
// OCR reads words well but often drops a decimal point: "1.5 - 4.5" comes out
// as "15-45" and "0.6" as "06". A summary that compared a value with such a
// range would call a normal result "low". So for OCR text:
//   - a range printed next to a test we know is compared with that test's
//     typical range. If it only makes sense with the decimal point put back,
//     it is put back and marked as corrected.
//   - a value that is far outside anything plausible, or that looks as if it
//     lost its own decimal point, is not judged at all. It is reported as
//     "unclear" so the reader checks the picture.
//   - for tests we do not know, nothing can be cross-checked, so a line whose
//     numbers are written inconsistently is also reported as unclear.

const hasDecimal = (token) => token.includes(".");
const lostDecimal = (token) => !hasDecimal(token) && token.length >= 2 && token.startsWith("0");

/** Is a printed range close to the typical range of a known test? */
function plausibleReference(low, high, known) {
  const near = (read, typical) => read === null || typical === null || (typical === 0 ? read <= 5 : read >= typical / 2.5 && read <= typical * 2.5);
  return near(low, known.low) && near(high, known.high) && (low === null || high === null || low < high);
}

function plausibleValue(value, known) {
  const floor = known.low ? known.low / 10 : 0;
  const ceiling = (known.high !== null ? known.high : known.low * 3) * 3;
  return value >= floor && value <= ceiling;
}

/** Ways a number may have been printed before OCR dropped its decimal point: [{ value, text }]. */
function decimalCandidates(token) {
  if (token === null) return [{ value: null, text: "" }];
  const candidates = [{ value: Number(token), text: token }];
  if (!hasDecimal(token)) {
    // "15" may have been "1.5", and "06" was certainly "0.6".
    const withPoint = lostDecimal(token) ? `0.${token.slice(1)}` : `${token.slice(0, -1) || "0"}.${token.slice(-1)}`;
    candidates.push({ value: Number(withPoint), text: withPoint });
  }
  return candidates;
}

/** Put a dropped decimal point back into a range, if exactly that makes it match a known test. */
function repairReference(printed, known) {
  for (const low of decimalCandidates(printed.raw[0])) {
    for (const high of decimalCandidates(printed.raw[1])) {
      if (low.value === printed.low && high.value === printed.high) continue;
      if (plausibleReference(low.value, high.value, known)) {
        const text = low.value === null ? `< ${high.text}` : high.value === null ? `> ${low.text}` : `${low.text} - ${high.text}`;
        return { low: low.value, high: high.value, text, raw: printed.raw, repaired: true };
      }
    }
  }
  return null;
}

function parseLabLine(line, { ocr = false } = {}) {
  const flat = line.replace(/[|\t]+/g, "  ");
  const match = flat.match(VALUE);
  if (!match || match.index < 2) return null;

  const rawName = tidy(flat.slice(0, match.index).replace(/\b(result|measured|observed|value|is|was)\b\s*$/i, ""));
  const name = tidy(rawName.replace(/\b(result|measured|observed)\b/gi, ""));
  if (name.length < 2 || name.length > 45 || !/[A-Za-z]{2}/.test(name) || NOT_A_TEST.test(name)) return null;

  const valueToken = match[1].replace(/[<>\s]/g, "");
  const value = Number(valueToken);
  if (!Number.isFinite(value)) return null;

  let rest = flat.slice(match.index + match[0].length);
  // "HbA1c   4.0 - 5.6": the only numbers on the line are a range, so there is no result to report.
  if (/^\s*[-–]\s*\d/.test(rest) && !/\d/.test(rest.replace(/^\s*[-–]\s*[\d.]+/, ""))) return null;
  const unitMatch = rest.match(/^\s*([A-Za-zµ%][A-Za-z0-9µ%\/.^]{0,14})/);
  let unit = "";
  if (unitMatch && !/^(reference|normal|expected|range|ref|result|and|to|h|l)$/i.test(unitMatch[1].replace(/[.,;]$/, ""))) {
    unit = unitMatch[1].replace(/[.,;]$/, "");
    rest = rest.slice(unitMatch[0].length);
  }
  if (ocr && /^u[il1|][uU]\/m[lL1]$/.test(unit)) unit = "uIU/mL"; // a common misread

  const known = LAB_TESTS.find((test) => test.match.test(name));
  // A picture can turn "HbA1c" into "HbAlc". If a name is one or two characters
  // away from a test we know, show the proper spelling.
  const shownName = ocr && known && name !== known.name && editDistance(name.toLowerCase(), known.name.toLowerCase()) <= 2 ? known.name : name;
  const printed = parseReference(rest);
  if (!printed && !known) return null; // neither a range on the line nor a test we know: not a result line

  let reference = printed || { low: known.low, high: known.high, text: referenceText(known), assumed: true };
  let uncertain = false;

  if (ocr) {
    if (printed && known && !plausibleReference(printed.low, printed.high, known)) {
      // The printed range does not fit this test. Try it with the decimal point back,
      // and failing that fall back on the test's typical range.
      reference = repairReference(printed, known) || { low: known.low, high: known.high, text: referenceText(known), assumed: true };
    }
    const outside = (reference.low !== null && value < reference.low) || (reference.high !== null && value > reference.high);

    // A value written like "08" has certainly lost its decimal point.
    if (lostDecimal(valueToken)) uncertain = true;
    // A value far beyond anything seen for this test is more likely a misread than a result.
    if (known && !plausibleValue(value, known)) uncertain = true;
    // A whole number judged against a range written with decimals ("45" against
    // "12.0 - 15.0") may be a misread 4.5. Accept it only if it is in range anyway.
    if (known && outside && !hasDecimal(valueToken) && hasDecimal(reference.text)) uncertain = true;
    if (!known && printed) {
      // Nothing to cross-check against: trust the line only if its numbers are written the same way.
      const tokens = [valueToken, ...printed.raw.filter(Boolean)];
      const mixed = tokens.some(hasDecimal) && tokens.some((token) => !hasDecimal(token) && Number(token) < 100);
      if (mixed || tokens.some(lostDecimal)) uncertain = true;
    }
  }

  let status = "normal";
  if (uncertain) status = "unclear";
  else if (reference.low !== null && value < reference.low) status = "low";
  else if (reference.high !== null && value > reference.high) status = "high";
  else if (!printed && /\(\s*H\s*\)|\bhigh\b/i.test(rest)) status = "high";
  else if (!printed && /\(\s*L\s*\)|\blow\b/i.test(rest)) status = "low";

  return {
    name: shownName,
    key: known ? known.name : name, // one name per test, so results can be followed across reports
    value,
    unit,
    reference: reference.text,
    referenceAssumed: Boolean(reference.assumed),
    referenceCorrected: Boolean(reference.repaired),
    status,
    valueAsRead: uncertain ? valueToken : undefined, // what the picture seemed to say, when it is unclear
    known,
  };
}

/** The one name a test goes by, however a report spells it ("Hb", "Hemoglobin" -> "Haemoglobin"). */
export function testKey(name) {
  const known = LAB_TESTS.find((test) => test.match.test(name));
  return known ? known.name : name;
}

/** The low and high ends of a range written as "12.0 - 15.0", "< 200" or "> 40" (null where there is none). */
export function rangeBounds(reference) {
  const parsed = parseReference(String(reference || ""));
  return parsed ? { low: parsed.low, high: parsed.high } : { low: null, high: null };
}

export function extractLabValues(text, options = {}) {
  const seen = new Set();
  const findings = [];
  for (const line of linesOf(text)) {
    const finding = parseLabLine(line, options);
    if (!finding) continue;
    const key = finding.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(finding);
  }
  return findings;
}

function summariseLab(text, options = {}) {
  const findings = extractLabValues(text, options);
  if (findings.length === 0) return null;
  const abnormal = findings.filter((f) => f.status === "high" || f.status === "low");
  const unclear = findings.filter((f) => f.status === "unclear");
  const judged = findings.length - unclear.length;
  const withUnit = (f) => `${f.value}${f.unit ? ` ${f.unit}` : ""}`;
  const show = (f) => `${f.name} ${withUnit(f)} (${f.status}, reference ${f.reference})`;
  const unclearNote = unclear.length ? ` ${plural(unclear.length, "value")} could not be read reliably from the picture.` : "";
  const unclearPoint = (f) => `${f.name}: read as ${f.valueAsRead ?? f.value}${f.unit ? ` ${f.unit}` : ""}, but the picture is unclear here. Check the original.`;

  const forDoctor = {
    headline:
      (abnormal.length > 0
        ? `${plural(findings.length, "value")} reported, ${abnormal.length} outside the reference range.`
        : unclear.length > 0
          ? `${plural(findings.length, "value")} reported, none clearly outside the reference range.`
          : `${plural(findings.length, "value")} reported, all within the reference range.`) + unclearNote,
    points: [
      ...(abnormal.length || unclear.length ? abnormal.map(show) : findings.slice(0, 6).map((f) => `${f.name} ${withUnit(f)}`)),
      ...unclear.map(unclearPoint),
    ],
  };

  const patientPoints = abnormal.map((f) => {
    const direction = f.status === "high" ? "higher" : "lower";
    const note = f.known ? (f.status === "high" ? f.known.highNote : f.known.lowNote) : "";
    const about = f.known ? ` ${capitalise(f.known.name)} is ${f.known.about}.` : "";
    return `${f.name} is ${direction} than the normal range (${withUnit(f)}, normal ${f.reference}).${about}${note ? ` A ${f.status} value ${note}.` : ""}`;
  });
  const forPatient = {
    headline:
      (abnormal.length === 0
        ? unclear.length
          ? `${judged} of the ${findings.length} results on this report could be read, and ${judged === 1 ? "it is" : "they are"} in the normal range.`
          : `All ${findings.length} results on this report are in the normal range.`
        : `${abnormal.length} of the ${findings.length} results on this report ${abnormal.length === 1 ? "is" : "are"} outside the normal range.`) +
      unclearNote,
    points: [
      ...patientPoints,
      ...unclear.map(unclearPoint),
      abnormal.length
        ? "Results outside the range are common and do not always mean illness. Ask your doctor what they mean for you."
        : unclear.length
          ? "Compare the unclear results with the picture, or ask the lab for a typed copy."
          : "Nothing on this report is marked as high or low.",
    ],
  };

  return {
    forDoctor,
    forPatient,
    findings: findings.map(({ known, ...finding }) => finding),
  };
}

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

const STRENGTH = /(\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|iu|units?))\b/i;
const FORM = /\b(tab(?:let)?|cap(?:sule)?|syp|syr(?:up)?|inj(?:ection)?|drops?|oint(?:ment)?|inhaler|sachet)\b\.?/i;

/** Undo the usual ways OCR mangles a prescription line: "50 meg" for mcg, "1U" for IU, "200mg". */
function repairMedicineLine(line) {
  return line
    .replace(/(\d)\s?meg\b/gi, "$1 mcg")
    .replace(/(\d)\s?[1Il]U\b/g, "$1 IU")
    .replace(/(\d)(mg|mcg|ml|g)\b/gi, "$1 $2")
    .replace(/^(\s*\d+)\s?[,;:]\s/, "$1. ");
}

export function extractMedicines(text, { ocr = false } = {}) {
  const medicines = [];
  const seen = new Set();
  for (const written of linesOf(text)) {
    const line = ocr ? repairMedicineLine(written) : written;
    const body = line.replace(/^\s*(?:\d+[.)]|[-*•>])\s*/, "");
    const listed = body.length !== line.trim().length;
    const formMatch = body.match(FORM);
    const strengthMatch = body.match(STRENGTH);
    const purposeEntry = MEDICINES.find(([pattern]) => pattern.test(body));
    const startsWithForm = formMatch && formMatch.index < 3;
    if (!(startsWithForm || (listed && (strengthMatch || purposeEntry)))) continue;
    if (/^(advice|adv|review|follow|next visit|diagnosis|c[\/l]o|bp|pulse)\b/i.test(body)) continue;

    let name = startsWithForm ? body.slice(formMatch.index + formMatch[0].length) : body;
    // The name ends at the strength, or at the first number standing on its own ("Vitamin D3" keeps its 3).
    const cut = [strengthMatch ? name.indexOf(strengthMatch[0]) : -1, name.search(/\s{2,}|,|--| x | take | dosage |\s\d/i)].filter((i) => i > 0);
    name = tidy(cut.length ? name.slice(0, Math.min(...cut)) : name);
    if (name.length < 2 || name.length > 40) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const frequency = FREQUENCIES.find(([pattern]) => pattern.test(body));
    const duration = body.match(/(?:\bx|\bfor\b|course of)\s*(\d+\s*(?:days?|weeks?|months?))/i);
    const timing = body.match(/\b(after food|before food|after meals?|before meals?|empty stomach)\b/i);
    medicines.push({
      name: capitalise(name),
      strength: strengthMatch ? strengthMatch[1].replace(/\s+/g, " ") : "",
      frequency: frequency ? frequency[1] : "",
      duration: duration ? duration[1] : /to continue|continue/i.test(body) ? "ongoing" : "",
      timing: timing ? timing[1].toLowerCase() : "",
      purpose: purposeEntry ? purposeEntry[1] : "",
    });
  }
  return medicines;
}

function describeMedicine(medicine, plain) {
  const parts = [`${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ""}`];
  if (medicine.frequency) parts.push(medicine.frequency);
  if (medicine.timing) parts.push(medicine.timing);
  if (medicine.duration) parts.push(medicine.duration === "ongoing" ? "to be continued" : `for ${medicine.duration}`);
  const line = parts.join(", ");
  return plain && medicine.purpose ? `${line}. This is ${medicine.purpose}.` : line;
}

function adviceLines(text) {
  return linesOf(text)
    .filter((line) => /^(advice|adv|review|follow ?up|next visit|refill)\b|follow up|review (after|in|with)/i.test(line.trim()))
    .map((line) => tidy(line))
    .slice(0, 3);
}

function summarisePrescription(text, options = {}) {
  const medicines = extractMedicines(text, options);
  if (medicines.length === 0) return null;
  const complaint = fieldAfter(text, ["c\\/o", "\\bclo(?=\\s*:)", "chief complaint", "presenting problem", "complaints?"]);
  const diagnosis = fieldAfter(text, ["diagnosis"]);
  const advice = adviceLines(text);

  return {
    forDoctor: {
      headline: `${plural(medicines.length, "medicine")} prescribed${diagnosis ? ` for ${diagnosis.toLowerCase()}` : complaint ? ` for ${complaint.toLowerCase()}` : ""}.`,
      points: [...medicines.map((m) => describeMedicine(m, false)), ...advice],
    },
    forPatient: {
      headline: `This prescription lists ${plural(medicines.length, "medicine")}.`,
      points: [
        ...medicines.map((m) => describeMedicine(m, true)),
        ...advice,
        "Take medicines exactly as your doctor told you. This summary only repeats what is written on the prescription.",
      ],
    },
    medicines,
    facts: { complaint, diagnosis },
  };
}

// ---------------------------------------------------------------------------
// Discharge summaries
// ---------------------------------------------------------------------------

function summariseDischarge(text, options = {}) {
  const diagnosis =
    fieldAfter(text, ["final diagnosis", "diagnosis at discharge", "discharge diagnosis", "working diagnosis became", "provisional diagnosis", "diagnosis"]);
  const procedure = fieldAfter(text, ["procedure done", "operative notes", "treatment given", "managed with", "carried out", "procedure", "course in hospital"]);
  const condition = fieldAfter(text, ["condition at discharge", "discharged in", "on leaving the ward the patient was", "discharged"]);
  const admitted = (text.match(new RegExp(`(?:date of admission|admitted on|admission|\\bDOA\\b)[^\\n]{0,12}?(${DATE.source})`, "i")) || [])[1] || "";
  const discharged = (text.match(new RegExp(`(?:date of discharge|discharged on|discharge|\\bDOD\\b)[^\\n]{0,12}?(${DATE.source})`, "i")) || [])[1] || "";
  const followUp = tidy(linesOf(text).find((line) => /follow ?up|review in|return to the outpatient|sutures/i.test(line)) || "");
  const medicines = extractMedicines(text, options);
  if (!diagnosis && !procedure && medicines.length === 0) return null;

  const stay = admitted && discharged ? `Admitted ${admitted}, discharged ${discharged}.` : "";
  const doctorPoints = [
    diagnosis && `Diagnosis: ${diagnosis}.`,
    procedure && `Treatment: ${procedure.replace(/\.$/, "")}.`,
    stay,
    condition && `Condition at discharge: ${condition.replace(/\.$/, "")}.`,
    medicines.length && `Discharge medication: ${medicines.map((m) => describeMedicine(m, false)).join("; ")}.`,
    followUp && `Follow-up: ${followUp.replace(/^follow ?up\s*/i, "").replace(/\.$/, "")}.`,
  ].filter(Boolean);

  const patientPoints = [
    diagnosis && `The hospital recorded the diagnosis as: ${diagnosis}.`,
    procedure && `Treatment during the stay: ${procedure.replace(/\.$/, "")}.`,
    stay && `You were in hospital from ${admitted} to ${discharged}.`,
    condition && `At discharge your condition was noted as: ${condition.replace(/\.$/, "")}.`,
    ...medicines.map((m) => `Medicine to take at home: ${describeMedicine(m, true)}`),
    followUp && `What to do next: ${followUp.replace(/\.$/, "")}.`,
  ].filter(Boolean);

  return {
    forDoctor: { headline: diagnosis ? `Discharge after treatment for ${diagnosis.toLowerCase()}.` : "Discharge summary.", points: doctorPoints },
    forPatient: {
      headline: "A summary of your hospital stay.",
      points: [...patientPoints, "If anything here is unclear, or you feel worse, contact the hospital."],
    },
    medicines,
    facts: { diagnosis, procedure, admitted, discharged, condition, followUp },
  };
}

// ---------------------------------------------------------------------------
// Scans and imaging
// ---------------------------------------------------------------------------

function summariseScan(text) {
  const study = tidy(
    (linesOf(text).find((line) => /(x-?ray|ultrasound|\busg\b|sonograph|\bmri\b|\bct\b|echo|mammograph|doppler)/i.test(line) && line.length < 90) || "")
      .replace(/^(study|examination performed|modality and region)\s*[:\-]?\s*/i, "")
      .replace(/\s*-?\s*report$/i, ""),
  );
  const impression = fieldAfter(text, ["impression", "conclusion", "overall opinion", "opinion", "\\bimp\\b"]);
  const sentences = sentencesOf(text).map((s) => s.replace(/^[-(\d)]+\s*/, ""));
  const notable = sentences.filter((s) => ABNORMAL_TERMS.test(s) && !NEGATION.test(s)).slice(0, 4);
  if (!impression && notable.length === 0 && !study) return null;

  const normal = /\b(normal study|no significant abnormality|essentially normal|unremarkable)\b/i.test(impression) && notable.length === 0;
  return {
    forDoctor: {
      headline: `${study ? `${capitalise(study.toLowerCase())}: ` : ""}${impression ? impression : notable.length ? "findings noted, no impression line." : "report read."}`,
      points: notable.length ? notable : normal ? ["No finding is described as abnormal."] : [],
    },
    forPatient: {
      headline: normal
        ? "The radiologist's conclusion is that this scan is normal."
        : impression
          ? `The radiologist's conclusion: ${impression}`
          : "The report describes some findings.",
      points: [
        study && `This is a report of: ${study.toLowerCase()}.`,
        ...notable.map((s) => `The report notes: ${s}`),
        "Scan reports use technical words. Your doctor can explain what this means for you.",
      ].filter(Boolean),
    },
    facts: { study, impression },
  };
}

// ---------------------------------------------------------------------------
// Vaccination records
// ---------------------------------------------------------------------------

function summariseVaccination(text) {
  const given = [];
  const seen = new Set();
  for (const line of linesOf(text)) {
    if (/next|due/i.test(line)) continue;
    for (const match of line.matchAll(VACCINES)) {
      // "Covishield Dose 2 09/07/2021 Batch B5630" -> name "Covishield", dose "Dose 2"
      const name = tidy(match[0].split(/\s{2,}| - | given | \(|\s+(?=dose\b|booster\b|single\b|birth\b|precaution\b|\d)/i)[0]);
      const dose = tidy((line.match(/\b(dose \d|booster|single dose|birth dose|precaution dose)\b/i) || [""])[0]);
      const date = (line.match(DATE) || [""])[0];
      const key = `${name}|${dose}|${date}`.toLowerCase();
      if (name.length < 2 || seen.has(key)) continue;
      seen.add(key);
      given.push({ name, dose, date });
    }
  }
  if (given.length === 0) return null;
  const next = tidy(linesOf(text).find((line) => /next (vaccine|dose)|due (date|on|for)|booster.*due|due.*booster/i.test(line)) || "");
  const list = given.map((v) => `${v.name}${v.dose ? `, ${v.dose.toLowerCase()}` : ""}${v.date ? ` (${v.date})` : ""}`);
  return {
    forDoctor: { headline: `${plural(given.length, "vaccine dose")} recorded.`, points: [...list, next].filter(Boolean) },
    forPatient: {
      headline: `This record shows ${plural(given.length, "vaccine dose")} given.`,
      points: [...list, next ? `Coming up: ${next}.` : "", "Keep this record safe. It is often needed for school, travel and future vaccines."].filter(Boolean),
    },
    facts: { vaccines: given, next },
  };
}

// ---------------------------------------------------------------------------
// TextRank: pick the most central sentences (used when nothing else fits)
// ---------------------------------------------------------------------------

export const STOP = new Set("the a an and or of to in on for with at by from is are was were be been this that it as your you we our has have had not no will can may please".split(" "));

export function textRank(text, count = 3) {
  const sentences = sentencesOf(text).filter((s) => !/^(phone|page|printed|www\.)/i.test(s)).slice(0, 80);
  if (sentences.length <= count) return sentences;

  const bags = sentences.map((s) => {
    const bag = new Map();
    for (const word of s.toLowerCase().match(/[a-z]{3,}/g) || []) if (!STOP.has(word)) bag.set(word, (bag.get(word) || 0) + 1);
    return bag;
  });
  const documentFrequency = new Map();
  for (const bag of bags) for (const word of bag.keys()) documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
  const vectors = bags.map((bag) => {
    const vector = new Map();
    let norm = 0;
    for (const [word, tf] of bag) {
      const weight = tf * Math.log(1 + sentences.length / documentFrequency.get(word));
      vector.set(word, weight);
      norm += weight * weight;
    }
    return { vector, norm: Math.sqrt(norm) || 1 };
  });
  const similarity = (a, b) => {
    let dot = 0;
    for (const [word, weight] of a.vector) dot += weight * (b.vector.get(word) || 0);
    return dot / (a.norm * b.norm);
  };

  const n = sentences.length;
  const weights = vectors.map((a, i) => vectors.map((b, j) => (i === j ? 0 : similarity(a, b))));
  const totals = weights.map((row) => row.reduce((sum, w) => sum + w, 0) || 1);
  let rank = new Array(n).fill(1 / n);
  for (let iteration = 0; iteration < 30; iteration++) {
    rank = rank.map((_, i) => 0.15 / n + 0.85 * weights.reduce((sum, row, j) => sum + (row[i] / totals[j]) * rank[j], 0));
  }
  return rank
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map(({ index }) => sentences[index]);
}

function summariseGeneric(text) {
  const key = textRank(text, 3);
  if (key.length === 0) return null;
  return {
    forDoctor: { headline: "Key lines from this document.", points: key },
    forPatient: { headline: "The main lines of this document.", points: [...key, "This is a short extract, not a full reading. Open the document for the details."] },
  };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

const EXTRACTORS = {
  "Lab report": summariseLab,
  Prescription: summarisePrescription,
  "Discharge summary": summariseDischarge,
  "Scan or imaging": summariseScan,
  "Vaccination record": summariseVaccination,
};

/**
 * Summarise a document.
 * `declaredType` is the record type the uploader chose; the classifier's own
 * opinion is used when that type has no extractor or finds nothing.
 * Returns null when the document has too little text to say anything.
 */
export function summariseDocument(text, declaredType = "", { source = "text", confidence = null } = {}) {
  const clean = String(text || "").trim();
  if (clean.length < 40) return null;
  const ocr = source === "ocr";

  const predicted = classifyRecordText(clean);
  const candidates = [declaredType, predicted.confident ? predicted.recordType : ""].filter((type, i, all) => type && all.indexOf(type) === i);

  let recordType = "";
  let body = null;
  for (const type of candidates) {
    body = EXTRACTORS[type] ? EXTRACTORS[type](clean, { ocr }) : null;
    if (body) {
      recordType = type;
      break;
    }
  }
  if (!body) {
    body = summariseGeneric(clean);
    recordType = declaredType || (predicted.confident ? predicted.recordType : "Other");
  }
  if (!body) return null;

  return {
    version: 2,
    recordType,
    generatedBy: "MedSecure built-in summariser",
    // How the text was obtained. "ocr" means it was read from a picture.
    source: ocr ? "ocr" : "text",
    ocrConfidence: ocr ? confidence : null,
    forDoctor: body.forDoctor,
    forPatient: body.forPatient,
    findings: body.findings || [],
    medicines: body.medicines || [],
    facts: { ...(body.facts || {}), reportDate: findReportDate(clean) },
    caution: ocr ? OCR_CAUTION : SUMMARY_CAUTION,
  };
}

export const summaryModelInfo = {
  name: "Report summary",
  method: "Record-type classifier, rule-based clinical information extraction, TextRank sentence ranking; optional local language model for wording",
  data: "Synthetic documents with known contents. No real patient data was used.",
};
