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
const { sendLocalProofIfExists } = require('../utils/proofImage');

router.get(['/proxy/image/:id', '/proxy/image/:id/:index'], requireAuth, async (req, res) => {
    try {
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).send('لا توجد صورة إثبات');

        const index = req.params.index ? parseInt(req.params.index) : 0;
        let photoId = null;
        if (tx.proofImages && tx.proofImages.length > index) photoId = tx.proofImages[index];
        else if (tx.proofImage && index === 0) photoId = tx.proofImage; 

        if (!photoId) return res.status(404).send('لا توجد صورة إثبات');

        if (sendLocalProofIfExists(res, photoId)) return;

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
        const usersCount = await User.countDocuments(); const companiesCount = await ClientBot.countDocuments(); const executorsCount = await Employee.countDocuments();
        const pendingTxs = await Transaction.countDocuments({ status: 'pending' }); const processingTxs = await Transaction.countDocuments({ status: { $in: ['processing', 'accepted'] } }); const completedTxs = await Transaction.countDocuments({ status: 'completed' });
        res.render('index', { usersCount, companiesCount, executorsCount, pendingTxs, processingTxs, completedTxs, adminName: req.session.adminName });
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
