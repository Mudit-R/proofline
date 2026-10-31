import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test(
  'authenticated HTTP workflow with real proof and private-input redaction',
  { timeout: 90000 },
  async (t) => {
    const directory = path.resolve('.local', 'api-test-' + randomUUID());
    const token = 'integration-only-token';
    const child = spawn(process.execPath, ['server/index.mjs'], {
      env: {
        ...process.env,
        MODE: 'demo',
        PORT: '0',
        HOST: '127.0.0.1',
        OPERATOR_TOKEN: token,
        DATA_DIR: directory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stderr.on('data', (d) => {
      logs += d;
    });
    try {
      const url = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('API startup timed out: ' + logs)),
          20000,
        );
        child.stdout.on('data', (data) => {
          const match = String(data).match(/Proofline: (http:\/\/[^ ]+)/);
          if (match) {
            clearTimeout(timeout);
            resolve(match[1]);
          }
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          reject(new Error('API exited ' + code + ': ' + logs));
        });
      });
      const call = (endpoint, options = {}) =>
        fetch(url + endpoint, {
          ...options,
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });
      await t.test('health works without leaking operator data', async () => {
        assert.equal((await fetch(url + '/healthz')).status, 200);
        assert.equal((await fetch(url + '/api/status')).status, 401);
      });
      await t.test('foreign-origin mutations are rejected', async () => {
        const r = await call('/api/jobs', {
          method: 'POST',
          headers: { Origin: 'https://untrusted.example' },
          body: JSON.stringify({ features: [1, 2, 3, 4] }),
        });
        assert.equal(r.status, 403);
      });
      await t.test('invalid feature bounds do not create jobs', async () => {
        assert.equal(
          (
            await call('/api/jobs', {
              method: 'POST',
              body: JSON.stringify({ features: [101, 1, 2, 3] }),
            })
          ).status,
          400,
        );
        assert.equal((await (await call('/api/jobs')).json()).length, 0);
      });
      await t.test('live server telemetry is bounded', async () => {
        const telemetry = await (await call('/api/telemetry')).json();
        assert.equal(telemetry.features.length, 4);
        assert.ok(telemetry.features.every((v) => Number.isInteger(v) && v >= 0 && v <= 100));
      });
      const request = await call('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ name: 'API integration', features: [35, 42, 4, 20] }),
      });
      assert.equal(request.status, 201);
      const job = await request.json();
      assert.equal('features' in job, false);
      assert.equal('salt' in job, false);
      let settled;
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const all = await (await call('/api/jobs')).json();
        settled = all.find((j) => j.id === job.id);
        if (['settled', 'failed'].includes(settled.status)) break;
        await new Promise((r) => setTimeout(r, 300));
      }
      await t.test('API request settles a real proof', () => {
        assert.equal(settled.status, 'settled', settled.error);
        assert.equal(settled.risk, 0);
        assert.ok(settled.settleTx);
        assert.ok(BigInt(settled.gasUsed) > 0n);
        assert.ok(settled.checks.every((c) => c.rejected));
      });
      await t.test(
        'download contains proof but excludes private feature values and salt',
        async () => {
          const response = await call('/api/jobs/' + job.id + '/bundle');
          assert.equal(response.status, 200);
          const b = await response.json();
          assert.equal(b.job.proof.protocol, 'groth16');
          assert.equal(b.verificationKey.nPublic, 9);
          assert.equal('features' in b.job, false);
          assert.equal('salt' in b.job, false);
        },
      );
      await t.test('transaction inspection returns actual settlement receipt', async () => {
        const receipt = await (await call('/api/transactions/' + settled.settleTx)).json();
        assert.equal(receipt.status, 1);
        assert.equal(receipt.hash, settled.settleTx);
        assert.ok(receipt.events.some((e) => e.name === 'Settled'));
      });
      await t.test('withdrawal updates actual worker credit', async () => {
        assert.equal((await call('/api/withdraw', { method: 'POST', body: '{}' })).status, 200);
        const status = await (await call('/api/status')).json();
        assert.equal(status.workerCredit, '0.0');
      });
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => {
        if (child.exitCode !== null) r();
        else child.once('exit', r);
      });
    }
  },
);
