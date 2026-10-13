import mongoose from "mongoose";

// A hospital's public details. The hospital itself (its id, name and admin
// account) is registered in the smart contract; these contact and
// registration details are ordinary reference data, so they live here where
// they can be corrected when a phone number or address changes.
const hospitalSchema = new mongoose.Schema(
  {
    hospitalId: { type: Number, required: true, unique: true }, // id in the smart contract
    type: { type: String, default: "", trim: true }, // Government, Private, ...
    registrationNumber: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    pincode: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
  },
  { timestamps: true },
);

export const Hospital = mongoose.model("Hospital", hospitalSchema);

export const HOSPITAL_TYPES = ["Government", "Private", "Charitable trust", "Clinic or nursing home"];

const DETAIL_FIELDS = ["type", "registrationNumber", "address", "city", "state", "pincode", "phone", "email"];
const REQUIRED_FIELDS = ["type", "registrationNumber", "address", "city", "state", "phone"];

/** The details of one hospital document as a plain object (empty strings when missing). */
export function hospitalDetails(doc) {
  const details = {};
  for (const field of DETAIL_FIELDS) details[field] = doc?.[field] || "";
  details.complete = REQUIRED_FIELDS.every((field) => details[field]);
  return details;
}

/** Validate details sent by a form. Returns a clean object or throws a 400 error. */
export function parseHospitalDetails(body) {
  const bad = (message) => Object.assign(new Error(message), { status: 400 });
  const text = (field) => String(body?.[field] ?? "").trim();
  const details = Object.fromEntries(DETAIL_FIELDS.map((field) => [field, text(field)]));

  if (!HOSPITAL_TYPES.includes(details.type)) throw bad("Choose the type of hospital.");
  if (details.registrationNumber.length < 3) throw bad("Enter the hospital's registration number.");
  if (details.address.length < 5) throw bad("Enter the hospital's street address.");
  if (details.city.length < 2) throw bad("Enter the hospital's city.");
  if (details.state.length < 2) throw bad("Enter the hospital's state.");
  if (details.pincode && !/^[0-9]{6}$/.test(details.pincode)) throw bad("PIN code must be 6 digits.");
  if (!/^\+?[0-9][0-9 -]{6,16}$/.test(details.phone)) throw bad("Enter a valid phone number.");
  if (details.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) throw bad("Enter a valid hospital email address.");
  details.email = details.email.toLowerCase();
  return details;
}
