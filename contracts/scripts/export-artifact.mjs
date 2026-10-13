// Copies the compiled contract's ABI and bytecode into the backend,
// so the backend can deploy and talk to the contract without Hardhat.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "..", "artifacts", "contracts", "MedSecure.sol", "MedSecure.json");
const target = path.join(here, "..", "..", "backend", "src", "contract", "MedSecure.json");

const artifact = JSON.parse(fs.readFileSync(source, "utf8"));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(
  target,
  JSON.stringify({ contractName: artifact.contractName, abi: artifact.abi, bytecode: artifact.bytecode }, null, 2),
);
console.log(`Exported ABI and bytecode to ${path.relative(process.cwd(), target)}`);
