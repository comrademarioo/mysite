// Shared Postgres connection for pipeline scripts.
// Override with DATABASE_URL, e.g. postgres://user:pass@host:5432/skivio
import pg from 'pg';

export function getPool() {
  const connectionString =
    process.env.DATABASE_URL || 'postgres://skivio:skivio@127.0.0.1:5432/skivio';
  return new pg.Pool({ connectionString });
}
