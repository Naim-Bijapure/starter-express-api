const targetedNetworkId = 11155111; // sepolia
// const targetedNetworkId = 31337; // hardhat
const targetedNetworkRpcURL = "https://rpc.sepolia.org";
// const targetedNetworkRpcURL = "https://api.zan.top/node/v1/eth/sepolia/public";
// const targetedNetworkRpcURL = "http://host.docker.internal:8547";

const WALLET_TYPES = {
    ACCOUNT: "account",
    CREATE_WALLET: "createWallet",
    EXECUTE: "Execute",
};

const GENERATE_TYPES = {
    register: "register",
    auth: "auth",
};
const VERIFY_TYPES = {
    register: "register",
    auth: "auth",
};

module.exports = {
    targetedNetworkId,
    targetedNetworkRpcURL,
    WALLET_TYPES,
    GENERATE_TYPES,
    VERIFY_TYPES,
};
