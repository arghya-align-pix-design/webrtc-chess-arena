import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL ||
        'postgresql://postgres:postgres123@localhost:5432/chessvid',
    max: 10,                // max 10 simultaneous connections in pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
    console.log('[Postgres] Client connected from pool');
});

pool.on('error', (err) => {
    console.error('[Postgres] Unexpected pool error:', err);
});

// Test connection on startup
pool.query('SELECT 1').then(() => {
    console.log('[Postgres] Connection verified successfully');
}).catch((err) => {
    console.error('[Postgres] Failed to connect:', err.message);
});

export const db = drizzle(pool, { schema });
export { pool };