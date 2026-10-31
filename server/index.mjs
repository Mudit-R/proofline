import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fork } from 'node:child_process';
import express from 'express';
import { ethers } from 'ethers';
import { connectChain } from './chain.mjs';
import { model, commitment, salt, validateFeatures } from './crypto.mjs';
import { Store } from './store.mjs';
import { SubmissionService } from './submissions.mjs';
import {
  hashPassword,
  hashSessionToken,
  normalizeEmail,
  sessionToken,
  validEmail,
  validPassword,
  verifyPassword,
} from './auth.mjs';

const mode = process.env.MODE || 'demo',
  host = process.env.HOST || '127.0.0.1';
if (mode !== 'demo' && mode !== 'external') throw new Error('MODE must be demo or external');
if (mode === 'external' && !process.env.OPERATOR_TOKEN)
  throw new Error('External mode requires OPERATOR_TOKEN');
const chain = await connectChain();
const publicTry = process.env.PUBLIC_TRY === 'true';
const publicReward = '0.000001';
if (publicTry && mode === 'external' && chain.chainId !== '11155111')
  throw new Error('Sponsored public access is restricted to Ethereum Sepolia');
if (publicTry && !process.env.SESSION_SECRET)
  throw new Error('PUBLIC_TRY requires a persistent SESSION_SECRET');
const dataDir = process.env.DATA_DIR || '.local';
fs.mkdirSync(dataDir, { recursive: true });
const store = await Store.open(dataDir);
await store.pruneSessions(new Date().toISOString());
const retentionDays = 7;
await store.prune(new Date(Date.now() - retentionDays * 86400000).toISOString());
const jobs = await store.jobs();
const save = async (j) => store.saveJob(j);
const publicJob = (j) => {
  const { features, salt: _, owner, rawSettlement, ...record } = j;
  return record;
};
for (const j of jobs) {
  if (['proving', 'verifying'].includes(j.status)) {
    const state = await chain.contract.jobs(j.id);
    if (Number(state.status) === 2) {
      j.status = 'settled';
      j.risk = Number(state.risk);
      if (j.settleTx) {
        const receipt = await chain.provider.getTransactionReceipt(j.settleTx);
        if (receipt) {
          j.blockNumber = receipt.blockNumber;
          j.gasUsed = receipt.gasUsed.toString();
        }
      }
      delete j.rawSettlement;
    } else j.status = 'queued';
    await save(j);
  }
}
let active = false,
  child = null;
