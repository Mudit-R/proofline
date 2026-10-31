import pg from 'pg';

export class PostgresStore {
  static async open(url) {
    const store = new PostgresStore();
    store.pool = new pg.Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });
    await store.pool.query(`CREATE SCHEMA IF NOT EXISTS proofline;
      REVOKE ALL ON SCHEMA proofline FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS proofline.jobs(id TEXT PRIMARY KEY,record JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS proofline.submissions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,idempotency TEXT NOT NULL,digest TEXT NOT NULL,record JSONB NOT NULL,UNIQUE(owner,idempotency));
      CREATE TABLE IF NOT EXISTS proofline.quotas(scope TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(scope,day));
      CREATE TABLE IF NOT EXISTS proofline.users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS proofline.sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES proofline.users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),expires_at TIMESTAMPTZ NOT NULL);
      CREATE INDEX IF NOT EXISTS proofline_sessions_expiry ON proofline.sessions(expires_at);`);
    store.isSigner = false;
    store.signerReady = false;
    await store.tryAcquireLease();
    return store;
  }
  async tryAcquireLease() {
    if (this.lease) return true;
    const lease = await this.pool.connect();
    try {
      const locked = await lease.query(
        "SELECT pg_try_advisory_lock(hashtext('proofline-single-signer')) AS acquired",
      );
      if (!locked.rows[0].acquired) {
        lease.release();
        this.isSigner = false;
        return false;
      }
      this.lease = lease;
      this.isSigner = true;
      lease.on('error', () => {
        console.error('Signer database lease lost; exiting to prevent conflicting writers');
        process.exit(1);
      });
      return true;
    } catch (error) {
      lease.release(error);
      throw error;
    }
  }
  async releaseLease() {
    if (!this.lease) {
      this.isSigner = false;
      return;
    }
    const lease = this.lease;
    this.lease = null;
    this.isSigner = false;
    this.signerReady = false;
    try {
      await lease.query("SELECT pg_advisory_unlock(hashtext('proofline-single-signer'))");
      lease.release();
    } catch (error) {
      lease.release(error);
      throw error;
    }
  }
  async jobs() {
    return (
      await this.pool.query('SELECT record FROM proofline.jobs ORDER BY created_at')
    ).rows.map((r) => r.record);
  }
  async saveJob(j) {
    j.updatedAt = new Date().toISOString();
    await this.pool.query(
      'INSERT INTO proofline.jobs(id,record) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET record=excluded.record',
      [j.id, JSON.stringify(j)],
    );
  }
  async submission(owner, key) {
    return (
      (
        await this.pool.query(
          'SELECT record FROM proofline.submissions WHERE owner=$1 AND idempotency=$2',
          [owner, key],
        )
      ).rows[0]?.record || null
    );
  }
  async submissions() {
    return (await this.pool.query('SELECT record FROM proofline.submissions')).rows.map(
      (r) => r.record,
    );
  }
  async saveSubmission(s) {
    await this.pool.query(
      'INSERT INTO proofline.submissions VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET record=excluded.record',
      [s.id, s.owner, s.idempotency, s.digest, JSON.stringify(s)],
    );
  }
  async consumeQuotas(scopes) {
    const connection = await this.pool.connect(),
      day = new Date().toISOString().slice(0, 10);
    try {
      await connection.query('BEGIN');
      for (const [scope, max] of scopes) {
        const r = await connection.query(
          'INSERT INTO proofline.quotas VALUES($1,$2,1) ON CONFLICT(scope,day) DO UPDATE SET count=proofline.quotas.count+1 WHERE proofline.quotas.count<$3 RETURNING count',
          [scope, day, max],
        );
        if (r.rowCount !== 1)
          throw Object.assign(new Error('Daily sponsored request limit reached'), { status: 429 });
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
  async createUser(user) {
    const result = await this.pool.query(
      'INSERT INTO proofline.users(id,email,password_salt,password_hash,created_at) VALUES($1,$2,$3,$4,$5) RETURNING id,email,created_at AS "createdAt"',
      [user.id, user.email, user.passwordSalt, user.passwordHash, user.createdAt],
    );
    return result.rows[0];
  }
  async userByEmail(email) {
    return (
      (
        await this.pool.query(
          'SELECT id,email,password_salt AS "passwordSalt",password_hash AS "passwordHash",created_at AS "createdAt" FROM proofline.users WHERE email=$1',
          [email],
        )
      ).rows[0] || null
    );
  }
  async userById(id) {
    return (
      (
        await this.pool.query(
          'SELECT id,email,created_at AS "createdAt" FROM proofline.users WHERE id=$1',
          [id],
        )
      ).rows[0] || null
    );
  }
  async createSession(session) {
    await this.pool.query(
      'INSERT INTO proofline.sessions(token_hash,user_id,created_at,expires_at) VALUES($1,$2,$3,$4)',
      [session.tokenHash, session.userId, session.createdAt, session.expiresAt],
    );
  }
  async userForSession(tokenHash, now) {
    return (
      (
        await this.pool.query(
          `SELECT u.id,u.email,u.created_at AS "createdAt"
           FROM proofline.sessions s JOIN proofline.users u ON u.id=s.user_id
           WHERE s.token_hash=$1 AND s.expires_at>$2`,
          [tokenHash, now],
        )
      ).rows[0] || null
    );
  }
  async revokeSession(tokenHash) {
    await this.pool.query('DELETE FROM proofline.sessions WHERE token_hash=$1', [tokenHash]);
  }
  async pruneSessions(now) {
    await this.pool.query('DELETE FROM proofline.sessions WHERE expires_at<=$1', [now]);
  }
  async prune(cutoff) {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const jobs = await connection.query(
        "DELETE FROM proofline.jobs WHERE record->>'createdAt' < $1 AND record->>'status'=ANY($2::text[]) RETURNING id",
        [cutoff, ['settled', 'failed', 'expired', 'refunded']],
      );
      await connection.query(
        "DELETE FROM proofline.submissions WHERE record->>'createdAt' < $1 AND record->>'state'=ANY($2::text[])",
        [cutoff, ['confirmed', 'failed']],
      );
      await connection.query('DELETE FROM proofline.quotas WHERE day < $1', [cutoff.slice(0, 10)]);
      await connection.query('COMMIT');
      return jobs.rows.map((r) => r.id);
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
  async close() {
    await this.releaseLease();
    await this.pool.end();
  }
}
