const MyTRC3009Token = artifacts.require('MyTRC3009Token');

// Happy-path tests for contracts/TRC3009Token_OZ.sol (MyTRC3009Token).
//
// Run against the TronBox Runtime Environment (see tronbox-config.js "development"):
//    Pull the latest available tronbox/tre container (this test suite requires >v2.0.0) from  https://hub.docker.com/r/tronbox/tre
//   docker run -it -p 9090:9090 --rm --name tron tronbox/tre
//   npx tronbox test --network development
// 
// Run against Nile (needs PRIVATE_KEY_NILE in .env, funded with test TRX; deploys a fresh token):
//   npx tronbox test --network nile
//
// The suite detects which kind of network it is on (local TRE vs. a public network such as Nile):
//   - local TRE: blocks are mined instantly and accounts[1] exists, so calls are not awaited for confirmation.
//   - public network: blocks take ~3s, so every sent transaction is awaited before reading state, and only
//     accounts[0] exists, so the recipient is a generated address.
//
// The authorizer is a freshly generated key that never sends a transaction (it only signs),
// so it needs no TRX. The default account (accounts[0], the token owner) acts as the relayer.

contract('MyTRC3009Token', accounts => {
  const owner = accounts[0];  //Development network
  // TRE runs on localhost; anything else (Nile, Shasta, ...) is a public network with ~3s blocks.
  const IS_LOCAL = /127\.0\.0\.1|localhost/.test(String(tronWeb.fullNode.host));
  // A public network only exposes the single account behind the configured private key.
  const recipient = IS_LOCAL ? accounts[1] : require('tronweb').TronWeb.createRandom().address;
  const MINT_AMOUNT = '1000000000000000000000'; // 1000 tokens (18 decimals)
  const VALUE = '1000000000000000000'; // 1 token
  const FAR_FUTURE = 2 ** 40; // below the 2^47 block-range flag, so the timestamp clock is used

  const TYPES = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ],
    ReceiveWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' }
    ],
    CancelAuthorization: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' }
    ]
  };

  // Verbatim log lines, indented under mocha's test titles. Every transaction id is logged so any step can be
  // looked up in the node / explorer (on a public network the explorer link is printed too).
  const log = (...args) => console.log('        ', ...args);
  const txLink = txid => (IS_LOCAL ? '' : `  https://${NETWORK_NAME}.tronscan.org/#/transaction/${txid}`);
  const NETWORK_NAME = IS_LOCAL ? 'local' : /nile/i.test(String(tronWeb.fullNode.host)) ? 'nile'
    : /shasta/i.test(String(tronWeb.fullNode.host)) ? 'shasta' : 'mainnet';

  let token;
  let domain;
  let signer; // { address: { base58 }, privateKey }

  const randomNonce = () => '0x' + require('crypto').randomBytes(32).toString('hex');

  const splitSignature = signature => {
    const sig = signature.replace(/^0x/, '');
    return {
      r: '0x' + sig.slice(0, 64),
      s: '0x' + sig.slice(64, 128),
      v: parseInt(sig.slice(128, 130), 16)
    };
  };

  // TronWeb's typed-data encoder needs exactly one struct type, so only pass the one being signed.
  const sign = async (typeName, message) => {
    const types = { [typeName]: TYPES[typeName] };
    const signature = await tronWeb.trx.signTypedData(domain, types, message, signer.privateKey);
    return splitSignature(signature);
  };

  const authorization = (to, overrides = {}) => ({
    from: signer.address.base58,
    to,
    value: VALUE,
    validAfter: 0,
    validBefore: FAR_FUTURE,
    nonce: randomNonce(),
    ...overrides
  });

  const balanceOf = async account => (await token.balanceOf(account)).toString();

  // Polls until the transaction is in a block (returns its info, which may show a revert). Uses the
  // full-node (unconfirmed) lookup: trx.getTransactionInfo queries the solidity node, which only reports a
  // transaction once its block is solidified (~19 blocks, i.e. a minute on Nile). Reads like balanceOf also
  // run against the full node's latest block, so waiting for inclusion is enough. Results are cached so
  // waiting on the same txid twice (send() and then expectRevert()) costs nothing.
  const txInfoCache = new Map();
  const waitForTx = async txid => {
    if (txInfoCache.has(txid)) return txInfoCache.get(txid);
    const intervalMs = IS_LOCAL ? 500 : 1000;
    const maxWaitMs = IS_LOCAL ? 30000 : 60000;
    let info = {};
    for (let waited = 0; !info.id && waited < maxWaitMs; waited += intervalMs) {
      info = await tronWeb.trx.getUnconfirmedTransactionInfo(txid);
      if (!info.id) await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    if (info.id) txInfoCache.set(txid, info);
    return info;
  };

  // Sends a state-changing call. On a public network the call only returns the txid once broadcast, so wait
  // for the block before the test reads state; on TRE blocks are instant and no wait is needed.
  const send = async (txPromise, label = 'transaction') => {
    const txid = await txPromise;
    log(`[tx] ${label} txid: ${txid}${txLink(txid)}`);
    if (!IS_LOCAL) {
      const info = await waitForTx(txid);
      log(`     block: ${info.blockNumber}  result: ${info.result || (info.receipt && info.receipt.result) || 'SUCCESS'}  energy: ${info.receipt && info.receipt.energy_usage_total}  fee(sun): ${info.fee}`);
    }
    return txid;
  };

  // TronBox resolves a state-changing call with the txid even when the transaction reverts, so wait for
  // the receipt and check it failed with the expected custom error (matched by its 4-byte selector).
  const expectRevert = async (txPromise, errorSignature) => {
    let txid;
    try {
      txid = await txPromise;
    } catch (err) {
      // Some failures are rejected up front (e.g. during energy estimation); that is a revert too.
      log(`[revert] rejected before broadcast (expected ${errorSignature}): ${err.message || err}`);
      return err;
    }

    const info = await waitForTx(txid);

    assert.ok(info.id, `transaction ${txid} was not found after waiting (is it confirmed on this network?)`);
    // Failed transactions report `result: 'FAILED'`; the receipt carries the reason (REVERT, OUT_OF_ENERGY, ...).
    const failed = info.result === 'FAILED' || (info.receipt && info.receipt.result && info.receipt.result !== 'SUCCESS');
    assert.ok(failed, `expected the transaction to revert, got: ${JSON.stringify(info)}`);
    const selector = tronWeb.sha3(errorSignature).slice(2, 10); // sha3 returns 0x-prefixed keccak256
    log(`[revert] txid: ${txid}`);
    log(`     result: ${info.result}  receipt: ${info.receipt && info.receipt.result}  block: ${info.blockNumber}`);
    log(`     expected: ${errorSignature} (selector 0x${selector})`);
    log(`     contractResult: ${info.contractResult && info.contractResult[0]}`);
    assert.ok(
      (info.contractResult[0] || '').startsWith(selector),
      `expected revert with ${errorSignature}, got ${info.contractResult[0]}`
    );
    return info;
  };

  const transfer = (a, { v, r, s }) =>
    send(
      token.transferWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s),
      'transferWithAuthorization'
    );

  const receive = (a, { v, r, s }) =>
    send(
      token.receiveWithAuthorization(a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, v, r, s),
      'receiveWithAuthorization'
    );

  const cancel = (authorizer, nonce, { v, r, s }) =>
    send(token.cancelAuthorization(authorizer, nonce, v, r, s), 'cancelAuthorization');

  const mint = (to, amount) => send(token.mint(to, amount), 'mint');

  before(async () => {
    token = await MyTRC3009Token.deployed();
    signer = await require('tronweb').TronWeb.createAccount();

    // Read the domain from the contract so the chainId always matches the network under test.
    const eip712 = await token.eip712Domain();
    domain = {
      name: eip712.name,
      version: eip712.version,
      chainId: eip712.chainId.toString(),
      verifyingContract: token.address
    };

    // ---- deployment / environment info ----
    const hex = address => tronWeb.address.toHex(address);
    log('================ TEST ENVIRONMENT ================');
    log(`network:           ${NETWORK_NAME} (${IS_LOCAL ? 'local TRE' : 'public'}), node ${tronWeb.fullNode.host}`);
    log(`contract:          MyTRC3009Token`);
    log(`address (base58):  ${tronWeb.address.fromHex(token.address)}`);
    log(`address (hex):     ${hex(token.address)}`);
    try {
      const deployment = MyTRC3009Token.networks && MyTRC3009Token.networks[MyTRC3009Token.network_id];
      if (deployment && deployment.transactionHash) {
        log(`deploy txid:       ${deployment.transactionHash}${txLink(deployment.transactionHash)}`);
      }
    } catch (err) {
      log(`deploy txid:       unavailable (${err.message})`);
    }
    try {
      const onChain = await tronWeb.trx.getContract(token.address);
      log(`origin (deployer): ${tronWeb.address.fromHex(onChain.origin_address)}`);
      log(`energy limit pct:  ${onChain.origin_energy_limit}  user fee pct: ${onChain.consume_user_resource_percent}`);
    } catch (err) {
      log(`on-chain contract info unavailable (${err.message})`);
    }
    log(`owner():           ${tronWeb.address.fromHex(await token.owner())}`);
    log(`symbol / decimals: ${await token.symbol()} / ${(await token.decimals()).toString()}`);
    log(`totalSupply():     ${(await token.totalSupply()).toString()}`);
    log(`eip712 domain:     ${JSON.stringify({ ...domain, verifyingContract: tronWeb.address.fromHex(domain.verifyingContract) })}`);
    log(`relayer / owner:   ${owner}  (hex ${hex(owner)})`);
    log(`recipient:         ${recipient}`);
    log(`authorizer (signer, generated): ${signer.address.base58}  (hex ${hex(signer.address.base58)})`);
    log('==================================================');

    // Fund the authorizer once for the whole suite (each mint costs a block wait on a public network).
    await mint(signer.address.base58, MINT_AMOUNT);
    log(`authorizer balance after funding: ${await balanceOf(signer.address.base58)}`);
  });

  beforeEach(function () {
    // Mocha prints a test's title only once it finishes, so mark where each one starts.
    console.log(`\n      ▶ ${this.currentTest.title}`);
  });

  describe('deployment and minting', () => {
    it('has the expected metadata', async () => {
      // `name` collides with the contract instance's own `name` property, so read it from the EIP-712 domain.
      assert.equal(domain.name, 'My3009Token');
      assert.equal(await token.symbol(), 'TKN3009');
      assert.equal((await token.decimals()).toString(), '18');
    });

    it('lets the owner mint tokens', async () => {
      const before = BigInt(await balanceOf(recipient));
      await mint(recipient, VALUE);
      assert.equal(await balanceOf(recipient), (before + BigInt(VALUE)).toString());
    });
  });

  describe('transferWithAuthorization', () => {
    it('transfers tokens with a valid signature and marks the nonce as used', async () => {
      const auth = authorization(recipient);
      const { v, r, s } = await sign('TransferWithAuthorization', auth);

      const fromBefore = BigInt(await balanceOf(auth.from));
      const toBefore = BigInt(await balanceOf(recipient));
      assert.equal(await token.authorizationState(auth.from, auth.nonce), false);

      await transfer(auth, { v, r, s });

      assert.equal(await balanceOf(auth.from), (fromBefore - BigInt(VALUE)).toString());
      assert.equal(await balanceOf(recipient), (toBefore + BigInt(VALUE)).toString());
      assert.equal(await token.authorizationState(auth.from, auth.nonce), true);
    });
  });

  describe('receiveWithAuthorization', () => {
    it('transfers tokens when the payee (msg.sender) submits the signature', async () => {
      // `to` must equal msg.sender, which is the default account (owner) in this test.
      const auth = authorization(owner);
      const { v, r, s } = await sign('ReceiveWithAuthorization', auth);

      const fromBefore = BigInt(await balanceOf(auth.from));
      const toBefore = BigInt(await balanceOf(owner));

      await receive(auth, { v, r, s });

      assert.equal(await balanceOf(auth.from), (fromBefore - BigInt(VALUE)).toString());
      assert.equal(await balanceOf(owner), (toBefore + BigInt(VALUE)).toString());
      assert.equal(await token.authorizationState(auth.from, auth.nonce), true);
    });
  });

  describe('cancelAuthorization', () => {
    it('cancels an unused authorization and marks the nonce as used', async () => {
      const nonce = randomNonce();
      const authorizer = signer.address.base58;
      const { v, r, s } = await sign('CancelAuthorization', { authorizer, nonce });

      assert.equal(await token.authorizationState(authorizer, nonce), false);
      await cancel(authorizer, nonce, { v, r, s });
      assert.equal(await token.authorizationState(authorizer, nonce), true);
    });
  });

  describe('revert paths', () => {
    const TRANSFER = 'TransferWithAuthorization';

    it('transferWithAuthorization reverts when the authorization has expired', async () => {
      const auth = authorization(recipient, { validBefore: 1 });
      await expectRevert(transfer(auth, await sign(TRANSFER, auth)), 'TRC3009InvalidAuthorizationTime(uint256,uint256)');
      assert.equal(await token.authorizationState(auth.from, auth.nonce), false);
    });

    it('transferWithAuthorization reverts when the authorization is not yet valid', async () => {
      const auth = authorization(recipient, { validAfter: FAR_FUTURE - 1 });
      await expectRevert(transfer(auth, await sign(TRANSFER, auth)), 'TRC3009InvalidAuthorizationTime(uint256,uint256)');
      assert.equal(await token.authorizationState(auth.from, auth.nonce), false);
    });

    it('transferWithAuthorization reverts when the nonce is replayed', async () => {
      const auth = authorization(recipient);
      const sig = await sign(TRANSFER, auth);
      await transfer(auth, sig);

      const balanceAfterFirst = await balanceOf(auth.from);
      await expectRevert(transfer(auth, sig), 'TRC3009UsedAuthorization(address,bytes32)');
      assert.equal(await balanceOf(auth.from), balanceAfterFirst);
    });

    it('transferWithAuthorization reverts when the signer is not `from`', async () => {
      const auth = authorization(recipient);
      const other = await require('tronweb').TronWeb.createAccount();
      const signature = await tronWeb.trx.signTypedData(
        domain, { [TRANSFER]: TYPES[TRANSFER] }, auth, other.privateKey
      );
      await expectRevert(transfer(auth, splitSignature(signature)), 'TRC3009InvalidSignature()');
      assert.equal(await token.authorizationState(auth.from, auth.nonce), false);
    });

    it('transferWithAuthorization reverts when the signed fields are tampered with', async () => {
      const auth = authorization(recipient);
      const sig = await sign(TRANSFER, auth);
      await expectRevert(transfer({ ...auth, value: '2000000000000000000' }, sig), 'TRC3009InvalidSignature()');
    });

    it('transferWithAuthorization reverts when the authorizer has insufficient balance', async () => {
      const auth = authorization(recipient, { value: (BigInt(MINT_AMOUNT) * 1000000n).toString() });
      await expectRevert(transfer(auth, await sign(TRANSFER, auth)), 'TRC20InsufficientBalance(address,uint256,uint256)');
      assert.equal(await token.authorizationState(auth.from, auth.nonce), false);
    });

    it('receiveWithAuthorization reverts when the caller is not the payee', async () => {
      // `to` is the recipient but the owner (default account) submits the transaction.
      const auth = authorization(recipient);
      await expectRevert(receive(auth, await sign('ReceiveWithAuthorization', auth)), 'TRC20InvalidReceiver(address)');
      assert.equal(await token.authorizationState(auth.from, auth.nonce), false);
    });

    it('receiveWithAuthorization reverts when given a TransferWithAuthorization signature', async () => {
      const auth = authorization(owner);
      await expectRevert(receive(auth, await sign(TRANSFER, auth)), 'TRC3009InvalidSignature()');
    });

    it('cancelAuthorization reverts when the signer is not the authorizer', async () => {
      const nonce = randomNonce();
      const authorizer = signer.address.base58;
      const other = await require('tronweb').TronWeb.createAccount();
      const signature = await tronWeb.trx.signTypedData(
        domain, { CancelAuthorization: TYPES.CancelAuthorization }, { authorizer, nonce }, other.privateKey
      );
      const { v, r, s } = splitSignature(signature);
      await expectRevert(cancel(authorizer, nonce, { v, r, s }), 'TRC3009InvalidSignature()');
      assert.equal(await token.authorizationState(authorizer, nonce), false);
    });

    it('cancelAuthorization reverts when the nonce was already used', async () => {
      const auth = authorization(recipient);
      await transfer(auth, await sign(TRANSFER, auth));

      const { v, r, s } = await sign('CancelAuthorization', { authorizer: auth.from, nonce: auth.nonce });
      await expectRevert(cancel(auth.from, auth.nonce, { v, r, s }), 'TRC3009UsedAuthorization(address,bytes32)');
    });

    it('transferWithAuthorization reverts after the authorization was canceled', async () => {
      const auth = authorization(recipient);
      const cancelSig = await sign('CancelAuthorization', { authorizer: auth.from, nonce: auth.nonce });
      await cancel(auth.from, auth.nonce, cancelSig);

      const balanceBefore = await balanceOf(auth.from);
      await expectRevert(transfer(auth, await sign(TRANSFER, auth)), 'TRC3009UsedAuthorization(address,bytes32)');
      assert.equal(await balanceOf(auth.from), balanceBefore);
    });
  });
});
