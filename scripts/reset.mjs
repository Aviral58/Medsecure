// Wipes ALL MedSecure data: the database (accounts and the transaction
// journal that rebuilds the blockchain) and the IPFS files.
//
//   npm run reset
//
// If the app is still running, in this or any other terminal, it is stopped
// first. Otherwise the old data would stay loaded in the running app and
// come straight back.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function answers(url, options) {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(1500), ...options });
  } catch {
    return null;
  }
}

// The four parts of the app, the port each one listens on, and a check that
// what answers on that port really is MedSecure and not some other program.
const PARTS = [
  { name: "backend", port: 5000, isUp: async () => Boolean(await answers("http://127.0.0.1:5000/api/health")) },
  { name: "blockchain", port: 8545, isUp: async () => Boolean(await answers("http://127.0.0.1:8545", { method: "POST", body: "{}" })) },
  { name: "IPFS node", port: 5001, isUp: async () => Boolean(await answers("http://127.0.0.1:5001/api/v0/version", { method: "POST" })) },
  {
    name: "website",
    port: 5173,
    isUp: async () => {
      const reply = await answers("http://localhost:5173");
      return Boolean(reply) && (await reply.text().catch(() => "")).includes("MedSecure");
    },
  },
];

async function partsRunning() {
  const running = [];
  for (const part of PARTS) if (await part.isUp()) running.push(part);
  return running;
}

/** The ids of the programs listening on a port. */
function listenersOn(port) {
  const ids = new Set();
  if (process.platform === "win32") {
    // A line looks like:  TCP    127.0.0.1:5000    0.0.0.0:0    LISTENING    1234
    const result = spawnSync("netstat", ["-ano"], { encoding: "utf8" });
    for (const line of String(result.stdout || "").split(/\r?\n/)) {
      const [protocol, local, , state, id] = line.trim().split(/\s+/);
      if (protocol === "TCP" && state === "LISTENING" && local.endsWith(`:${port}`)) ids.add(Number(id));
    }
  } else {
    const result = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    for (const id of String(result.stdout || "").split(/\s+/)) if (id) ids.add(Number(id));
  }
  // Ids up to 4 belong to Windows itself and are never touched.
  return [...ids].filter((id) => Number.isInteger(id) && id > 4 && id !== process.pid);
}

function stop(id) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(id), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(id, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
}

let running = await partsRunning();
if (running.length > 0) {
  console.log(`\nMedSecure is still running (${running.map((part) => part.name).join(", ")}). Stopping it...`);
  for (const part of running) for (const id of listenersOn(part.port)) stop(id);
  for (let attempt = 0; attempt < 20 && running.length > 0; attempt++) {
    await wait(500);
    running = await partsRunning();
  }
  if (running.length > 0) {
    console.error(`\nCould not stop: ${running.map((part) => part.name).join(", ")}.`);
    console.error("Close every terminal in VS Code (the bin icon on each one), or restart the computer, then run `npm run reset` again.\n");
    process.exit(1);
  }
  console.log("Stopped.");
  await wait(1500); // give the stopped programs a moment to let go of their files
}

console.log("Dropping the MedSecure database...");
const result = spawnSync("npm run reset", { cwd: path.join(root, "backend"), stdio: "inherit", shell: true });
if (result.status !== 0) process.exit(1);

console.log("Deleting IPFS files (data/ipfs)...");
try {
  fs.rmSync(path.join(root, "data", "ipfs"), { recursive: true, force: true, maxRetries: 10, retryDelay: 400 });
} catch (error) {
  console.error(`Could not delete data/ipfs: ${error.message}`);
  console.error("Close every terminal in VS Code, delete the data folder inside the project by hand, and run `npm run reset` again.\n");
  process.exit(1);
}

console.log("\nEverything is wiped: no hospitals, no doctors, no patients, no records.");
console.log("Run `npm start` to begin with an empty system. The only login is the network owner.\n");
