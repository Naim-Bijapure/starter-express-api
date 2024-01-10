const express = require("express");
var fs = require("fs");
const https = require("https");
var cors = require("cors");
var bodyParser = require("body-parser");
const { createServer } = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const ethers = require("ethers");

const { GENERATE_TYPES, VERIFY_TYPES, WALLET_TYPES, targetedNetworkId, targetedNetworkRpcURL } = require("./constants");
const deployedContracts = require("./contract/deployedContracts");

const {
    GenerateAuthenticationOptionsOpts,
    GenerateRegistrationOptionsOpts,
    generateAuthenticationOptions,
    generateRegistrationOptions,
    VerifiedAuthenticationResponse,
    VerifiedRegistrationResponse,
    VerifyAuthenticationResponseOpts,
    VerifyRegistrationResponseOpts,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} = require("@simplewebauthn/server");

const app = express();
app.use(cors());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const httpServer = createServer(app);

const WalletToken = deployedContracts[targetedNetworkId].WalletToken;
const ERC6551Account = deployedContracts[targetedNetworkId].ERC6551Account;

const hash = crypto.createHash("sha256");
const provider = new ethers.providers.JsonRpcProvider(targetedNetworkRpcURL);

const userSessions = {
    // "01020304-0506-0708-0102-030405060708": [
    //     {
    //         userName: "N",
    //         pubKey: "pQECAyYgASFYIA-E9TVgSQXnywEldhUaqEGngMnCs0iXnsDH1coEoLIYIlgg-rlAJMl2f48Kvsz355rSmCBa0Tov2K9hBL1QAnCFllc",
    //     },
    // ],
};
const userWallets = {
    // N: [
    //     {
    //         pubKey: "pQECAyYgASFYIA-E9TVgSQXnywEldhUaqEGngMnCs0iXnsDH1coEoLIYIlgg-rlAJMl2f48Kvsz355rSmCBa0Tov2K9hBL1QAnCFllc",
    //         wallet: "0xC2ABf7A72a5282b009fa9F55E04E0026F96D7D07",
    //         tokenId: "2",
    //     },
    // ],
};

const getPrivateKey = (pubKey) => {
    const hash = crypto.createHash("sha256");
    hash.update(pubKey);
    const privateKey = hash.digest("hex");
    return privateKey;
};

// SOCKET IO
const io = new Server(httpServer, {
    path: "/api/socket/",
    transports: ["websocket", "polling"],
});

