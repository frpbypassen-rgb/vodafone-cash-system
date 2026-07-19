const express = require('express');
const router = express.Router();
const { Telegram } = require('telegraf');

const SupportTicket = require('../models/SupportTicket');
const { requireAuth } = require('../middlewares/auth');

router.get('/support', requireAuth, async (req, res) => {
    try { res.render('support_admin', { adminName: req.session.adminName }); } catch (e) { res.redirect('/'); }
});

router.get('/api/support/tickets', requireAuth, async (req, res) => {
    try { const tickets = await SupportTicket.find({}).sort({ updatedAt: -1 }); res.json({ success: true, tickets }); } catch (e) { res.json({ success: false, error: e.message }); }
});

router.get('/api/support/tickets/:id', requireAuth, async (req, res) => {
    try { const ticket = await SupportTicket.findById(req.params.id); if (!ticket) return res.json({ success: false, error: 'التذكرة غير موجودة' }); ticket.unreadAdmin = 0; await ticket.save(); res.json({ success: true, ticket }); } catch (e) { res.json({ success: false, error: e.message }); }
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
