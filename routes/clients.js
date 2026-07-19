const express = require('express');
const router = express.Router();
const { Telegram } = require('telegraf');
const User = require('../models/User');
const ClientBot = require('../models/ClientBot');
const Transaction = require('../models/Transaction');
const ClientEmployee = require('../models/ClientEmployee');
const { requireAuth } = require('../middlewares/auth');

router.get('/clients', requireAuth, async (req, res) => {
    const users = await User.find({}).sort({ createdAt: -1 }); const companies = await ClientBot.find({}).sort({ createdAt: -1 });
    res.render('clients', { users, companies });
});

router.get('/user/:id', requireAuth, async (req, res) => {
    const user = await User.findById(req.params.id); const transactions = await Transaction.find({ userId: user.telegramId, clientBotId: null }).sort({ createdAt: -1 }).limit(50);
    res.render('user_details', { user, transactions });
});

router.get('/company/:id', requireAuth, async (req, res) => {
    const company = await ClientBot.findById(req.params.id); const transactions = await Transaction.find({ clientBotId: company._id }).sort({ createdAt: -1 }).limit(50);
    res.render('company_details', { company, transactions });
});

router.post('/user/:id/add-balance', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.params.id); const amount = parseFloat(req.body.amount); const notes = req.body.notes ? req.body.notes.trim() : ''; 
        if (!isNaN(amount) && amount !== 0) {
            user.balance += amount; await user.save();
            const tx = await Transaction.create({ userId: user.telegramId, amount: Math.abs(amount), costLYD: 0, vodafoneNumber: '01000000000', status: amount > 0 ? 'deposit' : 'deduction', customId: `DEP-${Date.now().toString().slice(-6)}`, companyName: 'عميل فردي', employeeName: amount > 0 ? 'الإدارة (إيداع)' : 'الإدارة (خصم)', notes: notes });
            const actionType = amount > 0 ? 'إيداع/شحن رصيد' : 'خصم من الرصيد'; const msg = `💰 <b>إشعار مالي من الإدارة (${actionType})</b>\n\n💵 المبلغ: <b>${Math.abs(amount).toFixed(2)} دينار/EGP</b>\n📝 الملاحظة: ${notes || 'لا يوجد'}\n🧾 رقم العملية: <code>${tx.customId}</code>`;
            const mainAPI = new Telegram(process.env.CLIENT_BOT_TOKEN); mainAPI.sendMessage(user.telegramId, msg, { parse_mode: 'HTML' }).catch(()=>{});
        }
        res.redirect(`/user/${user._id}`);
    } catch (e) { res.redirect('/'); }
});

router.post('/user/:id/toggle-status', requireAuth, async (req, res) => {
    const user = await User.findById(req.params.id); user.status = user.status === 'active' ? 'banned' : 'active'; await user.save(); res.redirect(`/user/${user._id}`);
});

router.post('/user/:id/change-level', requireAuth, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { tier: parseInt(req.body.tier) }); res.redirect(`/user/${req.params.id}`);
});

router.post('/user/:id/update-limit', requireAuth, async (req, res) => {
    try { const limit = Math.abs(parseFloat(req.body.creditLimit) || 0); await User.findByIdAndUpdate(req.params.id, { creditLimit: limit }); res.redirect(`/user/${req.params.id}`); } catch (e) { res.redirect('/clients'); }
});

router.post('/company/:id/add-balance', requireAuth, async (req, res) => {
    try {
        const comp = await ClientBot.findById(req.params.id); const amount = parseFloat(req.body.amount); const notes = req.body.notes ? req.body.notes.trim() : '';
        if (!isNaN(amount) && amount !== 0) {
            comp.balance += amount; await comp.save();
            const tx = await Transaction.create({ userId: 'admin', clientBotId: comp._id, amount: Math.abs(amount), costLYD: 0, vodafoneNumber: '01000000000', status: amount > 0 ? 'deposit' : 'deduction', customId: `DEP-${Date.now().toString().slice(-6)}`, companyName: comp.name, employeeName: amount > 0 ? 'الإدارة (إيداع)' : 'الإدارة (خصم)', notes: notes });
            const actionType = amount > 0 ? 'إيداع/شحن رصيد' : 'خصم من الرصيد'; const msg = `💰 <b>إشعار مالي من الإدارة (${actionType})</b>\n\n💵 المبلغ: <b>${Math.abs(amount).toFixed(2)} دينار/EGP</b>\n📝 الملاحظة: ${notes || 'لا يوجد'}\n🧾 رقم العملية: <code>${tx.customId}</code>`;
            const compAPI = new Telegram(comp.token); const emps = await ClientEmployee.find({ clientBotId: comp._id, status: 'active' }); for(const emp of emps) compAPI.sendMessage(emp.telegramId, msg, { parse_mode: 'HTML' }).catch(()=>{});
        }
        res.redirect(`/company/${comp._id}`);
    } catch (e) { res.redirect('/'); }
});

router.post('/company/:id/update-rate', requireAuth, async (req, res) => {
    try { 
        const rate = Math.abs(parseFloat(req.body.exchangeRate) || 0); 
        await ClientBot.findByIdAndUpdate(req.params.id, { exchangeRate: rate }, { strict: false }); 
        res.redirect(`/company/${req.params.id}`); 
    } catch (e) { 
        res.redirect('/clients'); 
    }
});

router.post('/company/:id/toggle-status', requireAuth, async (req, res) => {
    const comp = await ClientBot.findById(req.params.id); comp.status = comp.status === 'active' ? 'inactive' : 'active'; await comp.save(); res.redirect(`/company/${comp._id}`);
});

router.post('/company/:id/change-level', requireAuth, async (req, res) => {
    await ClientBot.findByIdAndUpdate(req.params.id, { tier: parseInt(req.body.tier) }); res.redirect(`/company/${req.params.id}`);
});

router.post('/company/:id/update-limit', requireAuth, async (req, res) => {
    try { const limit = Math.abs(parseFloat(req.body.creditLimit) || 0); await ClientBot.findByIdAndUpdate(req.params.id, { creditLimit: limit }); res.redirect(`/company/${req.params.id}`); } catch (e) { res.redirect('/clients'); }
});

module.exports = router;
