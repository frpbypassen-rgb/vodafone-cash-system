// config/redis.js
// ===============================================
// 🗄️ Redis Connection — مع fallback لـ in-memory cache
// ===============================================
'use strict';

const logger = require('../utils/logger');

// ── In-Memory Fallback Cache ──────────────────────────
class MemoryCache {
    constructor() {
        this._store = new Map();
        this._timers = new Map();
    }

    async get(key) {
        const item = this._store.get(key);
        if (!item) return null;
        if (item.expiry && Date.now() > item.expiry) {
            this._store.delete(key);
            return null;
        }
        return item.value;
    }

    async set(key, value, ttlSeconds) {
        const expiry = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null;
        this._store.set(key, { value, expiry });

        // تنظيف تلقائي
        if (ttlSeconds) {
            const existing = this._timers.get(key);
            if (existing) clearTimeout(existing);
            this._timers.set(key, setTimeout(() => this._store.delete(key), ttlSeconds * 1000));
        }
    }

    async del(key) {
        this._store.delete(key);
        const timer = this._timers.get(key);
        if (timer) { clearTimeout(timer); this._timers.delete(key); }
    }

    async incr(key) {
        const current = await this.get(key);
        const newVal = (parseInt(current) || 0) + 1;
        const item = this._store.get(key);
        const ttl = item && item.expiry ? Math.ceil((item.expiry - Date.now()) / 1000) : null;
        await this.set(key, newVal.toString(), ttl);
        return newVal;
    }

    async expire(key, ttlSeconds) {
        const item = this._store.get(key);
        if (item) {
            item.expiry = Date.now() + (ttlSeconds * 1000);
            const existing = this._timers.get(key);
            if (existing) clearTimeout(existing);
            this._timers.set(key, setTimeout(() => this._store.delete(key), ttlSeconds * 1000));
        }
    }

    async flushAll() {
        this._store.clear();
        for (const timer of this._timers.values()) clearTimeout(timer);
        this._timers.clear();
    }
}

// ── Redis Connection ──────────────────────────────────
let redisClient = null;
let isRedisAvailable = false;

const initRedis = async () => {
    const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_URI;

    if (!REDIS_URL) {
        logger.info('⚠️ Redis URL not configured — using in-memory cache fallback');
        redisClient = new MemoryCache();
        return redisClient;
    }

    try {
        // Dynamic import لتجنب crash إذا لم يكن ioredis مثبتاً
        const Redis = require('ioredis');
        redisClient = new Redis(REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                if (times > 3) {
                    logger.warn('Redis connection failed — falling back to in-memory cache');
                    redisClient = new MemoryCache();
                    isRedisAvailable = false;
                    return null;
                }
                return Math.min(times * 200, 2000);
            },
            lazyConnect: true
        });

        await redisClient.connect();
        isRedisAvailable = true;
        logger.info('✅ Redis connected successfully');
        return redisClient;
    } catch (error) {
        logger.warn(`⚠️ Redis unavailable: ${error.message} — using in-memory cache`);
        redisClient = new MemoryCache();
        isRedisAvailable = false;
        return redisClient;
    }
};

const getRedisClient = () => {
    if (!redisClient) redisClient = new MemoryCache();
    return redisClient;
};

const isRedis = () => isRedisAvailable;

module.exports = { initRedis, getRedisClient, isRedis };
