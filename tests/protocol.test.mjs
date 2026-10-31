import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { ethers } from 'ethers';
import { connectChain } from '../server/chain.mjs';
import { model, commitment, salt, predict, validateFeatures } from '../server/crypto.mjs';
const proof = (input) =>
  new Promise((resolve, reject) => {
    const p = fork('server/prover.mjs', [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    p.once('message', (m) => (m.ok ? resolve(m.result) : reject(new Error(m.error))));
    p.once('error', reject);
    p.once('exit', (code) => {
      if (code) reject(new Error('Prover failed'));
    });
    p.send(input);
  });
test(
  'real proof, EVM verification, adversarial rejection and escrow lifecycle',
  { timeout: 180000 },
  async (t) => {
    const chain = await connectChain({ ephemeral: true });
    const { contract, worker, requester, provider } = chain;
    const wa = await worker.getAddress(),
      ra = await requester.getAddress();
    const features = [68, 96, 12, 65],
      secret = salt(),
      hash = commitment(features, secret);
    const checks = [];
    let receipt;
    try {
      await t.test('salted commitments and API range checks', () => {
        assert.notEqual(hash, commitment(features, salt()));
        assert.throws(() => validateFeatures([101, 1, 1, 1]));
        assert.throws(() => validateFeatures([1.5, 1, 1, 1]));
      });
      await (await contract.request(hash, 600, { value: ethers.parseEther('0.001') })).wait();
      const input = {
        features,
        salt: secret,
        chainId: chain.chainId,
        consumer: BigInt(chain.address).toString(),
        jobId: '1',
        requester: BigInt(ra).toString(),
        worker: BigInt(wa).toString(),
        modelId: model.id,
      };
      const result = await proof(input),
        args = result.args;
      await t.test('real Groth16 statement agrees with reference inference', () => {
        assert.equal(Number(result.publicSignals[0]), predict(features));
        assert.equal(result.publicSignals[1], hash);
        assert.equal(result.publicSignals.length, 9);
      });
      const rejects = async (name, fn, evm = true) => {
        await t.test(name, async () => {
          await assert.rejects(fn, (error) =>
            evm
              ? error.code === 'CALL_EXCEPTION'
              : /Assert Failed|Error in template|constraint/i.test(error.message),
          );
          checks.push({ name, rejected: true });
        });
      };
      const mutation = (i, v) => [...args.slice(0, 3), args[3].map((s, k) => (i === k ? v : s))];
      await rejects('changed output fails pairing verification', () =>
        contract.connect(worker).settle.staticCall(1, ...mutation(0, '0')),
      );
      await rejects('changed commitment is rejected', () =>
        contract.connect(worker).settle.staticCall(1, ...mutation(1, '1')),
      );
      await rejects('wrong chain is rejected', () =>
        contract.connect(worker).settle.staticCall(1, ...mutation(3, '1')),
      );
      await rejects('wrong consumer is rejected', () =>
        contract.connect(worker).settle.staticCall(1, ...mutation(4, '1')),
      );
      await rejects('wrong request is rejected', () =>
        contract.connect(worker).settle.staticCall(1, ...mutation(5, '2')),
      );
      await rejects('wrong requester is rejected', () =>
        contract.connect(worker).settle.staticCall(1, ...mutation(6, '1')),
      );
      await rejects('wrong model is rejected', () =>
        contract.connect(worker).settle.staticCall(1, ...mutation(8, '1')),
      );
      await rejects('front-running proof cannot steal reward', () =>
        contract.connect(chain.thief).settle.staticCall(1, ...args),
      );
      const forged = [...args];
      forged[0] = ['1', '2'];
      await rejects('forged curve points are rejected', () =>
        contract.connect(worker).settle.staticCall(1, ...forged),
      );
      await t.test('genuine proof settles and credits exact reward', async () => {
        receipt = await (await contract.connect(worker).settle(1, ...args)).wait();
        assert.equal((await contract.jobs(1)).status, 2n);
        assert.equal(await contract.credits(wa), ethers.parseEther('0.001'));
      });
      await rejects('duplicate proof cannot be settled twice', () =>
        contract.connect(worker).settle.staticCall(1, ...args),
      );
      await t.test('worker withdraws credit exactly once', async () => {
        await (await contract.connect(worker).withdraw()).wait();
        assert.equal(await contract.credits(wa), 0n);
        await assert.rejects(() => contract.connect(worker).withdraw.staticCall());
      });
      await t.test('pending escrow cannot be refunded early', async () => {
        await (await contract.request(hash, 30, { value: 1000n })).wait();
        await assert.rejects(() => contract.refund.staticCall(2));
      });
      await t.test('expired job rejects delivery and returns escrow to requester', async () => {
        await provider.send('evm_increaseTime', [35]);
        await provider.send('evm_mine', []);
        await assert.rejects(() => contract.connect(worker).settle.staticCall(2, ...args));
        await assert.rejects(() => contract.connect(chain.thief).refund.staticCall(2));
        await (await contract.refund(2)).wait();
        assert.equal(await contract.credits(ra), 1000n);
        assert.equal((await contract.jobs(2)).status, 3n);
      });
      await rejects(
        'out-of-range witness fails circuit constraints',
        () => proof({ ...input, features: [101, 96, 12, 65] }),
        false,
      );
      await rejects(
        'model substitution fails witness generation',
        () => proof({ ...input, modelId: '1' }),
        false,
      );
      await t.test('healthy classification has a real proof too', async () => {
        const r = await proof({ ...input, features: [35, 42, 4, 20] });
        assert.equal(Number(r.publicSignals[0]), 0);
      });
      fs.mkdirSync('docs/evidence', { recursive: true });
      fs.writeFileSync(
        'docs/evidence/sample-proof.json',
        JSON.stringify(
          {
            schema: 'proofline/evidence-v1',
            scope: 'Local Ganache EVM, not a public network',
            proof: result.proof,
            publicSignals: result.publicSignals,
            verificationKey: JSON.parse(fs.readFileSync('artifacts/verification_key.json')),
            measurements: {
              proveAndLocalVerifyMs: result.proveMs,
              settlementGas: receipt.gasUsed.toString(),
              proofCoordinatesAbiBytes: 256,
            },
            checks,
            circuitSha256: JSON.parse(fs.readFileSync('artifacts/manifest.json')).circuit,
          },
          null,
          2,
        ),
      );
    } finally {
      await chain.close();
    }
  },
);
