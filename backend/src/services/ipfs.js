import { config } from "../config.js";

// Kubo (the IPFS node) exposes an HTTP API on port 5001. Every call is a POST.
// Only encrypted envelopes are ever sent here.

async function call(path, options = {}) {
  let response;
  try {
    response = await fetch(`${config.ipfsApiUrl}/api/v0/${path}`, { method: "POST", ...options });
  } catch {
    throw Object.assign(new Error("IPFS node is not reachable. Is `npm run ipfs` running?"), { status: 503 });
  }
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`IPFS error: ${text.slice(0, 200)}`), { status: 502 });
  }
  return response;
}

/** Store bytes on IPFS and pin them. Returns the content identifier (CID). */
export async function addToIpfs(buffer) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), "record.bin");
  const response = await call("add?pin=true&cid-version=1", { body: form });
  const result = await response.json();
  return result.Hash;
}

/** Fetch the bytes behind a CID. */
export async function catFromIpfs(cid) {
  const response = await call(`cat?arg=${encodeURIComponent(cid)}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function ipfsVersion() {
  const response = await call("version");
  return (await response.json()).Version;
}

/** Wait until the IPFS node answers, for up to `seconds`. */
export async function waitForIpfs(seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    try {
      return await ipfsVersion();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(
    "Could not reach the IPFS node at " + config.ipfsApiUrl + ". Start it with `npm run ipfs` (or `npm start` from the project root).",
  );
}
