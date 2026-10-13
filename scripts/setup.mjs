// One-time setup: installs the dependencies of every part of the project
// and downloads the IPFS node. Run with `npm run setup`.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`\nMedSecure needs Node.js 22 or newer. You have ${process.versions.node}.`);
  console.error("Install the current LTS version from https://nodejs.org and run `npm run setup` again.\n");
  process.exit(1);
}

const parts = [
  ["project tools (IPFS node, process runner)", "."],
  ["smart contracts (Hardhat)", "contracts"],
  ["backend (Express API)", "backend"],
  ["frontend (React app)", "frontend"],
];

for (const [label, folder] of parts) {
  console.log(`\n=== Installing ${label} ===`);
  const result = spawnSync("npm install", { cwd: path.join(root, folder), stdio: "inherit", shell: true });
  if (result.status !== 0) {
    console.error(`\nInstalling ${label} failed. Fix the error above and run \`npm run setup\` again.`);
    process.exit(1);
  }
}

console.log("\n=== Downloading the IPFS node (Kubo) ===");
try {
  const require = createRequire(path.join(root, "package.json"));
  console.log("IPFS binary: " + require("kubo").path());
} catch (error) {
  console.error("Could not download Kubo automatically: " + error.message);
  console.error("You can install it yourself from https://docs.ipfs.tech/install/command-line/ and it will be picked up from your PATH.");
}

console.log("\nSetup complete.");
console.log("Make sure MongoDB is running, then start everything with:  npm start");
console.log("and open http://localhost:5173 in your browser.\n");
