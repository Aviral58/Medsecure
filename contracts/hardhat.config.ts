import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    version: "0.8.28",
  },
  networks: {
    // The local chain that `npm run chain` starts.
    // The fixed start date matters: when the backend rebuilds the chain after
    // a restart, it replays every transaction with its original timestamp,
    // so the chain must begin before any of them.
    medsecure: {
      type: "edr-simulated",
      chainId: 31337,
      initialDate: "2025-01-01T00:00:00Z",
      // Without this, two blocks mined in the same second push the chain's
      // clock one second ahead of real time, and the drift adds up.
      allowBlocksWithSameTimestamp: true,
    },
  },
});
