import fs from "node:fs";
import { Contract, Interface, JsonRpcProvider, Transaction, Wallet, keccak256, parseEther, parseUnits } from "ethers";
import { config } from "../config.js";
import { JournalEntry } from "../models/JournalEntry.js";
import { setMeta } from "../models/Meta.js";

// ---------------------------------------------------------------------------
// How persistence works
// ---------------------------------------------------------------------------
//
// The Hardhat node keeps the chain in memory, so stopping it wipes the chain.
// To survive restarts, this service keeps a journal in MongoDB of every signed
// transaction it sends, together with the time of the block that included it.
//
// On startup (and whenever it notices the chain has been restarted) it checks
// whether the chain already contains the journal's last transaction. If not,
// and the chain is brand new, it replays the whole journal in order, giving
// each block its original timestamp. Because the transactions are the exact
// same signed bytes, the rebuilt chain has the same contract address, the same
// records and grants, the same expiry times and the same event history.
//
// This is the same idea a real blockchain node uses to sync: state is just the
// result of replaying the transaction log.

const artifact = JSON.parse(fs.readFileSync(new URL("../contract/MedSecure.json", import.meta.url), "utf8"));

export const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, {
  staticNetwork: true,
  batchMaxCount: 1,
  cacheTimeout: -1,
});

export const iface = new Interface(artifact.abi);
export const owner = new Wallet(config.ownerPrivateKey, provider);

// Generous fixed fees. Gas is paid in free test ETH, and a fixed fee keeps a
// transaction valid when it is replayed later.
const MAX_FEE = parseUnits("100", "gwei");
const PRIORITY_FEE = parseUnits("1", "gwei");

let contract = null;
let contractAddress = null;
let nextSeq = 1;
const blockTimeCache = new Map();

export function getContract() {
  if (!contract) throw httpError(503, "Blockchain is not ready yet");
  return contract;
}