io.on("connection", (socket) => {
    console.log("A user connected", socket.id);
    // SOCKET ROUTES
    socket.on("getSessions", (data) => {
        const { aaguid } = data;
        socket.emit("setSessions", { sessions: userSessions[aaguid] });
    });

    socket.on("getWallets", (data) => {
        const { userName } = data;
        socket.emit("setWallets", { wallets: userWallets[userName] });
    });

    socket.on("getAccount", (data) => {
        const { userName, pubKey, aaguid } = data;
        const hash = crypto.createHash("sha256");
        hash.update(pubKey);
        const privateKey = hash.digest("hex");
        const signer = new ethers.Wallet(privateKey, provider);
        if (userSessions[aaguid]) {
            let userExists = userSessions[aaguid].find((user) => user.userName === userName);
            let newUserName = userName;
            if (userExists) {
                let suffix = 1;
                let userNameWithSuffix;
                do {
                    userNameWithSuffix = `${userName}-${suffix}`;
                    userExists = userSessions[aaguid].find((user) => user.userName === userNameWithSuffix);
                    suffix++;
                } while (userExists);
                newUserName = userNameWithSuffix;
            }
            userSessions[aaguid].push({ userName: newUserName, pubKey, address: signer.address });
        } else {
            userSessions[aaguid] = [{ userName: userName, pubKey, address: signer.address }];
        }
        socket.emit("setAccount", { address: signer.address });
    });

    socket.on("mintWallet", async (data) => {
        const { pubKey, userName, aaguid } = data;
        let publicKey = pubKey;
        try {
            let privateKey = getPrivateKey(publicKey);

            const signer = new ethers.Wallet(privateKey, provider);

            const balance = await signer.getBalance();
            if (balance.gt(0) === false) {
                return socket.emit("emptyBalance", { message: "empty balance" });
            }
            const walletToken = new ethers.Contract(WalletToken.address, WalletToken.abi, signer);
            let token = await walletToken.tokenID();
            token = token.toString();
            const hashKey = await walletToken.getTransactionHash(pubKey);
            const mintTx = await walletToken.mint(hashKey, { gasLimit: 1000000 });

            const network = await provider.getNetwork();
            const networkName = network.name === "homestead" ? "mainnet" : network.name;
            let blockUrl = `https://${networkName}.etherscan.io/tx/${mintTx.hash}`;
            socket.emit("setMinting", { blockUrl });

            const mintReceipt = await mintTx.wait();
            const boundWalletAddress = await walletToken.tokenBoundWalletAddress(token);

            blockUrl = `https://${networkName}.etherscan.io/tx/${mintReceipt.transactionHash}`;

            if (userWallets[userName]) {
                userWallets[userName].push({ pubKey, wallet: boundWalletAddress, tokenId: token });
            } else {
                userWallets[userName] = [{ pubKey, wallet: boundWalletAddress, tokenId: token }];
            }

            socket.emit("setMinted", { blockUrl });
        } catch (error) {}
    });

    socket.on("executeWallet", async (data) => {
        const { pubKey, userName, aaguid, tokenId, recipient, amount, callData } = data;
        try {
            // let publicKey = userWallets[userName].find((user) => user.userName === userName).pubKey;
            let publicKey = pubKey;

            let privateKey = getPrivateKey(publicKey);

            const signer = new ethers.Wallet(privateKey, provider);

            const balance = await signer.getBalance();
            if (balance.gt(0) === false) {
                return socket.emit("emptyBalance", { message: "empty balance" });
            }
            const walletToken = new ethers.Contract(WalletToken.address, WalletToken.abi, signer);
            const boundWalletAddress = await walletToken.tokenBoundWalletAddress(tokenId);
            const boundWallet = new ethers.Contract(boundWalletAddress, ERC6551Account.abi, signer);
            const boundWalletBalance = await provider.getBalance(boundWallet.address);

            const hashKey = await walletToken.getTransactionHash(pubKey);

            const network = await provider.getNetwork();
            const networkName = network.name === "homestead" ? "mainnet" : network.name;

            if (boundWalletBalance.gt(0) === false) {
                return socket.emit("emptyBalance", { message: "No fund in wallet" });
            }

            const executeTx = await boundWallet.execute(
                signer.address,
                ethers.utils.parseEther("" + parseFloat(amount).toFixed(12)),
                callData,
                hashKey,
                {
                    gasLimit: 99999,
                }
            );

            let blockUrl = `https://${networkName}.etherscan.io/tx/${executeTx.hash}`;
            socket.emit("setMinting", { blockUrl });

            const executeRcpt = await executeTx.wait();

            blockUrl = `https://${networkName}.etherscan.io/tx/${executeRcpt.transactionHash}`;

            socket.emit("setMinted", { blockUrl });
        } catch (error) {}
    });

    socket.on("disconnect", () => {
        console.log("A user disconnected");
    });
});

app.all("/", (req, res) => {
    // console.log("Just got a request");
    res.send("Yo!");
});

app.post("/generate-auth", async (req, res) => {
    const { type, rpID, userID, userName } = req.body;

    if (type === GENERATE_TYPES.register) {
        const opts = {
            rpName: "SimpleWebAuthn Example",
            rpID,
            userID,
            userName,
            timeout: 60000,
            attestationType: "none",
            authenticatorSelection: {
                residentKey: "required",
            },
            /**
             * Support the two most common algorithms: ES256, and RS256
             */
            supportedAlgorithmIDs: [-7, -257],
        };

        const options = await generateRegistrationOptions(opts);
        return res.status(200).json({ type: "register", options });
    }

    if (type === GENERATE_TYPES.auth) {
        const opts = {
            timeout: 60000,
            userVerification: "required",
            rpID,
        };

        const options = await generateAuthenticationOptions(opts);

        return res.status(200).json({ text: "auth", options });
    }
});

app.post("/verify-auth", async (req, res) => {
    const { type, rpID, authResponse, expectedChallenge, expectedOrigin, authenticator } = req.body;
    if (type === VERIFY_TYPES.register) {
        //   const expectedChallenge = req.session.currentChallenge;

        const opts = {
            response: authResponse,
            expectedChallenge: `${expectedChallenge}`,
            expectedOrigin,
            expectedRPID: rpID,
            requireUserVerification: true,
        };
        const verification = await verifyRegistrationResponse(opts);
        return res.status(200).json({ type: "register", verification });
    }

    if (type === VERIFY_TYPES.auth) {
        // const response: AuthenticationResponseJSON = authResponse;

        authenticator.credentialPublicKey = new Uint8Array(Object.values(authenticator.credentialPublicKey));
        authenticator.credentialID = new Uint8Array(Object.values(authenticator.credentialID));

        const opts = {
            response: authResponse,
            expectedChallenge: `${expectedChallenge}`,
            expectedOrigin,
            expectedRPID: rpID,
            authenticator,
            requireUserVerification: true,
        };
        const verification = await verifyAuthenticationResponse(opts);
        return res.status(200).json({ text: "auth", verification });
    }
});

