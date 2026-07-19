// services/authService.js
// ===============================================
// 🔐 خدمة المصادقة — تسجيل الدخول والخروج وتجديد التوكن
// ===============================================
'use strict';

const jwt = require('jsonwebtoken');
const { JWT_SECRET, JWT_REFRESH_SECRET } = require('../middlewares/jwtAuth');
const userRepo = require('../repositories/userRepository');
const settingsRepo = require('../repositories/settingsRepository');
const { logAction } = require('./auditService');
const { getRateForTier } = require('../utils/rateHelper');
const {
    recordFailedLogin,
    resetFailedAttempts,
    isAccountLocked,
    extractDeviceInfo
} = require('./securityService');
const ClientBot = require('../models/ClientBot');

/**
 * تسجيل الدخول
 * @param {string} username
 * @param {string} password
 * @param {Object} req - Express request (لتتبع IP/UserAgent)
 * @returns {Promise<Object>} نتيجة تسجيل الدخول
 */
const login = async (username, password, req) => {
    // 1. التحقق من قفل الحساب
    const lockStatus = isAccountLocked(username);
    if (lockStatus.locked) {
        await logAction({
            action: 'LOGIN_FAILED',
            req,
            performedByName: username,
            metadata: { reason: 'ACCOUNT_LOCKED', remainingMinutes: lockStatus.remainingLockTime },
            success: false,
            errorCode: 'ACCOUNT_LOCKED'
        });
        return {
            success: false,
            statusCode: 423,
            code: 'ACCOUNT_LOCKED',
            message: `الحساب مقفل مؤقتاً. يرجى المحاولة بعد ${lockStatus.remainingLockTime} دقيقة`
        };
    }

    // 2. البحث عن الحساب والمصادقة
    const result = await userRepo.findByCredentials(username, password);

    if (!result) {
        const failResult = await recordFailedLogin(username, req);
        await logAction({
            action: 'LOGIN_FAILED',
            req,
            performedByName: username,
            metadata: { reason: 'INVALID_CREDENTIALS', remainingAttempts: failResult.remainingAttempts },
            success: false,
            errorCode: 'INVALID_CREDENTIALS'
        });
        return {
            success: false,
            statusCode: 401,
            code: 'INVALID_CREDENTIALS',
            message: 'بيانات الدخول غير صحيحة'
        };
    }

    if (result.error === 'ACCOUNT_BANNED') {
        await logAction({
            action: 'LOGIN_FAILED',
            req,
            performedByName: username,
            metadata: { reason: 'ACCOUNT_BANNED', accountType: result.accountType },
            success: false,
            errorCode: 'ACCOUNT_BANNED'
        });
        return {
            success: false,
            statusCode: 403,
            code: 'ACCOUNT_BANNED',
            message: 'الحساب معلق'
        };
    }

    // 3. نجاح المصادقة → توليد التوكنات
    const { account, accountType, telegramId, executorBotId, balance } = result;
    resetFailedAttempts(username);

    const accessToken = jwt.sign(
        { userId: account._id, accountType, telegramId, executorBotId },
        JWT_SECRET,
        { expiresIn: '1h' }
    );
    const refreshToken = jwt.sign(
        { userId: account._id, accountType },
        JWT_REFRESH_SECRET,
        { expiresIn: '30d' }
    );

    // حفظ refresh token
    await userRepo.updateRefreshToken(account._id, accountType, refreshToken);

    // 4. حساب سعر الصرف
    const settings = await settingsRepo.getSettings();
    let tier = 1;
    if (accountType === 'client_company') {
        const company = await ClientBot.findById(account.clientBotId);
        tier = (company && company.tier) ? company.tier : 1;
    } else if (accountType === 'client_user') {
        tier = account.tier || 1;
    }
    const currentRate = getRateForTier(tier, settings);

    // 5. تسجيل في Audit Log
    await logAction({
        action: 'LOGIN_SUCCESS',
        req,
        performedById: account._id,
        performedByModel: userRepo.getModelName(accountType),
        performedByName: account.name,
        metadata: { accountType, ...extractDeviceInfo(req) }
    });

    return {
        success: true,
        statusCode: 200,
        accessToken,
        refreshToken,
        user: {
            name: account.name,
            balance,
            tier
        },
        rate: currentRate
    };
};

/**
 * تجديد توكن الوصول
 * @param {string} refreshToken
 * @param {Object} req
 */
const refreshAccessToken = async (refreshToken, req) => {
    return new Promise((resolve) => {
        jwt.verify(refreshToken, JWT_REFRESH_SECRET, async (err, decoded) => {
            if (err) {
                return resolve({
                    success: false,
                    statusCode: 403,
                    code: 'TOKEN_INVALID',
                    message: 'توكن غير صالح أو منتهي'
                });
            }

            try {
                const { userId, accountType } = decoded;
                const account = await userRepo.findById(userId, accountType);

                if (!account || account.refreshToken !== refreshToken || account.status !== 'active') {
                    await logAction({
                        action: 'TOKEN_REFRESH',
                        req,
                        performedById: userId,
                        performedByModel: userRepo.getModelName(accountType),
                        success: false,
                        errorCode: 'SESSION_REVOKED'
                    });
                    return resolve({
                        success: false,
                        statusCode: 403,
                        code: 'SESSION_REVOKED',
                        message: 'تم إبطال الجلسة'
                    });
                }

                const telegramId = account.telegramId;
                const executorBotId = accountType === 'executor' && account.botId ? account.botId._id : null;
                const newAccessToken = jwt.sign(
                    { userId: account._id, accountType, telegramId, executorBotId },
                    JWT_SECRET,
                    { expiresIn: '1h' }
                );

                resolve({ success: true, statusCode: 200, token: newAccessToken });
            } catch (e) {
                resolve({
                    success: false,
                    statusCode: 500,
                    code: 'SERVER_ERROR',
                    message: 'خطأ في السيرفر'
                });
            }
        });
    });
};

/**
 * تسجيل الخروج
 * @param {string} userId
 * @param {string} accountType
 */
const logout = async (userId, accountType) => {
    await userRepo.clearRefreshToken(userId, accountType);
    return { success: true, message: 'تم تسجيل الخروج وإبطال الجلسة' };
};

module.exports = { login, refreshAccessToken, logout };
