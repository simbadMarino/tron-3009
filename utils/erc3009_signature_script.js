import { TronWeb } from 'tronweb'
import crypto from "crypto"; // for nonce generation
import 'dotenv/config'

// ---------- SETUP ----------
const tronWeb = new TronWeb({
    fullHost: "https://nile.trongrid.io",
    privateKey: process.env.PRIVATE_KEY_NILE // user signing key
});

// Example values
const from = tronWeb.defaultAddress.base58;
const to = "TPxe5NN49YEGFNpDQZUXpViJ8B4c2BmL7f";    //Choose any "to" address to test
const value = "1000000000000000000";         // 1 token with 6 decimals
const validAfter = Math.floor(Date.now() / 1000);            // now
const validBefore = Math.floor(Date.now() / 1000) + 3600;     // +1h
// generate 32 random bytes
const randomBytes = crypto.randomBytes(32);
const nonce = "0x" + randomBytes.toString("hex");
// ---------- DOMAIN ----------
// EIP‑712 domain struct must match your contract ‑ usually:
// keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
// Select the specific chainId depending on the network. https://chainlist.org/?testnets=true&search=TRON

const domain = {
    name: "TR3009 Token",       //Your token name here
    version: "1",
    chainId: 0xcd8690dc,        // TRON Nile testnet
    // chainId: 0x2b6653dc,        //TRON Mainnet
    //chainId: 0x94a9059e,        //TRON Shasta testnet                      
    verifyingContract: "TJSmpBinnjBfzhuJb2sdFzXbodhiLCC1YX"     //Your ERC3009 token address after deployment here
};

const types = {
    TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
    ]
};

const message = {
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce
};

// ---------- SIGNATURE ----------
async function createAuthorizationSignature() {
    // TronWeb signs typed data via trx.signTypedData

    const signature = await tronWeb.trx.signTypedData(domain, types, message);
    console.log("RAW signature:", signature);

    // signature will be 65 bytes; split into {r, s, v}
    const sig = Buffer.from(signature.replace(/^0x/, ""), "hex");
    const r = "0x" + sig.slice(0, 32).toString("hex");
    const s = "0x" + sig.slice(32, 64).toString("hex");
    const v = sig[64];

    console.log("r:", r);
    console.log("s:", s);
    console.log("v:", v);

    return { r, s, v };
}

createAuthorizationSignature()
    .then(({ r, s, v }) => {
        console.log("Ready to call transferWithAuthorization with:");
        console.log({ from, to, value, validAfter, validBefore, nonce, v, r, s });
    })
    .catch(console.error);