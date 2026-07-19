// routes/auditLog.js
// صفحة سجل التدقيق الشامل لمتابعة جميع الحركات داخل المنظومة
'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/auth');
const AuditLog = require('../models/AuditLog');

// ── عرض صفحة Audit Log ──────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
    try {
        const page      = Math.max(1, parseInt(req.query.page)  || 1);
        const limit     = Math.min(100, parseInt(req.query.limit) || 50);
        const skip      = (page - 1) * limit;

        // فلاتر البحث
        const action        = req.query.action    || '';
        const dateFrom      = req.query.dateFrom  || '';
        const dateTo        = req.query.dateTo    || '';
        const performedBy   = req.query.performedBy || '';
        const success       = req.query.success;

        const filter = {};
        if (action)       filter.action = action;
        if (performedBy)  filter.performedByName = { $regex: performedBy, $options: 'i' };
        if (success !== undefined && success !== '') filter.success = success === 'true';
        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.$gte = new Date(dateFrom + 'T00:00:00.000Z');
            if (dateTo)   filter.createdAt.$lte = new Date(dateTo   + 'T23:59:59.999Z');
        }

        const [logs, total] = await Promise.all([
            AuditLog.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AuditLog.countDocuments(filter)
        ]);

        // إحصائيات سريعة للكروت العلوية
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [todayTotal, todayFailed, loginsFailed, transfersToday] = await Promise.all([
            AuditLog.countDocuments({ createdAt: { $gte: today } }),
            AuditLog.countDocuments({ createdAt: { $gte: today }, success: false }),
            AuditLog.countDocuments({ createdAt: { $gte: today }, action: 'LOGIN_FAILED' }),
            AuditLog.countDocuments({ createdAt: { $gte: today }, action: 'TRANSFER_CREATED' }),
        ]);

        res.render('audit_log', {
            activePage: 'audit_log',
            adminName: req.session.adminName || 'مدير',
            logs,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            filters: { action, dateFrom, dateTo, performedBy, success: success || '' },
            stats: { todayTotal, todayFailed, loginsFailed, transfersToday }
        });
    } catch (err) {
        console.error('[AuditLog Route]', err.message);
        res.status(500).send('خطأ في جلب سجل التدقيق');
    }
});

// ── API: جلب السجلات بصيغة JSON للتصدير ────────────────────
router.get('/export', requireAuth, async (req, res) => {
    try {
        const dateFrom = req.query.dateFrom || '';
        const dateTo   = req.query.dateTo   || '';
        const action   = req.query.action   || '';

        const filter = {};
        if (action) filter.action = action;
        if (dateFrom || dateTo) {
            filter.createdAt = {};
            if (dateFrom) filter.createdAt.$gte = new Date(dateFrom + 'T00:00:00.000Z');
            if (dateTo)   filter.createdAt.$lte = new Date(dateTo   + 'T23:59:59.999Z');
        }

        const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(5000).lean();
        res.json({ success: true, count: logs.length, data: logs });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
