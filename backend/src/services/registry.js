import { Hospital, hospitalDetails } from "../models/Hospital.js";
import { User } from "../models/User.js";
import { getContract } from "./chain.js";

// Helpers that combine on-chain facts with the names stored in MongoDB.

/**
 * All hospitals registered on-chain, joined with their details from MongoDB:
 * [{ id, name, label, admin, type, registrationNumber, address, city, state,
 *    pincode, phone, email, complete }]. `label` is "Name, City".
 */
export async function listHospitals() {
  const contract = getContract();
  const [count, docs] = await Promise.all([contract.hospitalCount(), Hospital.find()]);
  const byId = new Map(docs.map((doc) => [doc.hospitalId, doc]));
  const hospitals = [];
  for (let id = 1; id <= Number(count); id++) {
    const hospital = await contract.getHospital(id);
    const details = hospitalDetails(byId.get(id));
    hospitals.push({
      id,
      name: hospital.name,
      label: details.city ? `${hospital.name}, ${details.city}` : hospital.name,
      admin: hospital.admin,
      ...details,
    });
  }
  return hospitals;
}

/** What anyone on the network may see about a hospital (no admin account). */
export function publicHospital({ admin, ...hospital }) {
  return hospital;
}

/** "Name, City" for one hospital id, or "" if there is no such hospital. */
export async function hospitalLabel(hospitalId) {
  const hospital = (await listHospitals()).find((h) => h.id === Number(hospitalId));
  return hospital ? hospital.label : "";
}

/**
 * A lookup from blockchain address to a display label, used to turn the raw
 * addresses found in events into names.
 */
export async function buildDirectory() {
  const [users, hospitals] = await Promise.all([User.find({}, "name email role address hospitalId"), listHospitals()]);
  const hospitalNames = new Map(hospitals.map((h) => [h.id, h.label]));
  const byAddress = new Map();
  for (const user of users) {
    byAddress.set(user.address.toLowerCase(), {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      address: user.address,
      hospitalId: user.hospitalId || 0,
      hospitalName: hospitalNames.get(user.hospitalId) || "",
    });
  }
  return {
    hospitalNames,
    lookup(address) {
      return (
        byAddress.get(String(address).toLowerCase()) || {
          id: "",
          name: "Unknown account",
          email: "",
          role: "",
          address: String(address),
          hospitalId: 0,
          hospitalName: "",
        }
      );
    },
  };
}

/** Plain-object view of one on-chain record. */
export function formatRecord(record, id) {
  return {
    id,
    cid: record.cid,
    fileHash: record.fileHash,
    recordType: record.recordType,
    uploader: record.uploader,
    timestamp: Number(record.timestamp),
  };
}
