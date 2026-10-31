import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fork } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { ethers } from 'ethers';
import { connectChain } from './chain.mjs';
import { model, commitment, salt, validateFeatures } from './crypto.mjs';

const mode = process.env.MODE || 'demo',
  host = process.env.HOST || '127.0.0.1';
if (mode !== 'demo' && mode !== 'external') throw new Error('MODE must be demo or external');
if (mode === 'external' && !process.env.OPERATOR_TOKEN)
  throw new Error('External mode requires OPERATOR_TOKEN');
const chain = await connectChain();
fs.mkdirSync('.local', { recursive: true });
const db = new DatabaseSync('.local/jobs.sqlite');
db.exec(
  `PRAGMA journal_mode=WAL;CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,record TEXT NOT NULL);`,
);
const jobs = db
  .prepare('SELECT record FROM jobs')
  .all()
  .map((r) => JSON.parse(r.record));
const save = (j) => {
  j.updatedAt = new Date().toISOString();
  db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?)').run(j.id, JSON.stringify(j));
};
const publicJob = (j) => {
  const { features, salt: _, ...record } = j;
  return record;
};
for (const j of jobs) {
  if (['proving', 'verifying'].includes(j.status)) {
    const state = await chain.contract.jobs(j.id);
    if (Number(state.status) === 2) {
      j.status = 'settled';
      j.risk = Number(state.risk);
    } else j.status = 'queued';
    save(j);
  }
}
let active = false,
  child = null;
