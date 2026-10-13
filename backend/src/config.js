import "dotenv/config";

const env = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

export const config = {
  port: Number(env("PORT", "5000")),
  mongoUri: env("MONGO_URI", "mongodb://127.0.0.1:27017/medsecure"),
  rpcUrl: env("RPC_URL", "http://127.0.0.1:8545"),
  ipfsApiUrl: env("IPFS_API_URL", "http://127.0.0.1:5001"),
  jwtSecret: env("JWT_SECRET", "medsecure-local-development-secret"),
  ownerPrivateKey: env(
    "OWNER_PRIVATE_KEY",
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  ),
  ownerEmail: env("OWNER_EMAIL", "admin@medsecure.local").toLowerCase(),
  ownerPassword: env("OWNER_PASSWORD", "Admin@12345"),
  emergencyKeySeed: env("EMERGENCY_KEY_SEED", "medsecure-local-emergency-seed"),
  fundAmountEth: env("FUND_AMOUNT_ETH", "10"),

  // Security timeouts
  sessionIdleMinutes: Number(env("SESSION_IDLE_MINUTES", "15")), // logged out after this long without activity
  sessionMaxHours: Number(env("SESSION_MAX_HOURS", "8")), // logged out after this long no matter what
  loginMaxAttempts: Number(env("LOGIN_MAX_ATTEMPTS", "5")), // wrong passwords before the account locks
  loginLockMinutes: Number(env("LOGIN_LOCK_MINUTES", "15")), // how long it stays locked
  maxShareDays: 30, // must match MAX_GRANT_DURATION in the contract

  // Optional local language model (through Ollama) to reword AI summaries.
  // Leave AI_SUMMARY_MODEL empty to use the built-in summariser alone.
  aiSummaryModel: env("AI_SUMMARY_MODEL", ""),
  aiSummaryUrl: env("AI_SUMMARY_URL", "http://127.0.0.1:11434").replace(/\/$/, ""),
  aiSummaryTimeoutSeconds: Number(env("AI_SUMMARY_TIMEOUT_SECONDS", "120")),
  chainId: 31337,
  maxUploadBytes: 15 * 1024 * 1024,
};
