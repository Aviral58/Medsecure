import { isImage, readImageText } from "./ocr.js";

// Pull plain text out of an uploaded file so the AI features can read it.
// This happens in memory, inside the backend. Nothing is written to disk.
//
//   PDF with a text layer  -> the text is read directly
//   text file              -> used as it is
//   photo or scan (image)  -> OCR (see ocr.js)

const MAX_CHARACTERS = 20_000; // the first pages are enough

/**
 * Read a file. Returns { text, source, confidence } where source is
 *   "pdf" | "text"   the text was read exactly
 *   "ocr"            the text was read from a picture, and may contain misreads
 *   "scanned-pdf"    a PDF made of page images, which this version cannot read
 *   "none"           no readable text
 * `confidence` (0-100) is set for OCR only.
 */
export async function extractDocument(file) {
  const mimeType = String(file.mimetype || "").toLowerCase();
  const name = String(file.originalname || "").toLowerCase();

  if (mimeType === "application/pdf" || name.endsWith(".pdf")) {
    try {
      const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
      const { text } = await extractPdfText(pdf, { mergePages: true });
      const clean = String(text || "").slice(0, MAX_CHARACTERS);
      return clean.trim().length >= 20 ? { text: clean, source: "pdf" } : { text: "", source: "scanned-pdf" };
    } catch {
      return { text: "", source: "none" }; // damaged or password-protected PDF
    }
  }

  if (mimeType.startsWith("text/") || /\.(txt|csv|md)$/.test(name)) {
    return { text: file.buffer.toString("utf8").slice(0, MAX_CHARACTERS), source: "text" };
  }

  if (isImage(file)) {
    const read = await readImageText(file.buffer);
    if (read) return { text: read.text.slice(0, MAX_CHARACTERS), source: "ocr", confidence: read.confidence };
  }
  return { text: "", source: "none" };
}

/** Just the text of a file, or "" if it has none. */
export async function extractText(file) {
  return (await extractDocument(file)).text;
}