const listeners = new Set();
const emit = () => {
  for (const res of listeners) res.write('data: ' + JSON.stringify({ type: 'update' }) + '\n\n');
};
const update = (j, patch) => {
  Object.assign(j, patch);
  save(j);
  emit();
};
const inputFor = (j) => ({
  features: j.features,
  salt: j.salt,
  chainId: chain.chainId,
  consumer: BigInt(chain.address).toString(),
  jobId: j.id,
  requester: BigInt(j.requester).toString(),
  worker: BigInt(j.worker).toString(),
  modelId: model.id,
});
function runProver(input) {
  return new Promise((resolve, reject) => {
    child = fork(path.resolve('server/prover.mjs'), [], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const timer = setTimeout(() => {
      child?.kill();
      reject(new Error('Proof generation exceeded the three-minute worker limit'));
    }, 180000);
    child.once('message', (message) => {
      clearTimeout(timer);
      message.ok ? resolve(message.result) : reject(new Error(message.error));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('Prover process failed'));
    });
    child.send(input);
  });
}
async function attacks(j, args) {
  const checks = [];
  const attempt = async (name, fn) => {
    try {
      await fn();
      checks.push({ name, rejected: false });
    } catch {
      checks.push({ name, rejected: true });
    }
  };
  const mutate = (index, value) => [
    ...args.slice(0, 3),
    args[3].map((v, i) => (i === index ? value : v)),
  ];
  await attempt('Tampered prediction', () =>
    chain.contract
      .connect(chain.worker)
      .settle.staticCall(j.id, ...mutate(0, String(1 - Number(args[3][0])))),
  );
  await attempt('Wrong input commitment', () =>
    chain.contract.connect(chain.worker).settle.staticCall(j.id, ...mutate(1, '1')),
  );
  await attempt('Cross-chain replay', () =>
    chain.contract.connect(chain.worker).settle.staticCall(j.id, ...mutate(3, '1')),
  );
  await attempt('Wrong consumer contract', () =>
    chain.contract.connect(chain.worker).settle.staticCall(j.id, ...mutate(4, '1')),
  );
  await attempt('Wrong job ID', () =>
    chain.contract.connect(chain.worker).settle.staticCall(j.id, ...mutate(5, '0')),
  );
  await attempt('Model substitution', () =>
    chain.contract.connect(chain.worker).settle.staticCall(j.id, ...mutate(8, '1')),
  );
  if (chain.thief)
    await attempt('Front-running worker', () =>
      chain.contract.connect(chain.thief).settle.staticCall(j.id, ...args),
    );
  const forged = [...args];
  forged[0] = ['1', '2'];
  await attempt('Forged curve proof', () =>
    chain.contract.connect(chain.worker).settle.staticCall(j.id, ...forged),
  );
  return checks;
}
async function drain() {
  if (active) return;
  const j = jobs.find((j) => j.status === 'queued');
  if (!j) return;
  active = true;
  try {
    const state = await chain.contract.jobs(j.id);
    const block = await chain.provider.getBlock('latest');
    if (Number(state.status) === 3 || block.timestamp >= Number(state.deadline)) {
      update(j, { status: 'expired' });
      return;
    }
    update(j, { status: 'proving', startedAt: new Date().toISOString() });
    const result = await runProver(inputFor(j));
    update(j, {
      status: 'verifying',
      proof: result.proof,
      publicSignals: result.publicSignals,
      proveMs: result.proveMs,
      risk: Number(result.publicSignals[0]),
      proofBytes: ethers.getBytes(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256[2]', 'uint256[2][2]', 'uint256[2]'],
          result.args.slice(0, 3),
        ),
      ).length,
    });
    const checks = await attacks(j, result.args);
    const tx = await chain.contract.connect(chain.worker).settle(j.id, ...result.args);
    const receipt = await tx.wait();
    try {
      await chain.contract.connect(chain.worker).settle.staticCall(j.id, ...result.args);
      checks.push({ name: 'Duplicate settlement', rejected: false });
    } catch {
      checks.push({ name: 'Duplicate settlement', rejected: true });
    }
    update(j, {
      status: 'settled',
      settleTx: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      checks,
      settledAt: new Date().toISOString(),
    });
  } catch (error) {
    update(j, {
      status: 'failed',
      error: String(error.shortMessage || error.message).slice(0, 300),
    });
  } finally {
    active = false;
    child = null;
    setTimeout(drain, 30);
  }
}
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  if (req.path.startsWith('/api')) {
    res.set('Cache-Control', 'no-store');
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host)
          return res.status(403).json({ error: 'Cross-origin API access rejected' });
      } catch {
        return res.sendStatus(403);
      }
    }
    const token = process.env.OPERATOR_TOKEN;
    if (token) {
      const actual = Buffer.from(req.headers.authorization?.replace(/^Bearer /, '') || '');
      const expected = Buffer.from(token);
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected))
        return res.status(401).json({ error: 'An operator token is required' });
    }
  }
  next();
});
const limits = new Map();
const rateLimit = (req, res, next) => {
  const key = req.socket.remoteAddress;
  let info = limits.get(key);
  if (!info || info.reset < Date.now()) {
    info = { count: 0, reset: Date.now() + 600000 };
    limits.set(key, info);
  }
  if (++info.count > 20)
    return res.status(429).json({ error: 'Twenty submissions per ten minutes. Please wait.' });
  next();
};
const cpuTotals = () =>
  os
    .cpus()
    .reduce(
      (a, c) => ({
        idle: a.idle + c.times.idle,
        total: a.total + Object.values(c.times).reduce((s, n) => s + n, 0),
      }),
      { idle: 0, total: 0 },
    );
