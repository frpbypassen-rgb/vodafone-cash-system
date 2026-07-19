// services/securityService.js
// ===============================================
// 🛡️ خدمة الأمان — تتبع الأجهزة وكشف الأنشطة المشبوهة
// ===============================================
'use strict';

const { logAction } = require('./auditService');
const logger = require('../utils/logger');

// ── مخزن مؤقت للمحاولات الفاشلة (يُنقل لـ Redis لاحقاً) ──
const _failedAttempts = new Map(); // key: userId/IP → { count, firstAttempt, locked }
const _ipAttempts = new Map();     // key: IP → { count, firstAttempt }

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 30 * 60 * 1000; // 30 دقيقة
const ATTEMPT_WINDOW_MS = 30 * 60 * 1000; // 30 دقيقة
const IP_MAX_ATTEMPTS = 20;

/**
 * استخراج معلومات الجهاز من الطلب
 * @param {Object} req - Express request
 * @returns {{ ip: string, userAgent: string, deviceFingerprint: string }}
 */
const extractDeviceInfo = (req) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.ip
        || req.connection?.remoteAddress
        || 'unknown';

    const userAgent = req.headers['user-agent'] || 'unknown';

    // بصمة الجهاز البسيطة (hash of IP + UserAgent + Accept-Language)
    const crypto = require('crypto');
    const fingerprintSource = `${ip}|${userAgent}|${req.headers['accept-language'] || ''}`;
    const deviceFingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex').substring(0, 16);

    return { ip, userAgent, deviceFingerprint };
};

/**
 * تسجيل محاولة دخول فاشلة
 * @param {string} identifier - userId أو username
 * @param {Object} req
 * @returns {{ locked: boolean, remainingAttempts: number, lockExpiry: Date|null }}
 */
const recordFailedLogin = async (identifier, req) => {
    const now = Date.now();
    const { ip } = extractDeviceInfo(req);

    // تتبع المحاولات حسب المعرف
    let record = _failedAttempts.get(identifier) || { count: 0, firstAttempt: now, locked: false, lockExpiry: null };

    // إعادة تعيين إذا انتهت نافذة المحاولات
    if (now - record.firstAttempt > ATTEMPT_WINDOW_MS) {
        record = { count: 0, firstAttempt: now, locked: false, lockExpiry: null };
    }

    // إذا كان مقفلاً، تحقق من انتهاء القفل
    if (record.locked && record.lockExpiry && now > record.lockExpiry) {
        record = { count: 0, firstAttempt: now, locked: false, lockExpiry: null };
    }

    record.count++;
    const remaining = MAX_FAILED_ATTEMPTS - record.count;

    if (record.count >= MAX_FAILED_ATTEMPTS && !record.locked) {
        record.locked = true;
        record.lockExpiry = now + LOCK_DURATION_MS;

        logger.security('Account locked due to failed login attempts', {
            identifier,
            ip,
            attempts: record.count,
            lockDuration: '30 minutes'
        });

        // تسجيل في Audit Log
        await logAction({
            action: 'ACCOUNT_LOCKED',
            req,
            performedByName: identifier,
            metadata: {
                reason: 'EXCEEDED_MAX_ATTEMPTS',
                attempts: record.count,
                lockExpiry: new Date(record.lockExpiry).toISOString()
            },
            success: false,
            errorCode: 'ACCOUNT_LOCKED'
        });
    }

    _failedAttempts.set(identifier, record);

    // تتبع محاولات IP
    _trackIPAttempts(ip);

    return {
        locked: record.locked,
        remainingAttempts: Math.max(0, remaining),
        lockExpiry: record.lockExpiry ? new Date(record.lockExpiry) : null
    };
};

/**
 * تتبع محاولات IP
 */
