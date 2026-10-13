import { createRequire } from "node:module";
import path from "node:path";

// Reads the text in a picture of a document (OCR), so that photos and scans
// of reports can be classified, summarised and asked about like PDFs.
//
// It uses Tesseract, compiled to WebAssembly, running inside this process.
// The English language data comes from an npm package on disk, so nothing is
// downloaded when it runs and no image ever leaves this computer.
//
// OCR is not exact. It reads words well but can drop a decimal point or
// confuse similar characters, so everything read this way is marked as
// "read from a picture" and the summariser double-checks numbers (see
// summarize.js).

const require = createRequire(import.meta.url);

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp"]);
const IMAGE_NAME = /\.(png|jpe?g|webp|bmp)$/i;
const RECOGNISE_TIMEOUT_MS = 60_000;
const IDLE_SHUTDOWN_MS = 90_000;
const MIN_CONFIDENCE = 40; // below this the "text" is mostly noise
const MODE = process.env.OCR_MODE || "double"; // "single" skips the second pass (used to measure what it adds)

let workerPromise = null;
let idleTimer = null;
let queue = Promise.resolve();

export function isImage(file) {
  return IMAGE_TYPES.has(String(file.mimetype || "").toLowerCase()) || IMAGE_NAME.test(file.originalname || "");
}

/** Do the first bytes look like a PNG, JPEG, WebP or BMP? A file can be named .png and be something else. */
function looksLikeAnImage(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const starts = (...bytes) => bytes.every((byte, i) => buffer[i] === byte);
  return (
    starts(0x89, 0x50, 0x4e, 0x47) || // PNG
    starts(0xff, 0xd8, 0xff) || // JPEG
    starts(0x42, 0x4d) || // BMP
    (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP")
  );
}

async function startWorker() {
  const { createWorker } = await import("tesseract.js");
  const languageData = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
  const worker = await createWorker("eng", 1, {
    langPath: languageData,
    cacheMethod: "none",
    gzip: true,
    // Without this the library throws from inside its worker when it cannot read
    // an image, which would stop the whole backend. The failed job still rejects,
    // and readImageText() below turns that into "no text".
    errorHandler: () => {},
  });
  await worker.setParameters({
    preserve_interword_spaces: "1",
    debug_file: "/dev/null", // keep Tesseract's own messages out of the terminal
  });
  return worker;
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = startWorker();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Stop the OCR engine and free its memory. It restarts by itself when next needed. */
export async function shutdownOcr() {
  clearTimeout(idleTimer);
  const pending = workerPromise;
  workerPromise = null;
  if (pending) {
    const worker = await pending.catch(() => null);
    if (worker) await worker.terminate().catch(() => {});
  }
}

function scheduleIdleShutdown() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => shutdownOcr(), IDLE_SHUTDOWN_MS);
  idleTimer.unref();
}