let stopping = false;
const listeners = new Set();
const emit = () => {
  for (const res of listeners) res.write('data: ' + JSON.stringify({ type: 'update' }) + '\n\n');
};
const submissions = new SubmissionService({ store, chain, jobs, emit });
async function pruneOldData() {
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  const removed = await store.prune(cutoff);
  if (removed.length) {
    const expired = new Set(removed);
    for (let i = jobs.length - 1; i >= 0; i--) if (expired.has(jobs[i].id)) jobs.splice(i, 1);
    emit();
  }
}
const update = async (j, patch) => {
  Object.assign(j, patch);
  await save(j);
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
    let delivered = false;
    child.once('message', () => {
      delivered = true;
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !delivered)
        reject(new Error('Prover process exited without a valid result'));
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
    } catch (error) {
      checks.push({
        name,
        rejected: error.code === 'CALL_EXCEPTION',
        reason:
          error.code === 'CALL_EXCEPTION' ? 'EVM reverted' : 'Infrastructure error: ' + error.code,
      });
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
  if (active || stopping) return;
  const j = jobs.find((j) => j.status === 'queued' && (!j.retryAt || j.retryAt <= Date.now()));
  if (!j) return;
  active = true;
  try {
    const state = await chain.contract.jobs(j.id);
    const block = await chain.provider.getBlock('latest');
    if (Number(state.status) === 2) {
      await update(j, { status: 'settled', risk: Number(state.risk) });
      return;
    }
    if (Number(state.status) === 3 || block.timestamp >= Number(state.deadline)) {
      await update(j, { status: 'expired' });
      return;
    }
    await update(j, { status: 'proving', startedAt: new Date().toISOString() });
    const result = j.proof
      ? {
          proof: j.proof,
          publicSignals: j.publicSignals,
          proveMs: j.proveMs,
          args: JSON.parse(
            '[' +
              (await (
                await import('snarkjs')
              ).groth16.exportSolidityCallData(j.proof, j.publicSignals)) +
              ']',
          ),
        }
      : await runProver(inputFor(j));
    await update(j, {
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
    let receipt = j.settleTx ? await chain.provider.getTransactionReceipt(j.settleTx) : null;
    if (!receipt) {
      if (!j.rawSettlement) {
        const populated = await chain.worker.populateTransaction(
          await chain.contract
            .connect(chain.worker)
            .settle.populateTransaction(j.id, ...result.args),
        );
        const rawSettlement = await chain.worker.signTransaction(populated);
        await update(j, { rawSettlement, settleTx: ethers.keccak256(rawSettlement), checks });
      }
      let tx;
      try {
        tx = await chain.provider.broadcastTransaction(j.rawSettlement);
      } catch (error) {
        const existing = await chain.provider.getTransaction(j.settleTx);
        if (!existing) throw error;
        tx = existing;
      }
      receipt = await tx.wait(
        Number(process.env.CONFIRMATIONS || 1),
        Number(process.env.RECEIPT_TIMEOUT_MS || 20000),
      );
    }
    if (!receipt || receipt.status !== 1)
      throw new Error('Settlement did not confirm successfully');
    try {
      await chain.contract.connect(chain.worker).settle.staticCall(j.id, ...result.args);
      checks.push({ name: 'Duplicate settlement', rejected: false });
    } catch (error) {
      checks.push({ name: 'Duplicate settlement', rejected: error.code === 'CALL_EXCEPTION' });
    }
    await update(j, {
      status: 'settled',
      settleTx: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      checks,
      settledAt: new Date().toISOString(),
    });
    delete j.rawSettlement;
    await save(j);
  } catch (error) {
    if (stopping) return;
    const transient = ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'UNKNOWN_ERROR'].includes(
      error.code,
    );
    const attempts = (j.attempts || 0) + 1;
    await update(j, {
      status: transient && attempts < 5 ? 'queued' : 'failed',
      attempts,
      retryAt: Date.now() + Math.min(60000, 2000 * 2 ** attempts),
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
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
app.use(express.json({ limit: '8kb' }));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(async (req, res, next) => {
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
    const token = process.env.OPERATOR_TOKEN,
      provided = req.headers.authorization?.replace(/^Bearer /, '') || '';
    const actual = Buffer.from(provided),
      expected = Buffer.from(token || '');
    const validOperator =
      Boolean(token) &&
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected);
    const accountCookie = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('proofline_auth='))
      ?.slice('proofline_auth='.length);
    req.account = null;
    if (accountCookie && /^[A-Za-z0-9_-]{40,60}$/.test(accountCookie)) {
      req.account = await store.userForSession(
        hashSessionToken(accountCookie),
        new Date().toISOString(),
      );
    }
    req.operator = token ? validOperator : mode === 'demo' && !req.account;
    const authRoute =
      (req.method === 'GET' && req.path === '/api/auth/me') ||
      (req.method === 'POST' &&
        ['/api/auth/register', '/api/auth/login', '/api/auth/logout'].includes(req.path));
    if (!req.operator && !req.account && !publicTry && !authRoute)
      return res.status(401).json({ error: 'Sign in to access your workspace' });
    if (!req.operator && provided && !validOperator && !authRoute)
      return res.status(401).json({ error: 'Invalid operator token' });
    req.owner = req.operator ? 'operator' : req.account ? 'account:' + req.account.id : null;
    const quotaSecret = process.env.SESSION_SECRET || 'proofline-local-account-quota';
    req.quotaIp = crypto
      .createHmac('sha256', quotaSecret)
      .update(req.ip || req.socket.remoteAddress || 'unknown')
      .digest('hex');
    if (!req.operator && !req.account && publicTry) {
      const secret = process.env.SESSION_SECRET;
      const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('hex');
      const candidate = (req.headers.cookie || '')
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('proofline_session='))
        ?.slice(18);
      let owner = candidate?.split('.')[0];
      if (!owner || !/^[a-f0-9]{48}$/.test(owner) || candidate !== owner + '.' + sign(owner)) {
        owner = crypto.randomBytes(24).toString('hex');
        res.setHeader(
          'Set-Cookie',
          `proofline_session=${owner}.${sign(owner)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${req.secure ? '; Secure' : ''}`,
        );
      }
      req.owner = owner;
      req.quotaIp = sign(req.ip || req.socket.remoteAddress);
    }
  }
  next();
});
const limits = new Map();
const rateLimit = (req, res, next) => {
  const key = req.ip || req.socket.remoteAddress;
  let info = limits.get(key);
  if (!info || info.reset < Date.now()) {
    info = { count: 0, reset: Date.now() + 600000 };
    limits.set(key, info);
  }
  // Bound memory use if many distinct source addresses hit the public endpoint.
  if (limits.size > 5000) {
    for (const address of limits.keys()) {
      limits.delete(address);
      if (limits.size <= 4000) break;
    }
  }
  if (++info.count > 20)
    return res.status(429).json({ error: 'Twenty submissions per ten minutes. Please wait.' });
  next();
};
const authLimits = new Map();
function limitAuth(req, res, next) {
  const key = req.ip || req.socket.remoteAddress;
  let info = authLimits.get(key);
  if (!info || info.reset < Date.now()) {
    info = { count: 0, reset: Date.now() + 600000 };
    authLimits.set(key, info);
  }
  if (authLimits.size > 5000) {
    for (const address of authLimits.keys()) {
      authLimits.delete(address);
      if (authLimits.size <= 4000) break;
    }
  }
  if (++info.count > 10)
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait ten minutes.' });
  next();
}
const sessionLifetimeMs = 14 * 24 * 60 * 60 * 1000;
const safeUser = (user) => ({ id: user.id, email: user.email, createdAt: user.createdAt });
function setAccountCookie(req, res, token) {
  res.setHeader(
    'Set-Cookie',
    `proofline_auth=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionLifetimeMs / 1000}${req.secure ? '; Secure' : ''}`,
  );
}
function clearAccountCookie(req, res) {
  res.setHeader(
    'Set-Cookie',
    `proofline_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${req.secure ? '; Secure' : ''}`,
  );
}
async function beginAccountSession(req, res, user) {
  const token = sessionToken(),
    now = new Date(),
    expiresAt = new Date(now.getTime() + sessionLifetimeMs);
  await store.createSession({
    tokenHash: hashSessionToken(token),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  setAccountCookie(req, res, token);
  return safeUser(user);
}
app.get('/api/auth/me', (req, res) =>
  res.json({ user: req.account ? safeUser(req.account) : null, publicTry, authEnabled: true }),
);
app.post('/api/auth/register', limitAuth, async (req, res) => {
  const email = normalizeEmail(req.body?.email),
    password = req.body?.password;
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!validPassword(password))
    return res.status(400).json({ error: 'Use a password from 12 to 128 characters.' });
  const { salt: passwordSalt, hash: passwordHash } = await hashPassword(password);
  try {
    const user = await store.createUser({
      id: crypto.randomUUID(),
      email,
      passwordSalt,
      passwordHash,
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ user: await beginAccountSession(req, res, user) });
  } catch (error) {
    if (
      error.code === '23505' ||
      error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
      error.message?.includes('UNIQUE constraint failed')
    )
      return res
        .status(409)
        .json({ error: 'An account for this email already exists. Sign in instead.' });
    throw error;
  }
});
app.post('/api/auth/login', limitAuth, async (req, res) => {
  const email = normalizeEmail(req.body?.email),
    password = req.body?.password;
  if (!validEmail(email) || typeof password !== 'string' || password.length > 128)
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  const user = await store.userByEmail(email);
  // Do a password hash even for unknown emails to reduce account enumeration by timing.
  const matches = user
    ? await verifyPassword(password, user.passwordSalt, user.passwordHash)
    : await hashPassword(password).then(() => false);
  if (!matches) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ user: await beginAccountSession(req, res, user) });
});
app.post('/api/auth/logout', async (req, res) => {
  const accountCookie = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('proofline_auth='))
    ?.slice('proofline_auth='.length);
  if (accountCookie && /^[A-Za-z0-9_-]{40,60}$/.test(accountCookie))
    await store.revokeSession(hashSessionToken(accountCookie));
  clearAccountCookie(req, res);
  res.json({ ok: true });
});
const cpuTotals = () =>
  os.cpus().reduce(
    (a, c) => ({
      idle: a.idle + c.times.idle,
      total: a.total + Object.values(c.times).reduce((s, n) => s + n, 0),
    }),
    { idle: 0, total: 0 },
  );
