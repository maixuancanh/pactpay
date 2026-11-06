require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
const { subtask } = require("hardhat/config");
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} = require("hardhat/builtin-tasks/task-names");
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(
  async ({ solcVersion }, hre, runSuper) => {
    if (solcVersion === "0.8.24")
      return {
        compilerPath: require.resolve("solc/soljson.js"),
        isSolcJs: true,
        version: "0.8.24",
        longVersion: "0.8.24+commit.e11b9ed9",
      };
    return runSuper();
  },
);
module.exports = {
  solidity: {
    compilers: [{
      version: "0.8.24",
      settings: { evmVersion: "paris", optimizer: { enabled: true, runs: 200 } },
    }],
    // Prefer lower deployment size for the escrow on the deposit-heavy V3 testnet.
    // Keep DemoUSD's original compiler settings and reuse its existing deployment.
    overrides: {
      "contracts/PactAccountCompact.sol": { version:"0.8.24", settings:{evmVersion:"paris",viaIR:true,optimizer:{enabled:true,runs:1},metadata:{appendCBOR:false}} },
      "contracts/PactPay.sol": {
        version: "0.8.24",
        settings: { evmVersion: "paris", optimizer: { enabled: true, runs: 1 } },
      },
      "contracts/PactPayNative.sol": {
        version: "0.8.24",
        settings: { evmVersion: "paris", optimizer: { enabled: true, runs: 1 } },
      },
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337, gas: 8000000 },
    portaldot: {
      url: "https://test-evm-rpc-v3.portaldot.dev",
      chainId: 420420777,
      accounts: process.env.PACTPAY_DEPLOY_KEY
        ? [process.env.PACTPAY_DEPLOY_KEY]
        : [],
    },
  },
};