let cpuSample = cpuTotals();
app.get('/api/telemetry', (req, res) => {
  const now = cpuTotals(),
    total = now.total - cpuSample.total,
    idle = now.idle - cpuSample.idle;
  cpuSample = now;
  const recent = jobs.slice(-50);
  res.json({
    features: [
      Math.round(total ? 100 * (1 - idle / total) : 0),
      Math.round(100 * (1 - os.freemem() / os.totalmem())),
      Math.round(
        recent.length
          ? (100 * recent.filter((j) => j.status === 'failed').length) / recent.length
          : 0,
      ),
      Math.min(
        100,
        Math.round(
          (100 * jobs.filter((j) => ['queued', 'proving', 'verifying'].includes(j.status)).length) /
            6,
        ),
      ),
    ],
    source:
      'Actual server CPU sample, memory, recent Proofline failure ratio and proof queue utilization',
  });
});
app.get('/api/status', async (req, res) => {
  res.json({
    mode,
    chainId: chain.chainId,
    contract: chain.address,
    requester: await chain.requester.getAddress(),
    worker: await chain.worker.getAddress(),
    model,
    setup: JSON.parse(fs.readFileSync('artifacts/manifest.json')).setup,
    workerCredit: ethers.formatEther(await chain.contract.credits(await chain.worker.getAddress())),
    block: await chain.provider.getBlockNumber(),
    active,
    queued: jobs.filter((j) => j.status === 'queued').length,
  });
});
app.get('/api/jobs', (req, res) => res.json(jobs.slice().reverse().map(publicJob)));
app.get('/api/jobs/:id/bundle', (req, res) => {
  const j = jobs.find((j) => j.id === req.params.id);
  if (!j?.proof) return res.status(404).json({ error: 'No proof available' });
  res
    .attachment(`proofline-job-${j.id}.json`)
    .json({
      schema: 'proofline/v1',
      job: publicJob(j),
      model,
      verificationKey: JSON.parse(fs.readFileSync('artifacts/verification_key.json')),
      manifest: JSON.parse(fs.readFileSync('artifacts/manifest.json')),
    });
});
let submitting = false;
app.post('/api/jobs', rateLimit, async (req, res) => {
  if (submitting)
    return res.status(409).json({ error: 'Another request is being registered. Try again.' });
  if (jobs.filter((j) => ['queued', 'proving', 'verifying'].includes(j.status)).length >= 6)
    return res.status(429).json({ error: 'Proof queue is full' });
  submitting = true;
  try {
    const features = validateFeatures(req.body.features);
    const ttl = req.body.ttl ?? 600;
    if (!Number.isInteger(ttl) || ttl < 30 || ttl > 3600)
      throw new Error('TTL must be an integer from 30 to 3600 seconds');
    const secret = salt(),
      hash = commitment(features, secret);
    const tx = await chain.contract.request(hash, ttl, { value: ethers.parseEther('0.001') });
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((l) => {
        try {
          return chain.contract.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((l) => l?.name === 'Requested');
    const j = {
      id: event.args.jobId.toString(),
      name: typeof req.body.name === 'string' ? req.body.name.slice(0, 60) : 'Telemetry request',
      features,
      salt: secret,
      commitment: hash,
      requester: await chain.requester.getAddress(),
      worker: await chain.worker.getAddress(),
      deadline: Number(event.args.deadline),
      reward: '0.001',
      requestTx: receipt.hash,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    jobs.push(j);
    save(j);
    emit();
    res.status(201).json(publicJob(j));
    setTimeout(drain, 10);
  } catch (error) {
    res.status(400).json({ error: error.shortMessage || error.message });
  } finally {
    submitting = false;
  }
});
app.post('/api/jobs/:id/refund', async (req, res) => {
  try {
    const j = jobs.find((j) => j.id === req.params.id);
    if (!j) return res.sendStatus(404);
    if (['proving', 'verifying'].includes(j.status))
      return res.status(409).json({ error: 'Wait for the active prover to finish' });
    const tx = await chain.contract.refund(j.id);
    const receipt = await tx.wait();
    update(j, { status: 'refunded', refundTx: receipt.hash });
    res.json(publicJob(j));
  } catch (error) {
    res
      .status(400)
      .json({ error: error.shortMessage || 'Job must expire before a refund is possible' });
  }
});
app.post('/api/withdraw', async (req, res) => {
  try {
    const tx = await chain.contract.connect(chain.worker).withdraw();
    const receipt = await tx.wait();
    res.json({ transaction: receipt.hash });
  } catch (error) {
    res.status(400).json({ error: error.shortMessage || 'No settled credit to withdraw' });
  }
});
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('data: {"type":"connected"}\n\n');
  listeners.add(res);
  const keep = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keep);
    listeners.delete(res);
  });
});
app.use(express.static('dist'));
app.get('/', (req, res) => res.sendFile(path.resolve('dist/index.html')));
app.use((error, req, res, next) => {
  console.error(error.message);
  res.status(500).json({ error: 'Internal operation failed; inspect operator logs' });
});
const http = app.listen(Number(process.env.PORT || 15190), host, () => {
  console.log(
    `Proofline: http://${host}:${process.env.PORT || 15190} — ${mode} chain ${chain.chainId}`,
  );
  drain();
});
async function shutdown() {
  child?.kill();
  for (const res of listeners) res.end();
  http.close();
  db.close();
  await chain.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
