import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { config } from "./config.js";
import { adminRouter } from "./routes/admin.js";
import { aiRouter } from "./routes/ai.js";
import { authRouter } from "./routes/auth.js";
import { doctorRouter } from "./routes/doctor.js";
import { hospitalRouter } from "./routes/hospital.js";
import { patientRouter } from "./routes/patient.js";
import { ensureOwnerAccount } from "./services/accounts.js";
import { getContractAddress, initChain } from "./services/chain.js";
import { waitForIpfs } from "./services/ipfs.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Response headers for every API reply:
// - never let a browser or proxy keep a copy of patient data,
// - never let a reply be reinterpreted as a different file type,
// - expose the two headers the browser reads when it opens a record.
app.use((req, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Access-Control-Expose-Headers": "X-File-Name, X-Integrity, X-Summary-Ticket",
  });
  next();
});

app.get("/api/health", (req, res) => res.json({ ok: true, contractAddress: getContractAddress() }));
app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/hospital", hospitalRouter);
app.use("/api/patient", patientRouter);
app.use("/api/doctor", doctorRouter);
app.use("/api/ai", aiRouter);

app.use("/api", (req, res) => res.status(404).json({ error: "Unknown API route." }));

// One place that turns any thrown error into a JSON response.
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "File is too large. The limit is 15 MB." : "Upload failed.";
    return res.status(413).json({ error: message });
  }
  const status = error.status || 500;
  if (status >= 500) console.error("[api]", error);
  res.status(status).json({
    error: status >= 500 && !error.status ? "Something went wrong on the server." : error.message,
    code: error.code,
  });
});

async function connectDatabase() {
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 2000 });
      return;
    } catch {
      if (attempt === 1) console.log("[db] Waiting for MongoDB at " + config.mongoUri + " ...");
    }
  }
  throw new Error(
    "Could not connect to MongoDB at " +
      config.mongoUri +
      ".\n  Install MongoDB Community Server and make sure the MongoDB service is running" +
      "\n  (Windows: open Services, find 'MongoDB Server', click Start).",
  );
}

async function start() {
  await connectDatabase();
  console.log("[db] Connected to MongoDB.");

  const ipfs = await waitForIpfs();
  console.log(`[ipfs] Connected to IPFS node (Kubo ${ipfs}).`);

  await initChain();
  await ensureOwnerAccount();

  app.listen(config.port, "127.0.0.1", () => {
    console.log(`[api] MedSecure backend ready at http://127.0.0.1:${config.port}`);
    console.log(`[api] Network owner login: ${config.ownerEmail} / ${config.ownerPassword}`);
  });
}

start().catch((error) => {
  console.error("\n[startup] " + error.message + "\n");
  process.exit(1);
});
