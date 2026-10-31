import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PostgresStore } from '../server/postgres-store.mjs';

test('PostgreSQL signer waits in standby and takes over after the active lease releases', async () => {
  class FakeLease extends EventEmitter {
    constructor(acquired) {
      super();
      this.acquired = acquired;
      this.queries = [];
      this.released = false;
    }
    async query(sql) {
      this.queries.push(sql);
      return sql.includes('pg_try_advisory_lock')
        ? { rows: [{ acquired: this.acquired }] }
        : { rows: [{ pg_advisory_unlock: true }] };
    }
    release() {
      this.released = true;
    }
  }

  const contested = new FakeLease(false);
  const acquired = new FakeLease(true);
  const clients = [contested, acquired];
  const store = new PostgresStore();
  store.pool = { connect: async () => clients.shift() };
  store.isSigner = false;

  assert.equal(await store.tryAcquireLease(), false);
  assert.equal(store.isSigner, false);
  assert.equal(store.lease, undefined);
  assert.equal(contested.released, true);

  assert.equal(await store.tryAcquireLease(), true);
  assert.equal(store.isSigner, true);
  assert.equal(store.lease, acquired);
  await store.releaseLease();
  assert.equal(store.isSigner, false);
  assert.equal(store.lease, null);
  assert.equal(acquired.released, true);
  assert.ok(acquired.queries.some((query) => query.includes('pg_advisory_unlock')));
});
