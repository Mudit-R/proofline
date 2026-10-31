import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/store.mjs';

test('retention removes old terminal records while preserving in-flight work', () => {
  const root = path.resolve('.local');
  const directory = path.join(root, 'store-test-' + randomUUID());
  assert.ok(directory.startsWith(root + path.sep));
  let store;
  try {
    store = new Store(directory);
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const old = new Date(Date.now() - 8 * 86400000).toISOString();
    const recent = new Date().toISOString();
    store.saveJob({ id: 'old-settled', status: 'settled', createdAt: old });
    store.saveJob({ id: 'old-queued', status: 'queued', createdAt: old });
    store.saveJob({ id: 'recent-settled', status: 'settled', createdAt: recent });
    store.saveSubmission({
      id: 'old-confirmed',
      owner: 'visitor',
      idempotency: 'confirmed',
      digest: 'digest',
      state: 'confirmed',
      createdAt: old,
    });
    store.saveSubmission({
      id: 'old-signed',
      owner: 'visitor',
      idempotency: 'pending',
      digest: 'digest',
      state: 'signed',
      createdAt: old,
    });
    store.db.prepare('INSERT INTO quotas VALUES(?,?,?)').run('visitor:old', '2000-01-01', 1);
    store.db.prepare('INSERT INTO quotas VALUES(?,?,?)').run('visitor:new', '2099-01-01', 1);

    assert.deepEqual(store.prune(cutoff), ['old-settled']);
    assert.deepEqual(
      store.jobs().map((job) => job.id).sort(),
      ['old-queued', 'recent-settled'],
    );
    assert.deepEqual(
      store.submissions().map((submission) => submission.id).sort(),
      ['old-signed'],
    );
    assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM quotas').get().count, 1);
  } finally {
    store?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
