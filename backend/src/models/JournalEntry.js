import mongoose from "mongoose";

// The transaction journal: every signed transaction the backend has sent,
// in order. The local Hardhat chain keeps its state in memory, so after a
// restart the backend replays this journal to rebuild the exact same chain.
const journalSchema = new mongoose.Schema({
  seq: { type: Number, required: true, unique: true },
  hash: { type: String, required: true },
  raw: { type: String, required: true }, // signed transaction, hex
  label: { type: String, default: "" }, // human-readable description
  timestamp: { type: Number, default: null }, // block time once mined
});

export const JournalEntry = mongoose.model("JournalEntry", journalSchema);
