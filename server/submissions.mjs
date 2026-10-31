import crypto from 'node:crypto';
import { ethers } from 'ethers';
import { commitment, salt } from './crypto.mjs';

export class SubmissionService {
  constructor({ store, chain, jobs, emit = () => {} }) {
    Object.assign(this, { store, chain, jobs, emit });
    this.busy = false;
    this.recovering = false;
  }
  digest(features, ttl, name) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({ features, ttl, name }))
      .digest('hex');
  }
  async materialize(s, receipt) {
    if (receipt.status !== 1) {
      s.state = 'failed';
      s.error = 'Request transaction reverted';
      await this.store.saveSubmission(s);
      return;
    }
    const event = receipt.logs
      .map((l) => {
        try {
          return this.chain.contract.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === 'Requested');
    if (!event) throw new Error('Confirmed request has no Requested event');
    const id = event.args.jobId.toString();
    let job = this.jobs.find((j) => j.id === id);
    if (!job) {
      job = {
        id,
        submissionId: s.id,
        owner: s.owner,
        name: s.name,
        features: s.features,
        salt: s.salt,
        commitment: s.commitment,
        requester: s.requester,
        worker: s.worker,
        deadline: Number(event.args.deadline),
        reward: s.reward,
        requestTx: receipt.hash,
        status: 'queued',
        createdAt: s.createdAt,
      };
      await this.store.saveJob(job);
      this.jobs.push(job);
    }
    s.state = 'confirmed';
    s.jobId = id;
    delete s.rawTransaction;
    delete s.features;
    delete s.salt;
    await this.store.saveSubmission(s);
    this.emit();
    return job;
  }
  async recover() {
    if (this.recovering || this.busy) return;
    this.recovering = true;
    try {
      for (const s of (await this.store.submissions()).filter((s) => s.state === 'signed')) {
        const receipt = await this.chain.provider.getTransactionReceipt(s.hash);
        if (receipt && (await receipt.confirmations()) >= Number(process.env.CONFIRMATIONS || 1)) {
          await this.materialize(s, receipt);
          continue;
        }
        try {
          await this.chain.provider.broadcastTransaction(s.rawTransaction);
        } catch (error) {
          // An already-known response is expected after a crash. Never sign a replacement here.
          s.lastBroadcastError = String(error.shortMessage || error.message).slice(0, 150);
          await this.store.saveSubmission(s);
        }
      }
    } finally {
      this.recovering = false;
    }
  }
  async submit({ owner, key, features, ttl, name, reward, quotaScopes = [] }) {
    if (this.busy)
      throw Object.assign(new Error('Another request is being signed; retry with the same key'), {
        status: 409,
      });
    this.busy = true;
    try {
      const digest = this.digest(features, ttl, name),
        previous = await this.store.submission(owner, key);
      if (previous) {
        if (previous.digest !== digest)
          throw Object.assign(new Error('Idempotency key was already used with different inputs'), {
            status: 409,
          });
        return { submission: previous, job: this.jobs.find((j) => j.id === previous.jobId) };
      }
      if (this.recovering || (await this.store.submissions()).some((s) => s.state === 'signed'))
        throw Object.assign(
          new Error('A request is awaiting registration; retry with the same idempotency key'),
          { status: 409 },
        );
      const secret = salt(),
        inputHash = commitment(features, secret);
      const populated = await this.chain.requester.populateTransaction(
        await this.chain.contract.request.populateTransaction(inputHash, ttl, {
          value: ethers.parseEther(reward),
        }),
      );
      if (ethers.getBigInt(populated.gasLimit) > 1500000n)
        throw new Error('Request gas estimate exceeds operator limit');
      const signed = await this.chain.requester.signTransaction(populated),
        hash = ethers.keccak256(signed);
      const s = {
        id: crypto.randomUUID(),
        owner,
        idempotency: key,
        digest,
        name,
        features,
        salt: secret,
        commitment: inputHash,
        reward,
        ttl,
        requester: await this.chain.requester.getAddress(),
        worker: await this.chain.worker.getAddress(),
        state: 'signed',
        hash,
        rawTransaction: signed,
        createdAt: new Date().toISOString(),
      };
      await this.store.consumeQuotas(quotaScopes);
      await this.store.saveSubmission(s);
      // Test-only failpoint: simulate sudden death after durable signing but before broadcast.
      if (process.env.PROOFLINE_TEST_CRASH_AFTER_SIGN === '1') process.exit(81);
      try {
        const tx = await this.chain.provider.broadcastTransaction(signed);
        const receipt = await tx.wait(
          Number(process.env.CONFIRMATIONS || 1),
          Number(process.env.RECEIPT_TIMEOUT_MS || 60000),
        );
        return { submission: s, job: await this.materialize(s, receipt) };
      } catch (error) {
        s.lastBroadcastError = String(error.shortMessage || error.message).slice(0, 150);
        await this.store.saveSubmission(s);
        return { submission: s, pending: true };
      }
    } finally {
      this.busy = false;
    }
  }
}