const _trackIPAttempts = (ip) => {
    const now = Date.now();
    let record = _ipAttempts.get(ip) || { count: 0, firstAttempt: now };

    if (now - record.firstAttempt > ATTEMPT_WINDOW_MS) {
        record = { count: 0, firstAttempt: now };
    }

    record.count++;
    _ipAttempts.set(ip, record);

    if (record.count >= IP_MAX_ATTEMPTS) {
        logger.security('Suspicious IP activity detected', { ip, attempts: record.count });
    }
};

/**
 * إعادة تعيين عداد المحاولات بعد نجاح الدخول
 */
const resetFailedAttempts = (identifier) => {
    _failedAttempts.delete(identifier);
};

/**
 * التحقق مما إذا كان الحساب مقفلاً
 * @param {string} identifier
 * @returns {{ locked: boolean, lockExpiry: Date|null, remainingLockTime: number }}
 */
const isAccountLocked = (identifier) => {
    const record = _failedAttempts.get(identifier);
    if (!record || !record.locked) return { locked: false, lockExpiry: null, remainingLockTime: 0 };

    const now = Date.now();
    if (record.lockExpiry && now > record.lockExpiry) {
        // انتهى القفل
        _failedAttempts.delete(identifier);
        return { locked: false, lockExpiry: null, remainingLockTime: 0 };
    }

    return {
        locked: true,
        lockExpiry: new Date(record.lockExpiry),
        remainingLockTime: Math.ceil((record.lockExpiry - now) / 1000 / 60) // بالدقائق
    };
};

/**
 * فتح حساب مقفل يدوياً
 * @param {string} identifier
 * @param {string} adminName
 * @param {Object} req
 */
const unlockAccount = async (identifier, adminName, req) => {
    _failedAttempts.delete(identifier);

    await logAction({
        action: 'ACCOUNT_UNLOCKED',
        req,
        performedByName: adminName,
        metadata: { unlockedUser: identifier }
    });

    logger.security('Account manually unlocked', { identifier, by: adminName });
};

/**
 * كشف النشاط المشبوه
 * @param {string} userId
 * @param {string} action - نوع العملية
 * @param {Object} metadata - بيانات إضافية
 * @returns {{ suspicious: boolean, reason: string|null }}
 */
const detectSuspiciousActivity = async (userId, action, metadata = {}) => {
    // كشف التحويلات السريعة
    if (action === 'TRANSFER' && metadata.recentTransferCount) {
        if (metadata.recentTransferCount > 10) {
            logger.security('Rapid transfer activity detected', {
                userId,
                transferCount: metadata.recentTransferCount,
                period: '1 minute'
            });
            return { suspicious: true, reason: 'RAPID_TRANSFERS' };
        }
    }

    // كشف المبالغ غير العادية
    if (action === 'TRANSFER' && metadata.amount && metadata.averageAmount) {
        if (metadata.amount > metadata.averageAmount * 3) {
            logger.security('Unusual transfer amount detected', {
                userId,
                amount: metadata.amount,
                average: metadata.averageAmount
            });
            return { suspicious: true, reason: 'UNUSUAL_AMOUNT' };
        }
    }

    return { suspicious: false, reason: null };
};

/**
 * تنظيف السجلات المنتهية الصلاحية (يُستدعى دورياً)
 */
const cleanupExpiredRecords = () => {
    const now = Date.now();

    for (const [key, record] of _failedAttempts.entries()) {
        if (record.lockExpiry && now > record.lockExpiry) {
            _failedAttempts.delete(key);
        } else if (now - record.firstAttempt > ATTEMPT_WINDOW_MS && !record.locked) {
            _failedAttempts.delete(key);
        }
    }

    for (const [key, record] of _ipAttempts.entries()) {
        if (now - record.firstAttempt > ATTEMPT_WINDOW_MS) {
            _ipAttempts.delete(key);
        }
    }
};

// تنظيف تلقائي كل 5 دقائق
setInterval(cleanupExpiredRecords, 5 * 60 * 1000);

module.exports = {
    extractDeviceInfo,
    recordFailedLogin,
    resetFailedAttempts,
    isAccountLocked,
    unlockAccount,
    detectSuspiciousActivity,
    cleanupExpiredRecords
};
