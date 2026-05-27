# Minimal TRON ERC-3009 Demo

This is ERC-3009 Proof of Concept token demo.
For technical details check https://eips.ethereum.org/EIPS/eip-3009

⚠️ Caution: This is by no means production-ready, proceed with caution and perform all necesary testing and audits before using in production.


## Configure your ERC3009 token

Make sure to modify the token name, token symbol and supply in 3009token.sol SC

## Compiling

To compile your contracts, use the following command:

```shell
tronbox compile contracts/TRC3009Token.sol
```



## Deploy Nile Testnet


Obtain test coin at https://nileex.io/join/getJoinPage

To deploy your contracts to Nile Testnet, you can run the following:

```shell
tronbox deploy --network nile
```


### Quick Start: Testing transferWithAuthorization

1. Prepare your PK, be extra careful with mainnet Private keys
```shell
cd sample-env .env
nano .env
```

1. Compile your contract
```shell
tronbox compile contracts/TRC3009Token.sol
```
2. Deploy your contract
```shell
tronbox deploy --network nile
```
3. Edit the erc3009 signature script per your deployed contract address, network, "to" address, etc
```shell
nano utils/erc3009_signature_script.js
```
4. Execute the script
```shell
node utils/erc3009_signature_script.js
```
Expected output should be similar to:

```js
{
  from: 'TJDMQzjJSh5eC8WezVtnDXDuWXAwjV23eF',
  to: 'TPxe5NN49YEGFNpDQZUXpViJ8B4c2BmL7f',
  value: '1000000000000000000',
  validAfter: 1779839907,
  validBefore: 1779843507,
  nonce: '0xa10bbd335660e9864d2bf69bd4bc3d09a154b93ac480946c0b673d938c5db80e',
  v: 27,
  r: '0xc031622e300e985d2e4159d188e4e890d5fc0f09ccae64e2bb4ea406b4df1849',
  s: '0x164bd21e436727ac6640d58ad5b4047097fff15c49d569a7a9f6ea852be4fd34'
}
```
5. Execute transferWithAuthorization function using the output from step 3

