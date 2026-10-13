import crypto from "node:crypto";
import { decrypt as eciesDecrypt, encrypt as eciesEncrypt } from "eciesjs";
import { SigningKey } from "ethers";
import { config } from "../config.js";

// ---------------------------------------------------------------------------
// File encryption (AES-256-GCM)
// ---------------------------------------------------------------------------
//
// What gets stored on IPFS is one "envelope":
//
//   MSEC1 | iv (12 bytes) | auth tag (16 bytes) | ciphertext
//
// and the ciphertext decrypts to:
//
//   header length (4 bytes) | header JSON { filename, mimeType, summary, text } | file bytes
//
// Putting the file name inside the encrypted part means IPFS and the
// blockchain never see it. The AI summary travels in the same place: it is
// locked with the record's own key, so exactly the people who can open the
// record can read its summary, and nobody else. For a photo or scan, the
// text that OCR read from it is kept there too, so the picture does not have
// to be read again every time the record is opened.

const MAGIC = Buffer.from("MSEC1");

export function generateFileKey() {
  return crypto.randomBytes(32);
}

export function encryptFile(fileKey, { data, filename, mimeType, summary = null, text = null }) {
  const header = Buffer.from(JSON.stringify({ filename, mimeType, summary, text }), "utf8");
  const headerLength = Buffer.alloc(4);
  headerLength.writeUInt32BE(header.length);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", fileKey, iv);
  const ciphertext = Buffer.concat([cipher.update(headerLength), cipher.update(header), cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([MAGIC, iv, tag, ciphertext]);
}

export function decryptFile(fileKey, envelope) {
  if (envelope.length < MAGIC.length + 28 || !envelope.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Stored file is not a MedSecure envelope");
  }
  const iv = envelope.subarray(5, 17);
  const tag = envelope.subarray(17, 33);
  const ciphertext = envelope.subarray(33);

  const decipher = crypto.createDecipheriv("aes-256-gcm", fileKey, iv);
  decipher.setAuthTag(tag);
  // GCM throws here if even one bit of the stored file was changed.
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const headerLength = plain.readUInt32BE(0);
  const header = JSON.parse(plain.subarray(4, 4 + headerLength).toString("utf8"));
  return {
    filename: header.filename,
    mimeType: header.mimeType,
    summary: header.summary || null,
    text: header.text || null,
    data: plain.subarray(4 + headerLength),
  };
}

/** SHA-256 of the original file, as a 0x-prefixed hex string (bytes32 on-chain). */
export function sha256Hex(data) {
  return "0x" + crypto.createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Key wrapping (ECIES on secp256k1)
// ---------------------------------------------------------------------------
//
// A file key is never stored in the clear. It is "wrapped" (encrypted) with
// the public key of whoever should be able to read the file, and only that
// person's private key can unwrap it.

export function wrapKey(recipientPublicKeyHex, fileKey) {
  return "0x" + Buffer.from(eciesEncrypt(recipientPublicKeyHex, fileKey)).toString("hex");
}

export function unwrapKey(privateKeyHex, wrappedHex) {
  const wrapped = Buffer.from(wrappedHex.replace(/^0x/, ""), "hex");
  return Buffer.from(eciesDecrypt(privateKeyHex, wrapped));
}

// ---------------------------------------------------------------------------
// Emergency key
// ---------------------------------------------------------------------------
//
// One key pair held by the backend for break-glass access. A patient's
// critical summary key is additionally wrapped with this public key, and the
// backend only unwraps it for a doctor the contract says has an open
// emergency window.

const emergencyPrivateKey = "0x" + crypto.createHash("sha256").update(config.emergencyKeySeed).digest("hex");

export const emergencyKeys = {
  privateKey: emergencyPrivateKey,
  publicKey: new SigningKey(emergencyPrivateKey).compressedPublicKey,
};

// ---------------------------------------------------------------------------
// Keystore: a user's private key locked with their password
// ---------------------------------------------------------------------------

export function lockPrivateKey(privateKeyHex, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(privateKeyHex.replace(/^0x/, ""), "hex")), cipher.final()]);
  return {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
}

export function unlockPrivateKey(keystore, password) {
  const key = crypto.scryptSync(password, Buffer.from(keystore.salt, "hex"), 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(keystore.iv, "hex"));
  decipher.setAuthTag(Buffer.from(keystore.tag, "hex"));
  const plain = Buffer.concat([decipher.update(Buffer.from(keystore.data, "hex")), decipher.final()]);
  return "0x" + plain.toString("hex");
}
