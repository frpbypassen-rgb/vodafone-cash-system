const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
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

        const envAdminUser = (process.env.PANEL_USER || '').trim();
        const envAdminPass = (process.env.PANEL_PASS || '').trim();

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

        return res.render('login', { error: 'بيانات الدخول غير صحيحة.' });
    } catch (error) {
        console.error('[Login] خطأ في تسجيل الدخول:', error.message);
        return res.render('login', { error: 'حدث خطأ داخلي في الخادم.' });
    }
});

router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

module.exports = router;
