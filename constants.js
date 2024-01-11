// sepolia
// const targetedNetworkId = 11155111; // sepolia
// const targetedNetworkRpcURL = "https://rpc.sepolia.org";
// const targetedNetworkRpcURL = "https://ethereum-sepolia.publicnode.com";

// local
const targetedNetworkId = 31337;
const targetedNetworkRpcURL = "http://host.docker.internal:8547";

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
