const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');
const { Telegram } = require('telegraf');
const mongoose = require('mongoose');

const SupportTicket = require('../models/SupportTicket');
const { requireAuth } = require('../middlewares/auth');

function sendDataImage(res, value) {
    const match = String(value || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return false;
    res.setHeader('Content-Type', match[1]);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(match[2], 'base64'));
    return true;
}

function pipeRemoteImage(fileUrl, res) {
    const client = String(fileUrl).startsWith('https:') ? https : http;
    client.get(fileUrl, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
            return pipeRemoteImage(new URL(response.headers.location, fileUrl).href, res);
        }

        if (response.statusCode >= 400) {
            return res.status(response.statusCode).send('تعذر جلب الصورة');
        }

        res.setHeader('Content-Type', response.headers['content-type'] || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=300');
        response.pipe(res);
    }).on('error', () => {
        if (!res.headersSent) res.status(502).send('تعذر جلب الصورة');
    });
}

router.get('/support', requireAuth, async (req, res) => {
    try { res.render('support_admin', { adminName: req.session.adminName }); } catch (e) { res.redirect('/'); }
});

router.get('/api/support/tickets', requireAuth, async (req, res) => {
    try { const tickets = await SupportTicket.find({}).select('-botToken').sort({ updatedAt: -1 }).lean(); res.json({ success: true, tickets }); } catch (e) { res.json({ success: false, error: e.message }); }
});

router.get('/api/support/tickets/:id', requireAuth, async (req, res) => {
    try {
        const ticket = await SupportTicket.findById(req.params.id);
        if (!ticket) return res.json({ success: false, error: 'التذكرة غير موجودة' });
        ticket.unreadAdmin = 0;
        await ticket.save();
        const payload = ticket.toObject();
        delete payload.botToken;
        res.json({ success: true, ticket: payload });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

router.get('/api/support/tickets/:ticketId/messages/:messageIndex/image', requireAuth, async (req, res) => {
    try {
        const { ticketId, messageIndex } = req.params;
        const index = Number(messageIndex);

        if (!mongoose.Types.ObjectId.isValid(ticketId) || !Number.isInteger(index) || index < 0) {
            return res.status(400).send('طلب صورة غير صالح');
        }

        const ticket = await SupportTicket.findById(ticketId).lean();
        const message = ticket && ticket.messages ? ticket.messages[index] : null;
        const imageUrl = message && message.imageUrl ? String(message.imageUrl) : '';

        if (!ticket || !imageUrl) return res.status(404).send('لا توجد صورة مرفقة');
        if (sendDataImage(res, imageUrl)) return;
        if (imageUrl.startsWith('/uploads/')) return res.redirect(imageUrl);
        if (/^https?:\/\//i.test(imageUrl)) return pipeRemoteImage(imageUrl, res);

        if (!ticket.botToken) {
            return res.status(404).send('لا يمكن الوصول لصورة تيليجرام بدون توكن البوت');
        }

        const api = new Telegram(ticket.botToken);
        const fileLink = await api.getFileLink(imageUrl);
        return pipeRemoteImage(fileLink.href, res);
    } catch (e) {
        return res.status(500).send('تعذر تحميل صورة الدعم الفني');
    }
});

router.post('/api/support/tickets/:id/reply', requireAuth, async (req, res) => {
    try {
        const { text } = req.body; const ticket = await SupportTicket.findById(req.params.id); if (!ticket) return res.json({ success: false, error: 'التذكرة غير موجودة' });
        const newMessage = { sender: 'admin', senderName: req.session.adminName || 'الإدارة', text: text, createdAt: new Date() };
        ticket.messages.push(newMessage); ticket.status = 'answered'; ticket.unreadUser = (ticket.unreadUser || 0) + 1; await ticket.save();
        if (ticket.botToken && ticket.telegramId) { const api = new Telegram(ticket.botToken); const msg = `📩 <b>رد جديد من الدعم الفني:</b>\n\n${text}`; await api.sendMessage(ticket.telegramId, msg, { parse_mode: 'HTML' }).catch(()=>{}); }
        res.json({ success: true, message: newMessage });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

router.post('/api/support/tickets/:id/close', requireAuth, async (req, res) => {
    try {
        const ticket = await SupportTicket.findById(req.params.id); if (!ticket) return res.json({ success: false, error: 'التذكرة غير موجودة' });
        ticket.status = 'closed'; await ticket.save();
        if (ticket.botToken && ticket.telegramId) { const api = new Telegram(ticket.botToken); const msg = `🔒 <b>تم إغلاق تذكرة الدعم الفني بواسطة الإدارة.</b>\nنشكرك على تواصلك معنا.`; await api.sendMessage(ticket.telegramId, msg, { parse_mode: 'HTML' }).catch(()=>{}); }
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

module.exports = router;
