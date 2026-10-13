import { getSigner } from "./accounts.js";
import { findEvent, getContract, sendContractTx } from "./chain.js";
import { decryptFile, encryptFile, generateFileKey, sha256Hex, wrapKey } from "./crypto.js";
import { addToIpfs, catFromIpfs } from "./ipfs.js";
import { buildSummary, issueSummaryTicket, readingMaterial } from "./summaries.js";

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * The upload pipeline:
 *   1. make a fresh AES key for this one file
 *   2. write the AI summary, then encrypt file and summary together, and hash the original
 *   3. store the encrypted file on IPFS -> CID
 *   4. wrap the AES key with the patient's public key
 *   5. write CID + hash + wrapped key to the blockchain, signed by the uploader
 */
export async function storeRecord({ uploader, patient, file, recordType }) {
  if (!file) throw httpError(400, "Choose a file to upload.");
  const type = String(recordType || "").trim();
  if (!type) throw httpError(400, "Choose a record type.");
  if (type.length > 60) throw httpError(400, "Record type is too long.");

  const contract = getContract();
  const onChainPatient = await contract.getUser(patient.address);
  if (Number(onChainPatient.role) !== 1) throw httpError(400, "That account is not a registered patient.");

  // Browsers send file names as UTF-8, but the upload parser reads them as latin1.
  const filename = Buffer.from(file.originalname || "record", "latin1").toString("utf8");

  // The summary is made from the plain file here, in memory, and then locked
  // inside the same encrypted envelope as the file. A failure to summarise
  // must never stop a record from being stored.
  const { summary, source, ocrText } = await buildSummary(file, type).catch(() => ({ summary: null, source: "none", ocrText: null }));

  const fileKey = generateFileKey();
  const envelope = encryptFile(fileKey, { data: file.buffer, filename, mimeType: file.mimetype, summary, text: ocrText });
  const fileHash = sha256Hex(file.buffer);
  const cid = await addToIpfs(envelope);
  const wrappedKey = wrapKey(onChainPatient.publicKey, fileKey);

  const receipt = await sendContractTx(
    getSigner(uploader),
    "addRecord",
    [patient.address, cid, fileHash, type, wrappedKey],
    `Add record (${type}) for ${patient.email}`,
  );
  const event = findEvent(receipt, "RecordAdded");

  return {
    recordId: Number(event.recordId),
    cid,
    fileHash,
    recordType: type,
    txHash: receipt.hash,
    hasSummary: Boolean(summary),
    summaryBy: summary ? summary.generatedBy : null,
    readFrom: source, // "pdf", "text", "ocr" (a picture), "scanned-pdf" or "none"
    size: file.buffer.length,
  };
}

/**
 * The retrieval pipeline, given an already-unwrapped AES key:
 *   1. fetch the encrypted file from IPFS by CID
 *   2. decrypt it
 *   3. hash the result and compare with the hash stored on-chain
 */
export async function openRecord({ record, fileKey }) {
  const envelope = await catFromIpfs(record.cid);
  let file;
  try {
    file = decryptFile(fileKey, envelope);
  } catch {
    throw httpError(409, "Integrity check failed: the stored file could not be decrypted. It may have been altered.");
  }
  if (sha256Hex(file.data) !== record.fileHash) {
    throw httpError(409, "Integrity check failed: the file does not match the hash recorded on the blockchain.");
  }
  return file;
}

/**
 * Send a decrypted file to the browser, with a one-time ticket the browser
 * can swap for the record's AI summary.
 */
export async function sendFile(res, file, user) {
  const encodedName = encodeURIComponent(file.filename || "record");
  const material = await readingMaterial(file).catch(() => ({ summary: null, text: "" }));
  res.set("X-Summary-Ticket", issueSummaryTicket(user, material));
  res.set({
    "Content-Type": file.mimeType || "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
    "X-File-Name": encodedName,
    "X-Integrity": "verified",
    "Cache-Control": "no-store",
  });
  res.send(file.data);
}

/** Load one record of a patient from the chain, or fail with 404. */
export async function loadRecord(patientAddress, recordId) {
  const contract = getContract();
  const id = Number(recordId);
  const count = Number(await contract.getRecordCount(patientAddress));
  if (!Number.isInteger(id) || id < 0 || id >= count) throw httpError(404, "Record not found.");
  return contract.getRecord(patientAddress, id);
}
