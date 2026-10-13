import fs from "node:fs";

// A generic "TF-IDF + logistic regression" text classifier, loaded from the
// JSON that the Python training scripts export. It repeats scikit-learn's
// arithmetic exactly (see test/ml-parity.mjs).
//
// A model has one or more feature blocks, joined side by side:
//   "word"     words and word pairs
//   "char_wb"  pieces of 2-4 letters taken from inside each word, which is
//              what makes the model tolerant of spelling mistakes

/** Lower-case and drop non-ASCII characters, exactly as the training scripts do. */
function clean(text) {
  return String(text).toLowerCase().replace(/[^\x00-\x7f]/g, " ");
}

function wordTerms(text, [, maxN]) {
  const words = text.match(/\b[a-z][a-z]+\b/g) || [];
  const terms = [...words];
  if (maxN >= 2) for (let i = 0; i + 1 < words.length; i++) terms.push(`${words[i]} ${words[i + 1]}`);
  return terms;
}

/** scikit-learn's "char_wb" analyser: n-grams inside each word, padded with a space on both sides. */
function wordPieceTerms(text, [minN, maxN]) {
  const terms = [];
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const padded = ` ${word} `;
    for (let n = minN; n <= maxN; n++) {
      let offset = 0;
      terms.push(padded.slice(offset, offset + n));
      while (offset + n < padded.length) {
        offset += 1;
        terms.push(padded.slice(offset, offset + n));
      }
      if (offset === 0) break; // a word shorter than n is counted once
    }
  }
  return terms;
}

export function loadTextModel(fileName) {
  const model = JSON.parse(fs.readFileSync(new URL(`./models/${fileName}`, import.meta.url), "utf8"));

  // Older model files have a single word block at the top level.
  const blocks = (model.features || [{ analyzer: "word", ngramRange: model.ngramRange || [1, 2], vocabulary: model.vocabulary, idf: model.idf }]).map(
    (block) => ({ ...block, vocabulary: new Map(Object.entries(block.vocabulary)) }),
  );
  let offset = 0;
  for (const block of blocks) {
    block.offset = offset;
    offset += block.idf.length;
  }

  /** TF-IDF weights as a sparse Map of column -> weight. Each block is L2-normalised on its own. */
  function vectorize(text) {
    const cleaned = clean(text);
    const vector = new Map();
    for (const block of blocks) {
      const terms = block.analyzer === "char_wb" ? wordPieceTerms(cleaned, block.ngramRange) : wordTerms(cleaned, block.ngramRange);
      const counts = new Map();
      for (const term of terms) {
        const column = block.vocabulary.get(term);
        if (column !== undefined) counts.set(column, (counts.get(column) || 0) + 1);
      }
      let norm = 0;
      for (const [column, count] of counts) {
        const weight = (1 + Math.log(count)) * block.idf[column]; // sublinear term frequency
        counts.set(column, weight);
        norm += weight * weight;
      }
      norm = Math.sqrt(norm) || 1;
      for (const [column, weight] of counts) vector.set(block.offset + column, weight / norm);
    }
    return vector;
  }

  /** Returns { label, confidence, known } where `known` is false if nothing in the text is in the vocabulary. */
  function classify(text) {
    const vector = vectorize(text);
    const scores = model.classes.map((_, k) => {
      let z = model.intercept[k];
      for (const [column, weight] of vector) z += model.coef[k][column] * weight;
      return z;
    });
    const top = Math.max(...scores);
    const exps = scores.map((z) => Math.exp(z - top));
    const total = exps.reduce((a, b) => a + b, 0);
    const best = exps.indexOf(Math.max(...exps));
    return { label: model.classes[best], confidence: exps[best] / total, known: vector.size > 0 };
  }

  return {
    classify,
    knownWords: new Set(model.knownWords || []),
    info: { method: model.description, trainedOn: model.trainedOn, metrics: model.metrics },
  };
}
