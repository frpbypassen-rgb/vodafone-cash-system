// controllers/auth/authController.js
// ===============================================
// 🔐 Controller — المصادقة (طبقة رقيقة)
// ===============================================
'use strict';

const authService = require('../../services/authService');

/**
 * POST /login
 */
const login = async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await authService.login(username, password, req);
        return res.status(result.statusCode).json(result);
    } catch (error) {
        return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'خطأ في السيرفر' });
    }
};

/**
 * POST /refresh-token
 */
const refreshToken = async (req, res) => {
    try {
        const result = await authService.refreshAccessToken(req.body.refreshToken, req);
        return res.status(result.statusCode).json(result);
    } catch (error) {
        return res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'خطأ في السيرفر' });
    }
};

/**
 * POST /logout
 */
const logout = async (req, res) => {
    try {
        const { userId, accountType } = req.user;
        const result = await authService.logout(userId, accountType);
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'خطأ داخلي' });
    }
};

module.exports = { login, refreshToken, logout };