/** One pass of the engine over the picture, in a given page-layout mode. Returns its lines of words. */
async function recognise(buffer, layoutMode) {
  const worker = await getWorker();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("OCR took too long")), RECOGNISE_TIMEOUT_MS);
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: layoutMode });
    const { data } = await Promise.race([worker.recognize(buffer, {}, { blocks: true }), timeout]);
    const lines = [];
    for (const block of data.blocks || []) for (const paragraph of block.paragraphs) for (const line of paragraph.lines) lines.push(line.words);
    return { lines, confidence: data.confidence };
  } catch (error) {
    await shutdownOcr(); // a stuck or broken engine is thrown away
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const digitsOf = (text) => text.replace(/\D/g, "");
const isDecimal = (text) => /^[<>]?\d+\.\d+$/.test(text);
const numberLike = (text) => /^[<>]?\d[\d.,:;]*$/.test(text);

/**
 * Two passes of the engine see the same picture slightly differently, and a
 * decimal point one pass drops ("25", "12:1") the other often keeps ("2.5",
 * "12.1"). Where the two disagree about a number that has the same digits,
 * the reading that is a proper decimal wins.
 */
function settleNumbers(lines, secondPass) {
  const others = secondPass.flat().filter((word) => isDecimal(word.text));
  if (others.length === 0) return;
  for (const line of lines) {
    for (const word of line) {
      if (!numberLike(word.text) || isDecimal(word.text)) continue;
      const a = word.bbox;
      const match = others.find((other) => {
        const b = other.bbox;
        const overlapX = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        return overlapX > 0.6 * Math.min(a.x1 - a.x0, b.x1 - b.x0) && overlapY > 0.5 * Math.min(a.y1 - a.y0, b.y1 - b.y0) && digitsOf(other.text) === digitsOf(word.text);
      });
      if (match) word.text = match.text;
    }
  }
}

/**
 * Put the words of a page back into rows using where they are on the page.
 *
 * The engine groups words into lines itself, but in a table it often reads
 * each column as a separate block, which tears "Haemoglobin 9.8 g/dL 12 - 15"
 * into four pieces far apart in the text. Here every word is placed by its
 * own position instead: the page's tilt is measured and removed, words at the
 * same height become one row, and a wide gap between two words becomes a
 * column break.
 */
function rowsFromWords(lines) {
  const words = [];
  const slopes = [];
  for (const line of lines) {
    // Marks the engine is unsure of are usually table borders, but an unsure
    // number or word is kept: losing "8.6" from a row is worse than a stray mark.
    const kept = line.filter((word) => /[A-Za-z0-9<>*–-]/.test(word.text) && (word.confidence >= 15 || /\d|[A-Za-z]{3}/.test(word.text)));
    for (const word of kept) {
      const { x0, y0, x1, y1 } = word.bbox;
      words.push({ text: word.text.replace(/^[|\[\]]+(?=[\dA-Za-z<>])/, ""), x0, x1, xc: (x0 + x1) / 2, yc: (y0 + y1) / 2, height: y1 - y0 });
    }
    // How much this line climbs or falls from its first word to its last.
    if (kept.length >= 3) {
      const first = kept[0].bbox;
      const last = kept[kept.length - 1].bbox;
      const run = (last.x0 + last.x1) / 2 - (first.x0 + first.x1) / 2;
      if (run > 150) slopes.push(((last.y0 + last.y1) / 2 - (first.y0 + first.y1) / 2) / run);
    }
  }
  if (words.length === 0) return "";

  const tilt = slopes.length ? median(slopes) : 0;
  const height = median(words.map((word) => word.height));
  const letterWidth = median(words.filter((word) => word.text.length >= 3).map((word) => (word.x1 - word.x0) / word.text.length)) || height / 2;
  for (const word of words) word.level = word.yc - tilt * word.xc; // height on the page once the tilt is removed
  words.sort((a, b) => a.level - b.level);

  const rows = [];
  for (const word of words) {
    const row = rows[rows.length - 1];
    if (row && word.level - row.level < height * 0.6) {
      row.words.push(word);
      row.level = row.words.reduce((sum, w) => sum + w.level, 0) / row.words.length;
    } else {
      rows.push({ level: word.level, words: [word] });
    }
  }
  return rows
    .map((row) => {
      row.words.sort((a, b) => a.x0 - b.x0);
      return row.words.map((word, i) => (i === 0 ? "" : word.x0 - row.words[i - 1].x1 > letterWidth * 2.5 ? "   " : " ") + word.text).join("");
    })
    .join("\n");
}

/** Remove the stray marks OCR leaves where a table had ruled lines. List bullets ("-", "*") are kept. */
function tidyLine(line) {
  return line
    .replace(/^[\s|\[\](){}=_~:;.,'"`]+(?=[A-Za-z0-9<>*-])/, "")
    .replace(/[\s|\[\]{}=_~]+$/, "")
    .replace(/\s*[|\[\]]\s*/g, "   ");
}

/**
 * Read the text in an image.
 * Returns { text, confidence } with confidence 0-100, or null if the picture
 * has no readable text (for example an X-ray film) or cannot be read at all.
 */
export function readImageText(buffer) {
  if (!looksLikeAnImage(buffer)) return Promise.resolve(null);
  const job = queue.then(async () => {
    try {
      // First pass: the page as columns of text. Second pass: every scrap of text on its own.
      const page = await recognise(buffer, "4");
      if (MODE !== "single") settleNumbers(page.lines, (await recognise(buffer, "11")).lines);
      const text = rowsFromWords(page.lines)
        .split("\n")
        .map(tidyLine)
        .filter((line) => /[A-Za-z0-9]{2}/.test(line))
        .join("\n");
      if (page.confidence < MIN_CONFIDENCE || text.replace(/\s/g, "").length < 30) return null;
      return { text, confidence: Math.round(page.confidence) };
    } catch {
      return null;
    } finally {
      scheduleIdleShutdown();
    }
  });
  queue = job.catch(() => {});
  return job;
}

export const ocrModelInfo = {
  name: "Reading photos and scans (OCR)",
  method: "Tesseract 5 LSTM text recognition, compiled to WebAssembly, with English language data stored on this computer",
  data: "180 pictures of synthetic documents, as clean scans and as tilted, blurred phone photos. The decimal-point checks were developed on these same pictures, so real photos will do worse. No real patient data was used.",
};