let cpuSample = cpuTotals();
app.get('/api/telemetry', (req, res) => {
  if (!req.operator)
    return res
      .status(403)
      .json({ error: 'Server telemetry is operator-only; use your own workload metrics' });
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
    operator: req.operator,
    publicTry,
    reward: publicTry ? publicReward : process.env.REWARD_ETH || publicReward,
    historyRetentionDays: publicTry ? retentionDays : null,
    sponsoredLimits: publicTry
      ? { perBrowserPerDay: 3, perNetworkPerDay: 10, globalPerDay: 20 }
      : null,
    explorer: chain.chainId === '11155111' ? 'https://sepolia.etherscan.io' : null,
    networkName: chain.chainId === '11155111' ? 'Ethereum Sepolia' : 'Local development EVM',
    pendingSubmissions: (await store.submissions()).filter(
      (s) => s.state === 'signed' && (req.operator || s.owner === req.owner),
    ).length,
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
const visibleJob = (req, j) => !!j && (req.operator || j.owner === req.owner);
app.get('/api/jobs', (req, res) =>
  res.json(
    jobs
      .filter((j) => visibleJob(req, j))
      .slice(-200)
      .reverse()
      .map(publicJob),
  ),
);
app.get('/api/transactions/:hash', async (req, res) => {
  if (!/^0x[0-9a-f]{64}$/i.test(req.params.hash))
    return res.status(400).json({ error: 'Invalid transaction hash' });
  const receipt = await chain.provider.getTransactionReceipt(req.params.hash);
  if (!receipt) return res.status(404).json({ error: 'Receipt not found on this chain' });
  const tx = await chain.provider.getTransaction(req.params.hash);
  res.json({
    chainId: chain.chainId,
    hash: receipt.hash,
    blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash,
    status: receipt.status,
    from: receipt.from,
    to: receipt.to,
    value: ethers.formatEther(tx.value),
    gasUsed: receipt.gasUsed.toString(),
    events: receipt.logs.map((log) => {
      try {
        const event = chain.contract.interface.parseLog(log);
        return { name: event.name, args: event.args.toArray().map(String) };
      } catch {
        return { address: log.address, topics: log.topics };
      }
    }),
  });
});
app.get('/api/jobs/:id/bundle', (req, res) => {
  const j = jobs.find((j) => j.id === req.params.id);
  if (!visibleJob(req, j) || !j.proof) return res.status(404).json({ error: 'No proof available' });
  res.attachment(`proofline-job-${j.id}.json`).json({
    schema: 'proofline/v1',
    job: publicJob(j),
    model,
    verificationKey: JSON.parse(fs.readFileSync('artifacts/verification_key.json')),
    manifest: JSON.parse(fs.readFileSync('artifacts/manifest.json')),
  });
});
app.post('/api/jobs', rateLimit, async (req, res) => {
  try {
    if (publicTry) {
      const reserve = ethers.parseEther('0.002');
      const [requesterBalance, workerBalance] = await Promise.all([
        chain.provider.getBalance(await chain.requester.getAddress()),
        chain.provider.getBalance(await chain.worker.getAddress()),
      ]);
      if (requesterBalance < reserve || workerBalance < reserve)
        return res
          .status(503)
          .json({ error: 'Sponsored Sepolia funds are low; requests are paused.' });
    }
    if (jobs.filter((j) => ['queued', 'proving', 'verifying'].includes(j.status)).length >= 6)
      return res.status(429).json({ error: 'Proof queue is full' });
    const features = validateFeatures(req.body.features),
      ttl = req.body.ttl ?? 600;
    if (!Number.isInteger(ttl) || ttl < 30 || ttl > 3600)
      throw new Error('TTL must be an integer from 30 to 3600 seconds');
    const name =
      typeof req.body.name === 'string' ? req.body.name.slice(0, 60) : 'Telemetry request';
    const key = req.headers['idempotency-key'] || crypto.randomUUID();
    if (typeof key !== 'string' || key.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(key))
      throw new Error('Invalid idempotency key');
    const scopes =
      req.operator || !publicTry
        ? []
        : [
            [req.account ? 'account:' + req.account.id : 'visitor:' + req.owner, 3],
            ['ip:' + req.quotaIp, 10],
            ['global', 20],
          ];
    const result = await submissions.submit({
      owner: req.owner,
      key,
      features,
      ttl,
      name,
      reward: publicTry ? publicReward : process.env.REWARD_ETH || publicReward,
      quotaScopes: scopes,
    });
    if (result.job) {
      res.status(201).json(publicJob(result.job));
      setTimeout(drain, 10);
    } else
      res.status(202).json({
        pending: true,
        submissionId: result.submission.id,
        requestTx: result.submission.hash,
        status: 'registering',
      });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.shortMessage || error.message });
  }
});
app.post('/api/jobs/:id/refund', async (req, res) => {
  try {
    const j = jobs.find((j) => j.id === req.params.id);
    if (!visibleJob(req, j)) return res.sendStatus(404);
    if (['proving', 'verifying'].includes(j.status))
      return res.status(409).json({ error: 'Wait for the active prover to finish' });
    const tx = await chain.contract.refund(j.id);
    const receipt = await tx.wait();
    await update(j, { status: 'refunded', refundTx: receipt.hash });
    res.json(publicJob(j));
  } catch (error) {
    res
      .status(400)
      .json({ error: error.shortMessage || 'Job must expire before a refund is possible' });
  }
});
app.post('/api/withdraw', async (req, res) => {
  if (!req.operator) return res.status(403).json({ error: 'Withdrawal is an operator action' });
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
  console.log(`Proofline: http://${host}:${http.address().port} — ${mode} chain ${chain.chainId}`);
  submissions
    .recover()
    .then(drain)
    .catch((error) => console.error('Startup reconciliation:', error.message));
});
const recoveryTimer = setInterval(
  () =>
    submissions
      .recover()
      .then(drain)
      .catch((error) => console.error('Reconciliation:', error.message)),
  5000,
);
const retentionTimer = setInterval(
  () => pruneOldData().catch((error) => console.error('History cleanup:', error.message)),
  3600000,
);
async function shutdown() {
  stopping = true;
  clearInterval(recoveryTimer);
  clearInterval(retentionTimer);
  child?.kill();
  for (const res of listeners) res.end();
  await new Promise((resolve) => http.close(resolve));
  while (active) await new Promise((resolve) => setTimeout(resolve, 25));
  await store.close();
  await chain.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
