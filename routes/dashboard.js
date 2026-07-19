const express = require('express');
const router = express.Router();
const https = require('https');
const { Telegram } = require('telegraf');
const Transaction = require('../models/Transaction');
const ExecutorBot = require('../models/ExecutorBot');
const ClientBot = require('../models/ClientBot');
const User = require('../models/User');
const Employee = require('../models/Employee');
const { requireAuth } = require('../middlewares/auth');
const { getProofReference, trySendLocalProof } = require('../utils/proofImages');

router.get(['/proxy/image/:id', '/proxy/image/:id/:index'], requireAuth, async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).send('لا توجد صورة إثبات');

        const index = req.params.index ? parseInt(req.params.index) : 0;
        const photoId = getProofReference(tx, index);

        if (!photoId) return res.status(404).send('لا توجد صورة إثبات');
        if (trySendLocalProof(res, photoId)) return;

        let tokensToTry = [];
        if (process.env.ADMIN_BOT_TOKEN) tokensToTry.push(process.env.ADMIN_BOT_TOKEN);
        if (process.env.CLIENT_BOT_TOKEN) tokensToTry.push(process.env.CLIENT_BOT_TOKEN);
        if (tx.executorBotId) { const execBot = await ExecutorBot.findById(tx.executorBotId); if (execBot && execBot.token) tokensToTry.push(execBot.token); }
        if (tx.clientBotId) { const clientBot = await ClientBot.findById(tx.clientBotId); if (clientBot && clientBot.token) tokensToTry.push(clientBot.token); }

        let fileLink = null;
        for (const token of tokensToTry) {
            try { const api = new Telegram(token); fileLink = await api.getFileLink(photoId); if (fileLink) break; } catch(e) {}
        }

        if (!fileLink) return res.status(404).send('لا يمكن الوصول للصورة بسبب صلاحيات تيليجرام');
        https.get(fileLink.href, (response) => { res.set('Content-Type', response.headers['content-type']); response.pipe(res); }).on('error', (e) => { res.status(500).send('خطأ في جلب الصورة'); });
    } catch (error) { res.status(500).send('خطأ داخلي'); }
});

router.get('/', requireAuth, async (req, res) => {
    try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        monthStart.setHours(0, 0, 0, 0);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        monthEnd.setHours(0, 0, 0, 0);
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

        const [
            usersCount,
            companiesCount,
            executorsCount,
            pendingTxs,
            processingTxs,
            completedTxs,
            monthlyAgg,
            regularClients
        ] = await Promise.all([
            User.countDocuments(),
            ClientBot.countDocuments(),
            Employee.countDocuments(),
            Transaction.countDocuments({ status: 'pending' }),
            Transaction.countDocuments({ status: { $in: ['processing', 'accepted'] } }),
            Transaction.countDocuments({ status: 'completed' }),
            Transaction.aggregate([
                { $match: { status: 'completed', updatedAt: { $gte: monthStart, $lt: monthEnd } } },
                {
                    $group: {
                        _id: { $dayOfMonth: '$updatedAt' },
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' },
                        totalCost: { $sum: '$costLYD' }
                    }
                },
                { $sort: { _id: 1 } }
            ]),
            Transaction.aggregate([
                { $match: { status: 'completed', updatedAt: { $gte: monthStart, $lt: monthEnd } } },
                {
                    $group: {
                        _id: {
                            clientBotId: '$clientBotId',
                            userId: '$userId',
                            companyName: '$companyName',
                            employeeName: '$employeeName'
                        },
                        count: { $sum: 1 },
                        totalAmount: { $sum: '$amount' },
                        totalCost: { $sum: '$costLYD' },
                        activeDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$updatedAt' } } }
                    }
                },
                {
                    $project: {
                        count: 1,
                        totalAmount: 1,
                        totalCost: 1,
                        companyName: '$_id.companyName',
                        employeeName: '$_id.employeeName',
                        activeDaysCount: { $size: '$activeDays' }
                    }
                },
                { $sort: { activeDaysCount: -1, count: -1, totalAmount: -1 } },
                { $limit: 8 }
            ])
        ]);

        const byDay = new Map(monthlyAgg.map(row => [Number(row._id), row]));
        const monthlyClientChart = {
            labels: Array.from({ length: daysInMonth }, (_, index) => `${index + 1}/${now.getMonth() + 1}`),
            counts: Array.from({ length: daysInMonth }, (_, index) => byDay.get(index + 1)?.count || 0),
            amounts: Array.from({ length: daysInMonth }, (_, index) => Number((byDay.get(index + 1)?.totalAmount || 0).toFixed(2))),
            costs: Array.from({ length: daysInMonth }, (_, index) => Number((byDay.get(index + 1)?.totalCost || 0).toFixed(2))),
            monthLabel: now.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })
        };

        const regularClientRows = regularClients.map(row => ({
            name: row.companyName && row.companyName !== 'عميل فردي'
                ? row.companyName
                : (row.employeeName || 'عميل فردي'),
            requester: row.employeeName || 'غير مسجل',
            activeDaysCount: row.activeDaysCount || 0,
            count: row.count || 0,
            totalAmount: row.totalAmount || 0,
            totalCost: row.totalCost || 0
        }));

        res.render('index', {
            usersCount,
            companiesCount,
            executorsCount,
            pendingTxs,
            processingTxs,
            completedTxs,
            monthlyClientChart,
            regularClientRows,
            adminName: req.session.adminName
        });
    } catch (e) { res.status(500).send('خطأ داخلي'); }
});

const Notification = require('../models/Notification');

router.get('/api/notifications/unread', requireAuth, async (req, res) => {
    try { const notifs = await Notification.find({ isRead: false }).sort({ createdAt: -1 }); res.json({ count: notifs.length, notifications: notifs }); } catch (e) { res.status(500).json({ error: true }); }
});

router.post('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try { await Notification.findByIdAndUpdate(req.params.id, { isRead: true }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: true }); }
});

router.post('/api/notifications/read-all', requireAuth, async (req, res) => {
    try { await Notification.updateMany({ isRead: false }, { isRead: true }); res.json({ success: true }); } catch (e) { res.status(500).json({ error: true }); }
});

module.exports = router;
