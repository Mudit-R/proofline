import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class Store {
  static async open(directory) {
    if (process.env.DATABASE_URL) {
      const { PostgresStore } = await import('./postgres-store.mjs');
      return PostgresStore.open(process.env.DATABASE_URL);
    }
    return new Store(directory);
  }
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'jobs.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,idempotency TEXT NOT NULL,digest TEXT NOT NULL,record TEXT NOT NULL,UNIQUE(owner,idempotency));
      CREATE TABLE IF NOT EXISTS quotas(scope TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(scope,day));`);
  }
  jobs() {
    return this.db
      .prepare('SELECT record FROM jobs ORDER BY rowid')
      .all()
      .map((r) => JSON.parse(r.record));
  }
  saveJob(j) {
    j.updatedAt = new Date().toISOString();
    this.db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?)').run(j.id, JSON.stringify(j));
  }
  submission(owner, key) {
    const r = this.db
      .prepare('SELECT record FROM submissions WHERE owner=? AND idempotency=?')
      .get(owner, key);
    return r ? JSON.parse(r.record) : null;
  }
  submissions() {
    return this.db
      .prepare('SELECT record FROM submissions')
      .all()
      .map((r) => JSON.parse(r.record));
  }
  saveSubmission(s) {
    this.db
      .prepare(
        'INSERT INTO submissions VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record',
      )
      .run(s.id, s.owner, s.idempotency, s.digest, JSON.stringify(s));
  }
  prune(cutoff) {
    const terminal = new Set(['settled', 'failed', 'expired', 'refunded']);
    const removed = this.db
      .prepare('SELECT id,record FROM jobs')
      .all()
      .filter(
        (r) => terminal.has(JSON.parse(r.record).status) && JSON.parse(r.record).createdAt < cutoff,
      )
      .map((r) => r.id);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const removeJob = this.db.prepare('DELETE FROM jobs WHERE id=?');
      for (const id of removed) removeJob.run(id);
      for (const submission of this.submissions()) {
        if (['confirmed', 'failed'].includes(submission.state) && submission.createdAt < cutoff)
          this.db.prepare('DELETE FROM submissions WHERE id=?').run(submission.id);
      }
      this.db.prepare('DELETE FROM quotas WHERE day < ?').run(cutoff.slice(0, 10));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return removed;
  }
  consumeQuotas(scopes) {
    const day = new Date().toISOString().slice(0, 10);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [scope, max] of scopes) {
        const current =
          this.db.prepare('SELECT count FROM quotas WHERE scope=? AND day=?').get(scope, day)
            ?.count || 0;
        if (current >= max)
          throw Object.assign(new Error('Daily sponsored request limit reached'), { status: 429 });
        this.db
          .prepare(
            'INSERT INTO quotas VALUES(?,?,1) ON CONFLICT(scope,day) DO UPDATE SET count=count+1',
          )
          .run(scope, day);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
