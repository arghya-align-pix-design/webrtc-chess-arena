import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('connect', () => {
    console.log('[Redis] Connected successfully');
});

redis.on('error', (err) => {
    console.error('[Redis] Connection error:', err);
});

redis.on('reconnecting', () => {
    console.log('[Redis] Reconnecting...');
});

export default redis;