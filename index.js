const express = require("express");
var fs = require("fs");
const https = require("https");
var cors = require("cors");
var bodyParser = require("body-parser");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { GENERATE_TYPES, VERIFY_TYPES, WALLET_TYPES, targetedNetworkId } = require("./constants");

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
const io = new Server(httpServer, {
    path: "/api/socket/",
    transports: ["websocket", "polling"],
});

io.on("connection", (socket) => {
    console.log("A user connected", socket.id);

    socket.on("execute", (data) => {
        console.log(`n-🔴 => socket.on => data:`, data);
        socket.emit("executed", { yo: "executed" });
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

app.post("/verify-auth", async (req, res) => {});

httpServer.listen(process.env.PORT || 4000);