export function getContractAddress() {
  return contractAddress;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Turn an ethers/RPC error into a clean message the API can return. */
function toChainError(error) {
  if (error?.status) return error;
  const code = error?.code;
  if (code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed|failed to detect network/i.test(String(error?.message))) {
    return httpError(503, "Blockchain node is not reachable. Is `npm run chain` running?");
  }
  // A revert with no message at all. The contract always gives a reason, so
  // this means the call never reached one of its functions.
  if (error?.reason === "require(false)" || /no data present/i.test(String(error?.shortMessage))) {
    return httpError(
      400,
      "The smart contract rejected this without a reason. The saved data probably belongs to an older version of the project: stop the app, run `npm run reset`, and start again.",
    );
  }
  const reason =
    error?.reason ||
    error?.revert?.args?.[0] ||
    error?.info?.error?.data?.message ||
    error?.info?.error?.message ||
    error?.shortMessage ||
    error?.message ||
    "Transaction failed";
  const clean = String(reason)
    .replace(/^.*reverted with reason string '(.*)'$/s, "$1")
    .replace(/^execution reverted:?\s*/i, "");
  return httpError(400, clean || "Transaction was rejected by the smart contract");
}

// ---------------------------------------------------------------------------
// One transaction at a time
// ---------------------------------------------------------------------------
//
// Every send goes through this queue, so the order of the journal always
// matches the order of the chain.

let queue = Promise.resolve();

function withLock(task) {
  const run = queue.then(() => task());
  queue = run.catch(() => {});
  return run;
}

async function waitForReceipt(hash) {
  for (let i = 0; i < 200; i++) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw httpError(504, "Transaction was sent but not mined in time");
}

/** Sign, journal, broadcast and confirm one transaction. Call only inside withLock. */
async function sendNow(wallet, tx, label) {
  const from = wallet.address;

  let gas;
  try {
    // Runs the call without sending it. A contract `require` failure shows up
    // here with its message, before anything is signed.
    gas = await provider.estimateGas({ ...tx, from });
  } catch (error) {
    throw toChainError(error);
  }

  const nonce = await provider.getTransactionCount(from, "latest");
  const raw = await wallet.signTransaction({
    type: 2,
    chainId: config.chainId,
    to: tx.to,
    data: tx.data,
    value: tx.value ?? 0n,
    nonce,
    gasLimit: (gas * 12n) / 10n + 10_000n,
    maxFeePerGas: MAX_FEE,
    maxPriorityFeePerGas: PRIORITY_FEE,
  });
  const hash = keccak256(raw);

  // Journal first, then broadcast: a crash can never leave a mined
  // transaction that the journal does not know about.
  const seq = nextSeq++;
  await JournalEntry.create({ seq, hash, raw, label });

  let receipt;
  try {
    await provider.send("eth_sendRawTransaction", [raw]);
    receipt = await waitForReceipt(hash);
  } catch (error) {
    receipt = await provider.getTransactionReceipt(hash).catch(() => null);
    if (!receipt) {
      await JournalEntry.deleteOne({ seq });
      nextSeq = seq;
      throw toChainError(error);
    }
  }

  const block = await provider.getBlock(receipt.blockNumber);
  await JournalEntry.updateOne({ seq }, { $set: { timestamp: block.timestamp } });

  if (receipt.status !== 1) throw httpError(400, "Transaction was reverted by the smart contract");
  return receipt;
}

/** Call a state-changing contract function, signed by `wallet`. */
export function sendContractTx(wallet, method, args, label) {
  return withLock(async () => {
    await resyncIfChainRestarted();
    const data = iface.encodeFunctionData(method, args);
    return sendNow(wallet, { to: contractAddress, data }, label || method);
  });
}

/** Give a new account some test ETH from the owner so it can pay gas. */
export function fundAccount(address, label) {
  return withLock(async () => {
    await resyncIfChainRestarted();
    return sendNow(owner, { to: address, value: parseEther(config.fundAmountEth) }, label || "Fund account");
  });
}

/** Find one event of the given name in a receipt and return its arguments. */
export function findEvent(receipt, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === eventName) return parsed.args;
    } catch {
      // not one of ours
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** All past events of one kind. `filterArgs` match the event's indexed fields. */
export async function queryEvents(eventName, filterArgs = []) {
  const c = getContract();
  try {
    return await c.queryFilter(c.filters[eventName](...filterArgs), 0, "latest");
  } catch (error) {
    throw toChainError(error);
  }
}

export async function blockTime(blockNumber) {
  if (!blockTimeCache.has(blockNumber)) {
    const block = await provider.getBlock(blockNumber);
    blockTimeCache.set(blockNumber, block.timestamp);
  }
  return blockTimeCache.get(blockNumber);
}

export async function chainStatus() {
  const [blockNumber, transactions] = await Promise.all([provider.getBlockNumber(), JournalEntry.countDocuments()]);
  return { blockNumber, transactions, contractAddress, chainId: config.chainId };
}

// ---------------------------------------------------------------------------
// Start-up and chain rebuild
// ---------------------------------------------------------------------------

async function waitForRpc(seconds = 90) {
  for (let i = 0; i < seconds; i++) {
    try {
      await provider.send("eth_chainId", []);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(
    "Could not reach the blockchain node at " + config.rpcUrl + ". Start it with `npm run chain` (or `npm start` from the project root).",
  );
}

async function attachContract(address) {
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error("No contract found at " + address);
  contractAddress = address;
  contract = new Contract(address, artifact.abi, provider);
  await setMeta("contractAddress", address);
}

/** Move the chain's clock to the real time, so new blocks carry real timestamps. */
async function syncClock() {
  const latest = await provider.getBlock("latest");
  const now = Math.floor(Date.now() / 1000);
  if (now > latest.timestamp) {
    await provider.send("evm_setNextBlockTimestamp", [now]);
    await provider.send("evm_mine", []);
  }
}

async function replayJournal(entries) {
  console.log(`[chain] Rebuilding the chain from ${entries.length} journaled transactions...`);
  for (const entry of entries) {
    if (entry.timestamp) {
      const latest = await provider.getBlock("latest");
      // Pin the block to its original time (blocks may share a timestamp).
      if (entry.timestamp >= latest.timestamp) {
        await provider.send("evm_setNextBlockTimestamp", [entry.timestamp]);
      }
    }
    try {
      await provider.send("eth_sendRawTransaction", [entry.raw]);
    } catch (error) {
      // A transaction that reverted originally also reverts now; that is fine
      // as long as it was mined. Anything else is a real problem.
      const mined = await provider.getTransactionReceipt(entry.hash).catch(() => null);
      if (!mined) {
        if (!entry.timestamp) {
          // Journaled but never confirmed (the app stopped mid-send). Drop it.
          await JournalEntry.deleteOne({ seq: entry.seq });
          continue;
        }
        throw new Error(`Replay failed at journal entry #${entry.seq} (${entry.label}): ${error?.message || error}`);
      }
    }
    const receipt = await waitForReceipt(entry.hash);
    if (!entry.timestamp) {
      const block = await provider.getBlock(receipt.blockNumber);
      await JournalEntry.updateOne({ seq: entry.seq }, { $set: { timestamp: block.timestamp } });
    }
  }
  console.log("[chain] Rebuild complete.");
}

/** Make the chain and the journal agree. Call only inside withLock (or at start-up). */
async function syncChainWithJournal() {
  blockTimeCache.clear();
  contract = null;

  const last = await JournalEntry.findOne().sort({ seq: -1 });
  nextSeq = last ? last.seq + 1 : 1;

  // The journal's first entry is the transaction that deployed the contract.
  // If it deployed different code from the contract this version ships with,
  // the saved data belongs to another version and cannot be used: the old
  // contract does not have the same functions.
  const deployment = await JournalEntry.findOne().sort({ seq: 1 });
  if (deployment) {
    const deployed = Transaction.from(deployment.raw);
    if (deployed.to === null && deployed.data !== artifact.bytecode) {
      throw new Error(
        "The saved data was created by a different version of the MedSecure smart contract, so this version cannot use it." +
          "\n  1. Stop the app (Ctrl+C)." +
          "\n  2. Run:  npm run reset" +
          "\n  3. Run:  npm start" +
          "\n  You will then need to add your hospitals and accounts again.",
      );
    }
  }

  // Fill in any entry whose confirmation we missed.
  for (const entry of await JournalEntry.find({ timestamp: null })) {
    const receipt = await provider.getTransactionReceipt(entry.hash);
    if (receipt) {
      const block = await provider.getBlock(receipt.blockNumber);
      await JournalEntry.updateOne({ seq: entry.seq }, { $set: { timestamp: block.timestamp } });
    }
  }

  const lastMined = await JournalEntry.findOne({ timestamp: { $ne: null } }).sort({ seq: -1 });
  if (lastMined && (await provider.getTransactionReceipt(lastMined.hash))) {
    // The running chain already has our history. Nothing to rebuild.
    await JournalEntry.deleteMany({ timestamp: null });
    const newest = await JournalEntry.findOne().sort({ seq: -1 });
    nextSeq = newest.seq + 1;
    const first = await JournalEntry.findOne().sort({ seq: 1 });
    const deployReceipt = await provider.getTransactionReceipt(first.hash);
    await attachContract(deployReceipt.contractAddress);
    console.log(`[chain] In sync. Contract at ${contractAddress}.`);
    return;
  }

  const ownerNonce = await provider.getTransactionCount(owner.address, "latest");
  if (ownerNonce > 0) {
    throw new Error(
      "The running blockchain holds data that does not match the database. " +
        "Stop everything, then start again with `npm start` so the chain begins fresh and is rebuilt from the database.",
    );
  }

  const entries = await JournalEntry.find().sort({ seq: 1 });
  if (entries.length > 0) {
    await replayJournal(entries);
    await syncClock();
    const first = await JournalEntry.findOne().sort({ seq: 1 });
    const deployReceipt = await provider.getTransactionReceipt(first.hash);
    await attachContract(deployReceipt.contractAddress);
    const newest = await JournalEntry.findOne().sort({ seq: -1 });
    nextSeq = newest.seq + 1;
    console.log(`[chain] Contract restored at ${contractAddress}.`);
    return;
  }

  // First ever run: deploy the contract.
  await syncClock();
  console.log("[chain] Fresh chain and empty journal. Deploying the MedSecure contract...");
  const receipt = await sendNow(owner, { data: artifact.bytecode }, "Deploy MedSecure contract");
  await attachContract(receipt.contractAddress);
  console.log(`[chain] Contract deployed at ${contractAddress}.`);
}

/** If someone restarted the chain while the backend kept running, rebuild it. */
async function resyncIfChainRestarted() {
  if (!contractAddress) return syncChainWithJournal();
  const code = await provider.getCode(contractAddress);
  if (code === "0x") {
    console.log("[chain] The chain was restarted. Rebuilding from the journal...");
    await syncChainWithJournal();
  }
}

export async function initChain() {
  await waitForRpc();
  await withLock(syncChainWithJournal);

  // Keep an eye on the chain so reads also recover after a chain restart.
  const watchdog = setInterval(() => {
    withLock(resyncIfChainRestarted).catch(() => {});
  }, 5000);
  watchdog.unref();
}
