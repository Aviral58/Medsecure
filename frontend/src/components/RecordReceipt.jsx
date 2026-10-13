import { formatBytes } from "../lib/format.js";
import { CopyValue } from "./Bits.jsx";
import Icon from "./Icon.jsx";

const READ_FROM = {
  pdf: "The summary was written from the text of the PDF.",
  text: "The summary was written from the text of the file.",
  ocr: "The file is a picture, so its text was read with OCR first. Numbers read from a picture can be wrong, and the summary says so.",
};

/**
 * What happened to a file that was just added, step by step, with the
 * identifiers that prove it: the IPFS address, the fingerprint and the
 * blockchain transaction.
 */
export default function RecordReceipt({ receipt, fileName, owner }) {
  return (
    <div className="receipt">
      <p className="receipt-title">
        <Icon name="check" />
        {receipt.recordType} stored{owner ? ` in ${owner}'s file` : ""}
      </p>
      <p className="receipt-file">
        {fileName}
        {receipt.size ? `, ${formatBytes(receipt.size)}` : ""}
      </p>

      <ol className="receipt-steps">
        <li>
          <strong>Encrypted</strong>
          <span>Locked with a new AES-256 key made for this one file. The key itself is locked with {owner ? `${owner}'s` : "your"} public key.</span>
        </li>
        <li>
          <strong>Stored on IPFS</strong>
          <span>Only the encrypted file is kept there. Its address is made from its contents.</span>
          <CopyValue value={receipt.cid} label="IPFS address" head={16} tail={10} />
        </li>
        <li>
          <strong>Fingerprint written to the blockchain</strong>
          <span>If the stored file is ever altered, its SHA-256 fingerprint will no longer match and it will not open.</span>
          <CopyValue value={receipt.fileHash} label="fingerprint" head={16} tail={10} />
          <span className="receipt-label">Transaction</span>
          <CopyValue value={receipt.txHash} label="transaction" head={16} tail={10} />
        </li>
        <li>
          <strong>{receipt.hasSummary ? "AI summary sealed inside" : "No AI summary"}</strong>
          <span>
            {receipt.hasSummary
              ? `${READ_FROM[receipt.readFrom] || "The summary was written from the file."} It is encrypted together with the file and is never stored anywhere else.`
              : receipt.readFrom === "scanned-pdf"
                ? "This PDF is a scan with no text layer, so there was nothing to summarise. Uploading the pages as pictures lets the AI read them."
                : "The file has too little readable text to summarise."}
          </span>
        </li>
      </ol>
    </div>
  );
}
