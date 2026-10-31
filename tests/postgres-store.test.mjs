import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresStore } from '../server/postgres-store.mjs';

const databaseUrl = process.env.PROOFLINE_TEST_DATABASE_URL;

test(
  'PostgreSQL store serializes signers, transactions quotas atomically, and prunes terminal data',
  { skip: !databaseUrl },
  async () => {
    assert.ok(new URL(databaseUrl).pathname.endsWith('_test'), 'Use a dedicated test database');
    const store = await PostgresStore.open(databaseUrl);
    try {
      await assert.rejects(() => PostgresStore.open(databaseUrl), /Another Proofline signer/);
      const suffix = randomUUID();
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      const old = new Date(Date.now() - 8 * 86400000).toISOString();
      const recent = new Date().toISOString();
      const oldJob = 'old-' + suffix;
      const activeJob = 'active-' + suffix;
      const oldSubmission = 'confirmed-' + suffix;
      const pendingSubmission = 'signed-' + suffix;
      await store.saveJob({ id: oldJob, status: 'settled', createdAt: old });
      await store.saveJob({ id: activeJob, status: 'queued', createdAt: old });
      await store.saveSubmission({
        id: oldSubmission,
        owner: 'visitor',
        idempotency: oldSubmission,
        digest: suffix,
        state: 'confirmed',
        createdAt: old,
      });
      await store.saveSubmission({
        id: pendingSubmission,
        owner: 'visitor',
        idempotency: pendingSubmission,
        digest: suffix,
        state: 'signed',
        createdAt: old,
      });
      await store.saveJob({ id: 'recent-' + suffix, status: 'settled', createdAt: recent });

      const scope = 'visitor:' + suffix;
      const day = new Date().toISOString().slice(0, 10);
      await store.consumeQuotas([
        [scope, 1],
        ['global:' + suffix, 2],
      ]);
      await assert.rejects(
        () =>
          store.consumeQuotas([
            [scope, 1],
            ['global:' + suffix, 2],
          ]),
        {
          status: 429,
        },
      );
      const globalQuota = await store.pool.query(
        'SELECT count FROM proofline.quotas WHERE scope=$1 AND day=$2',
        ['global:' + suffix, day],
      );
      assert.equal(
        globalQuota.rows[0].count,
        1,
        'failed quota transaction must roll back every scope',
      );

      const removed = await store.prune(cutoff);
      assert.ok(removed.includes(oldJob));
      const jobs = await store.jobs();
      assert.ok(
        jobs.some((job) => job.id === activeJob),
        'in-flight work is retained',
      );
      assert.ok(jobs.some((job) => job.id === 'recent-' + suffix));
      const submissions = await store.submissions();
      assert.ok(!submissions.some((submission) => submission.id === oldSubmission));
      assert.ok(submissions.some((submission) => submission.id === pendingSubmission));
    } finally {
      await store.close();
    }
  },
);
