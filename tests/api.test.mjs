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
        SESSION_SECRET: 'integration-only-session-secret',
        PUBLIC_TRY: 'true',
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
        const publicStatus = await fetch(url + '/api/status');
        assert.equal(publicStatus.status, 200);
        assert.equal((await publicStatus.json()).operator, false);
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
      const authRequest = (endpoint, options = {}) =>
        fetch(url + endpoint, {
          ...options,
          headers: { 'Content-Type': 'application/json', ...options.headers },
        });
      const firstAccountResponse = await authRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'Proofline.User@example.com',
          password: 'test-password-123',
        }),
      });
      assert.equal(firstAccountResponse.status, 201);
      const firstAccount = await firstAccountResponse.json();
      const firstAccountCookie = firstAccountResponse.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('proofline_auth='))
        .split(';')[0];
      const accountCall = (cookie, endpoint, options = {}) =>
        authRequest(endpoint, {
          ...options,
          headers: { Cookie: cookie, ...options.headers },
        });
      await t.test(
        'account signup creates a persistent session and normalized identity',
        async () => {
          assert.equal(firstAccount.user.email, 'proofline.user@example.com');
          assert.equal(
            (await (await accountCall(firstAccountCookie, '/api/auth/me')).json()).user.id,
            firstAccount.user.id,
          );
          assert.equal(
            (
              await accountCall(firstAccountCookie, '/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                  email: firstAccount.user.email,
                  password: 'wrong-password-123',
                }),
              })
            ).status,
            401,
          );
        },
      );
      const accountJobResponse = await accountCall(firstAccountCookie, '/api/jobs', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'account-private-request-1' },
        body: JSON.stringify({ name: 'Private account request', features: [35, 42, 4, 20] }),
      });
      assert.equal(accountJobResponse.status, 201);
      const accountJob = await accountJobResponse.json();
      const secondAccountResponse = await authRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: 'second.user@example.com',
          password: 'another-password-456',
        }),
      });
      assert.equal(secondAccountResponse.status, 201);
      const secondAccountCookie = secondAccountResponse.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('proofline_auth='))
        .split(';')[0];
      await t.test('account request history is isolated between signed-in users', async () => {
        assert.ok(
          (await (await accountCall(firstAccountCookie, '/api/jobs')).json()).some(
            (j) => j.id === accountJob.id,
          ),
        );
        assert.equal(
          (await (await accountCall(secondAccountCookie, '/api/jobs')).json()).length,
          0,
        );
        assert.equal(
          (await accountCall(secondAccountCookie, `/api/jobs/${accountJob.id}/bundle`)).status,
          404,
        );
        const duplicate = await authRequest('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            email: 'PROOFLINE.USER@example.com',
            password: 'test-password-123',
          }),
        });
        assert.equal(duplicate.status, 409);
      });
      const loginResponse = await authRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'PROOFLINE.USER@example.com',
          password: 'test-password-123',
        }),
      });
      assert.equal(loginResponse.status, 200);
      const loginCookie = loginResponse.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('proofline_auth='))
        .split(';')[0];
      await t.test('login restores the account and logout revokes its session', async () => {
        assert.ok(
          (await (await accountCall(loginCookie, '/api/jobs')).json()).some(
            (j) => j.id === accountJob.id,
          ),
        );
        assert.equal(
          (await accountCall(loginCookie, '/api/auth/logout', { method: 'POST' })).status,
          200,
        );
        assert.equal((await (await accountCall(loginCookie, '/api/auth/me')).json()).user, null);
      });
      const firstVisitor = await fetch(url + '/api/status');
      const visitorCookie = firstVisitor.headers.getSetCookie()[0].split(';')[0];
      const visitorCall = (endpoint, options = {}) =>
        fetch(url + endpoint, {
          ...options,
          headers: {
            Cookie: visitorCookie,
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });
      await t.test(
        'public sessions are isolated and operator-only telemetry stays private',
        async () => {
          const guestStatus = await (await visitorCall('/api/status')).json();
          assert.equal(guestStatus.operator, false);
          assert.equal(guestStatus.publicTry, true);
          assert.equal(guestStatus.reward, '0.000001');
          assert.equal(guestStatus.sponsoredLimits.globalPerDay, 20);
          assert.equal((await visitorCall('/api/telemetry')).status, 403);
        },
      );
      const publicRequest = await visitorCall('/api/jobs', {
        method: 'POST',
        headers: { 'Idempotency-Key': 'visitor-owned-request-1' },
        body: JSON.stringify({ name: 'Visitor pilot', features: [35, 42, 4, 20] }),
      });
      assert.equal(publicRequest.status, 201);
      const publicJob = await publicRequest.json();
      const secondVisitorResponse = await fetch(url + '/api/status');
      const secondVisitorCookie = secondVisitorResponse.headers.getSetCookie()[0].split(';')[0];
      const secondVisitorJobs = await fetch(url + '/api/jobs', {
        headers: { Cookie: secondVisitorCookie },
      });
      await t.test(
        'public visitor requests stay private to their signed browser session',
        async () => {
          assert.equal((await secondVisitorJobs.json()).length, 0);
          assert.equal(
            (
              await fetch(url + `/api/jobs/${publicJob.id}/bundle`, {
                headers: { Cookie: secondVisitorCookie },
              })
            ).status,
            404,
          );
          const own = await (await visitorCall('/api/jobs')).json();
          assert.ok(own.some((j) => j.id === publicJob.id));
        },
      );
      const request = await call('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ name: 'API integration', features: [35, 42, 4, 20] }),
      });
      assert.equal(request.status, 201);
      const job = await request.json();
      assert.equal('features' in job, false);
      assert.equal('salt' in job, false);
      await t.test('a public visitor cannot discover operator requests', async () => {
        const guestJobs = await (await visitorCall('/api/jobs')).json();
        assert.equal(guestJobs.length, 1);
        assert.equal(guestJobs[0].id, publicJob.id);
        assert.equal((await visitorCall(`/api/jobs/${job.id}/bundle`)).status, 404);
      });
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
