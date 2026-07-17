const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { escapeRegex, verifyAndUpgradePassword } = require('../utils/helpers');
const Admin = require('../models/Admin');

const loginLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: 'تم تجاوز الحد الأقصى لمحاولات تسجيل الدخول. حاول بعد دقيقة.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
});

const cleanPanelCredential = (value) => {
    if (!value) return '';
    const cleaned = value.toString().replace(/^\uFEFF/, '').trim();
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        return cleaned.slice(1, -1).trim();
    }
    return cleaned;
};

const readPanelCredentialsFromEnvFile = () => {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return {};

    const credentials = {};
    const lines = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
    for (const line of lines) {
        const match = line.match(/^\s*(PANEL_USER|PANEL_PASS)\s*=\s*(.*)\s*$/);
        if (match) credentials[match[1]] = cleanPanelCredential(match[2]);
    }
    return credentials;
};

const getPanelCredentials = () => {
    const fileCredentials = readPanelCredentialsFromEnvFile();
    return {
        user: cleanPanelCredential(fileCredentials.PANEL_USER || process.env.PANEL_USER),
        pass: cleanPanelCredential(fileCredentials.PANEL_PASS || process.env.PANEL_PASS)
    };
};

router.get('/login', (req, res) => {
    if (req.session.isLoggedIn) return res.redirect('/');
    res.render('login', { error: null });
});

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.render('login', { error: 'يرجى إدخال اسم المستخدم وكلمة المرور.' });
        }

        const trimmedUser = username.trim();
        const trimmedPass = password.trim();

        const { user: envAdminUser, pass: envAdminPass } = getPanelCredentials();

        if (envAdminUser && envAdminPass &&
            trimmedUser.toLowerCase() === envAdminUser.toLowerCase() &&
            trimmedPass === envAdminPass) {
            req.session.isLoggedIn = true;
            req.session.adminName = 'المدير الأساسي';
            req.session.adminRole = 'master';
            req.session.adminId = 'master_admin';
            return req.session.save(() => res.redirect('/'));
        }

        const safeUsername = escapeRegex(trimmedUser);
        const usernameRegex = new RegExp(`^${safeUsername}$`, 'i');
        const adminData = await Admin.findOne({ webUsername: usernameRegex }).lean();

        if (adminData && adminData.webPassword) {
            const isMatch = await verifyAndUpgradePassword(trimmedPass, adminData.webPassword, Admin, adminData._id);

            if (isMatch) {
                req.session.isLoggedIn = true;
                req.session.adminId = adminData._id;
                req.session.adminName = adminData.name;
                req.session.adminRole = adminData.role || 'admin';
                return req.session.save(() => res.redirect('/'));
            }
        }

        if (!envAdminUser || !envAdminPass) {
            return res.render('login', { error: 'بيانات دخول الإدارة غير مضبوطة في ملف .env على السيرفر.' });
        }

        return res.render('login', { error: 'بيانات الدخول غير صحيحة.' });
    } catch (error) {
        console.error('[Login] خطأ في تسجيل الدخول:', error.message);
        return res.render('login', { error: 'حدث خطأ داخلي في الخادم.' });
    }
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

module.exports = router;
