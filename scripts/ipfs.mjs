// Starts the project's own IPFS node (Kubo).
//
// - The node's data lives in ./data/ipfs, so stored records survive restarts
//   and stay separate from any other IPFS install on this computer.
// - It runs with --offline: it never connects to the public IPFS network, so
//   nothing stored here is announced or served to anyone else.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.join(root, "data", "ipfs");
const apiPort = process.env.IPFS_API_PORT || "5001";
const gatewayPort = process.env.IPFS_GATEWAY_PORT || "8090";

function findBinary() {
  if (process.env.IPFS_BIN) return process.env.IPFS_BIN;
  try {
    // The `kubo` npm package downloads the right binary for this computer
    // the first time it is needed.
    const require = createRequire(import.meta.url);
    return require("kubo").path();
  } catch (error) {
    console.error("[ipfs] Could not get the Kubo binary from the `kubo` npm package: " + error.message);
    console.error("[ipfs] Falling back to an `ipfs` command on your PATH.");
    return "ipfs";
  }
}

const binary = findBinary();
const env = { ...process.env, IPFS_PATH: repo };

function run(args) {
  const result = spawnSync(binary, args, { env, encoding: "utf8" });
  if (result.error) {
    console.error(`[ipfs] Could not run "${binary}": ${result.error.message}`);
    console.error("[ipfs] Install Kubo from https://docs.ipfs.tech/install/command-line/ or set IPFS_BIN to the ipfs executable.");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[ipfs] "ipfs ${args.join(" ")}" failed:\n${result.stderr || result.stdout}`);
    process.exit(1);
  }
  return result.stdout;
}

if (!fs.existsSync(path.join(repo, "config"))) {
  console.log("[ipfs] First run: creating the IPFS repository in data/ipfs ...");
  fs.mkdirSync(repo, { recursive: true });
  run(["init", "--empty-repo"]);
  run(["bootstrap", "rm", "--all"]);
}

// Bind only to this computer, on predictable ports.
run(["config", "Addresses.API", `/ip4/127.0.0.1/tcp/${apiPort}`]);
run(["config", "Addresses.Gateway", `/ip4/127.0.0.1/tcp/${gatewayPort}`]);

// This node is private and offline, so switch off everything that would
// look up or contact public IPFS infrastructure. These settings are
// optional: if a Kubo version does not know one of them, carry on.
for (const [key, value] of [
  ["AutoConf.Enabled", "false"],
  ["DNS.Resolvers", "{}"],
  ["Routing.DelegatedRouters", "[]"],
  ["Ipns.DelegatedPublishers", "[]"],
]) {
  spawnSync(binary, ["config", "--json", key, value], { env });
}

console.log(`[ipfs] Starting Kubo (offline, API on port ${apiPort}) ...`);
const daemon = spawn(binary, ["daemon", "--offline"], { env, stdio: "inherit" });

daemon.on("error", (error) => {
  console.error("[ipfs] Failed to start: " + error.message);
  process.exit(1);
});
daemon.on("exit", (code) => process.exit(code ?? 0));

if (process.platform === "win32") {
  // On Windows, Ctrl+C reaches the daemon directly and it shuts itself down
  // cleanly. Just stay alive until it has finished.
  process.on("SIGINT", () => {});
} else {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => daemon.kill(signal));
  }
}
