// services/cacheService.js
// ===============================================
// 🗄️ خدمة التخزين المؤقت — Cache Service
// ===============================================
'use strict';

const { getRedisClient } = require('../config/redis');

/**
 * تخزين/جلب إعدادات النظام (تتغير نادراً)
 */
const cacheSettings = async (settings = null) => {
    const client = getRedisClient();
    const KEY = 'ahram:settings';

    if (settings) {
        await client.set(KEY, JSON.stringify(settings), 60); // 60 ثانية
        return settings;
    }

    const cached = await client.get(KEY);
    return cached ? JSON.parse(cached) : null;
};

/**
 * تخزين/جلب سعر الصرف حسب المستوى
 */
const cacheExchangeRate = async (tier, rate = null) => {
    const client = getRedisClient();
    const KEY = `ahram:rate:tier${tier}`;

    if (rate !== null) {
        await client.set(KEY, rate.toString(), 30); // 30 ثانية
        return rate;
    }

    const cached = await client.get(KEY);
    return cached ? parseFloat(cached) : null;
};

/**
 * OTP مع TTL
 */
const cacheOTP = async (phone, otp = null, ttlSeconds = 300) => {
    const client = getRedisClient();
    const KEY = `ahram:otp:${phone}`;

    if (otp) {
        await client.set(KEY, otp.toString(), ttlSeconds);
        return otp;
    }

    return client.get(KEY);
};

/**
 * التحقق من OTP
 */
const verifyOTP = async (phone, inputOtp) => {
    const stored = await cacheOTP(phone);
    if (!stored) return { valid: false, reason: 'EXPIRED' };
    if (stored !== inputOtp) return { valid: false, reason: 'MISMATCH' };

    // حذف بعد الاستخدام
    const client = getRedisClient();
    await client.del(`ahram:otp:${phone}`);
    return { valid: true };
};

/**
 * Rate Limiter متقدم
 * @param {string} key - المفتاح (مثلاً: IP + path)
 * @param {number} maxRequests - الحد الأقصى
 * @param {number} windowSeconds - نافذة الوقت
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
const rateLimitByKey = async (key, maxRequests, windowSeconds) => {
    const client = getRedisClient();
    const RATE_KEY = `ahram:rl:${key}`;

    const current = await client.incr(RATE_KEY);
    if (current === 1) {
        await client.expire(RATE_KEY, windowSeconds);
    }

    const remaining = Math.max(0, maxRequests - current);
    const allowed = current <= maxRequests;

    return {
        allowed,
        remaining,
        retryAfter: allowed ? 0 : windowSeconds,
        current
    };
};

/**
 * إبطال جميع الكاش
 */
const invalidateAll = async () => {
    const client = getRedisClient();
    if (client.flushAll) await client.flushAll();
};

module.exports = {
    cacheSettings,
    cacheExchangeRate,
    cacheOTP,
    verifyOTP,
    rateLimitByKey,
    invalidateAll
};