app.post("/sign-in", async (req, res) => {
    const { userName, pubKey, aaguid } = req.body;
    const hash = crypto.createHash("sha256");
    hash.update(pubKey);
    const privateKey = hash.digest("hex");
    const signer = new ethers.Wallet(privateKey, provider);
    let currentUserName = userName;
    if (userSessions[aaguid]) {
        let userExists = userSessions[aaguid].find((user) => user.userName === userName);
        let newUserName = userName;
        if (userExists) {
            let suffix = 1;
            let userNameWithSuffix;
            do {
                userNameWithSuffix = `${userName}-${suffix}`;
                userExists = userSessions[aaguid].find((user) => user.userName === userNameWithSuffix);
                suffix++;
            } while (userExists);
            newUserName = userNameWithSuffix;
        }
        userSessions[aaguid].push({ userName: newUserName, pubKey, address: signer.address });
        currentUserName = newUserName;
    } else {
        userSessions[aaguid] = [{ userName: userName, pubKey, address: signer.address }];
        currentUserName = userName;
    }

    return res.status(200).json({ status: true, userName: currentUserName, address: signer.address });
});

app.post("/mint-wallet", async (req, res) => {
    console.log("minting wallet...");
    const { pubKey, userName, aaguid } = req.body;
    let publicKey = pubKey;
    try {
        let privateKey = getPrivateKey(publicKey);

        const signer = new ethers.Wallet(privateKey, provider);

        const balance = await signer.getBalance();
        if (balance.gt(0) === false) {
            return res.status(403).json({ status: false, msg: "no balance" });
        }
        const walletToken = new ethers.Contract(WalletToken.address, WalletToken.abi, signer);
        let token = await walletToken.tokenID();
        token = token.toString();
        const hashKey = await walletToken.getTransactionHash(pubKey);
        const mintTx = await walletToken.mint(hashKey, { gasLimit: 1000000 });

        const network = await provider.getNetwork();
        const networkName = network.name === "homestead" ? "mainnet" : network.name;
        let blockUrl = `https://${networkName}.etherscan.io/tx/${mintTx.hash}`;

        const mintReceipt = await mintTx.wait();
        const boundWalletAddress = await walletToken.tokenBoundWalletAddress(token);

        blockUrl = `https://${networkName}.etherscan.io/tx/${mintReceipt.transactionHash}`;

        if (userWallets[userName]) {
            userWallets[userName].push({ pubKey, wallet: boundWalletAddress, tokenId: token });
        } else {
            userWallets[userName] = [{ pubKey, wallet: boundWalletAddress, tokenId: token }];
        }

        console.log("minted wallet...");
        return res.status(200).json({ status: true, wallets: userWallets[userName], blockUrl });
    } catch (error) {
        console.log("tx error", error);
        return res.status(403).json({ status: false, msg: "error at backend" });
    }
});
app.post("/execute", async (req, res) => {
    const { pubKey, userName, aaguid, tokenId, recipient, amount, callData } = req.body;
    try {
        let publicKey = pubKey;

        let privateKey = getPrivateKey(publicKey);

        const signer = new ethers.Wallet(privateKey, provider);

        const balance = await signer.getBalance();
        if (balance.gt(0) === false) {
            return res.status(403).json({ status: false, msg: "no balance" });
        }
        const walletToken = new ethers.Contract(WalletToken.address, WalletToken.abi, signer);
        const boundWalletAddress = await walletToken.tokenBoundWalletAddress(tokenId);
        const boundWallet = new ethers.Contract(boundWalletAddress, ERC6551Account.abi, signer);
        const boundWalletBalance = await provider.getBalance(boundWallet.address);

        const hashKey = await walletToken.getTransactionHash(pubKey);

        const network = await provider.getNetwork();
        const networkName = network.name === "homestead" ? "mainnet" : network.name;

        if (boundWalletBalance.gt(0) === false) {
            return socket.emit("emptyBalance", { message: "No fund in wallet" });
        }

        const executeTx = await boundWallet.execute(
            signer.address,
            ethers.utils.parseEther("" + parseFloat(amount).toFixed(12)),
            callData,
            hashKey,
            {
                gasLimit: 99999,
            }
        );
        console.log("executing wallet tx...");

        let blockUrl = `https://${networkName}.etherscan.io/tx/${executeTx.hash}`;

        const executeRcpt = await executeTx.wait();

        blockUrl = `https://${networkName}.etherscan.io/tx/${executeRcpt.transactionHash}`;

        console.log("executed wallet tx...");
        return res.status(200).json({ status: true, blockUrl });
    } catch (error) {
        console.log("tx error", error);
        return res.status(403).json({ status: false, msg: "error at backend" });
    }
});

app.post("/sessions", async (req, res) => {
    const { aaguid } = req.body;
    return res.status(200).json({ status: true, sessions: userSessions[aaguid] });
});

app.post("/wallets", async (req, res) => {
    const { userName } = req.body;
    return res.status(200).json({ status: true, wallets: userWallets[userName] });
});

httpServer.listen(process.env.PORT || 4000);
