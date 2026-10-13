import fs from "node:fs";

// Record-type classifier: TF-IDF + logistic regression.
//
// The model is trained in Python (see /ml/train_classifier.py) and exported
// as JSON. This file repeats the same arithmetic in JavaScript, so the
// backend needs no Python and the text never leaves this process.

const model = JSON.parse(fs.readFileSync(new URL("./models/record-type.json", import.meta.url), "utf8"));
const vocabulary = new Map(Object.entries(model.vocabulary));

/** Lower-case, drop non-ASCII, split into words of 2+ letters, add word pairs. Same as training. */
function terms(text) {
  const clean = String(text).toLowerCase().replace(/[^\x00-\x7f]/g, " ");
  const words = clean.match(/\b[a-z][a-z]+\b/g) || [];
  const all = [...words];
  for (let i = 0; i + 1 < words.length; i++) all.push(`${words[i]} ${words[i + 1]}`);
  return all;
}

/** Turn text into a TF-IDF vector (sparse: Map of column -> weight), L2-normalised. */
function vectorize(text) {
  const counts = new Map();
  for (const term of terms(text)) {
    const column = vocabulary.get(term);
    if (column !== undefined) counts.set(column, (counts.get(column) || 0) + 1);
  }
  let norm = 0;
  for (const [column, count] of counts) {
    const weight = (1 + Math.log(count)) * model.idf[column]; // sublinear term frequency
    counts.set(column, weight);
    norm += weight * weight;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [column, weight] of counts) counts.set(column, weight / norm);
  return counts;
}

/**
 * Classify a document's text.
 * Returns { recordType, confidence, confident, ranking } where `confident`
 * says whether the model is sure enough for the app to suggest its answer.
 */
export function classifyRecordText(text) {
  const vector = vectorize(text);
  const scores = model.classes.map((_, k) => {
    let z = model.intercept[k];
    for (const [column, weight] of vector) z += model.coef[k][column] * weight;
    return z;
  });
  const top = Math.max(...scores);
  const exps = scores.map((z) => Math.exp(z - top));
  const total = exps.reduce((a, b) => a + b, 0);
  const ranking = model.classes
    .map((recordType, k) => ({ recordType, confidence: exps[k] / total }))
    .sort((a, b) => b.confidence - a.confidence);
  return {
    recordType: ranking[0].recordType,
    confidence: ranking[0].confidence,
    confident: vector.size > 0 && ranking[0].confidence >= model.threshold,
    ranking: ranking.slice(0, 3),
  };
}

export const recordTypeModelInfo = {
  name: "Record type suggestion",
  method: model.description,
  trainedOn: model.trainedOn,
  metrics: model.metrics,
  data: "Synthetic documents. No real patient data was used.",
};
