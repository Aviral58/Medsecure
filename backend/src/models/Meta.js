import mongoose from "mongoose";

// Small key-value store for app-level facts, e.g. the contract address.
const metaSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
});

export const Meta = mongoose.model("Meta", metaSchema);

export async function getMeta(key) {
  const doc = await Meta.findOne({ key });
  return doc ? doc.value : null;
}

export async function setMeta(key, value) {
  await Meta.updateOne({ key }, { $set: { value } }, { upsert: true });
}
