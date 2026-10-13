import mongoose from "mongoose";

// One document per person. The blockchain private key is stored only in
// encrypted form (keystore), locked with a key derived from the password.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, enum: ["owner", "hospitalAdmin", "doctor", "patient"] },
    address: { type: String, required: true, unique: true }, // blockchain address
    publicKey: { type: String, default: "" }, // compressed secp256k1 key, hex
    hospitalId: { type: Number, default: 0 },
    keystore: {
      salt: String,
      iv: String,
      tag: String,
      data: String,
    },
  },
  { timestamps: true },
);

export const User = mongoose.model("User", userSchema);
