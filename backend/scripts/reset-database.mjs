// Drops the MedSecure database. Called by `npm run reset` in the project root.
import fs from "node:fs";
import mongoose from "mongoose";
import { config } from "../src/config.js";

try {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  fs.rmSync(new URL("../test/.last-smoke-run.json", import.meta.url), { force: true });
  console.log("Database dropped.");
} catch (error) {
  console.error("Could not reset the database: " + error.message);
  console.error("Is MongoDB running?");
  process.exit(1);
}
