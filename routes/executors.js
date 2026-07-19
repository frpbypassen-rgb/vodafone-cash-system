const express = require('express');
const router = express.Router();
const { Telegram } = require('telegraf');
const ExecutorBot = require('../models/ExecutorBot');
const Transaction = require('../models/Transaction');
const Employee = require('../models/Employee');
const { requireAuth } = require('../middlewares/auth');
const { syncBotBalance } = require('../utils/helpers');

router.get('/executors', requireAuth, async (req, res) => {
    try {
        const bots = await ExecutorBot.find({}).sort({ createdAt: -1 });
        const botsWithStats = await Promise.all(bots.map(async (bot) => {
            const syncedBalance = await syncBotBalance(bot._id); 
            let txCount = 0; if (bot.isManagerBot) txCount = await Transaction.countDocuments({ managerBotId: bot._id, status: 'completed' }); else txCount = await Transaction.countDocuments({ executorBotId: bot._id, status: 'completed' });
            return { ...bot._doc, balance: syncedBalance, txCount };
        }));
        res.render('executors', { bots: botsWithStats, adminName: req.session.adminName });
    } catch (e) { res.redirect('/'); }
});

router.get('/executor/:id', requireAuth, async (req, res) => {
    try {
        await syncBotBalance(req.params.id); 
        const bot = await ExecutorBot.findById(req.params.id).populate('parentBotId');
        let queryFilter = bot.isManagerBot ? { managerBotId: bot._id } : { executorBotId: bot._id };
        const transactions = await Transaction.find(queryFilter).sort({ updatedAt: -1 }).limit(100);
        
        const managerBots = await ExecutorBot.find({ isManagerBot: true, status: 'active', _id: { $ne: bot._id } });

        if (bot.isApiBot) {
            const stats = {
                successCount: transactions.filter(t => t.status === 'completed').length,
                failedCount: transactions.filter(t => t.status === 'pending' && t.notes && t.notes.includes('فشل')).length,
            };
            return res.render('api_room', { bot, transactions, stats, managerBots, adminName: req.session.adminName });
        }

        res.render('executor_details', { bot, transactions, managerBots, adminName: req.session.adminName });
    } catch (e) { res.redirect('/executors'); }
});

router.post('/executor/:id/settle', requireAuth, async (req, res) => {
    try {
        const bot = await ExecutorBot.findById(req.params.id); const amount = parseFloat(req.body.amount); const notes = req.body.notes ? req.body.notes.trim() : ''; 
        let targetBotId = bot._id; let targetBotName = bot.name; let targetToken = bot.token;

        if (!bot.isManagerBot && bot.parentBotId) { targetBotId = bot.parentBotId; const parentBot = await ExecutorBot.findById(targetBotId); if (parentBot) { targetBotName = parentBot.name; targetToken = parentBot.token; } }
        
        if (!isNaN(amount) && amount !== 0) {
            const tx = await Transaction.create({
                userId: 'admin', executorBotId: targetBotId, amount: Math.abs(amount), costLYD: 0, vodafoneNumber: 'تسديد حساب',
                status: amount > 0 ? 'deposit' : 'deduction', customId: `SETTLE-${Date.now().toString().slice(-6)}`, companyName: 'الإدارة المركزية', employeeName: amount > 0 ? 'تسديد نقدية (إيداع)' : 'خصم من المنفذ', executorName: targetBotName, notes: notes 
            });
            await syncBotBalance(targetBotId); if(targetBotId.toString() !== bot._id.toString()) await syncBotBalance(bot._id); 

            if (!bot.isApiBot) {
                const execAPI = new Telegram(targetToken); const emps = await Employee.find({ botId: targetBotId, status: 'active' });
                const actionType = amount > 0 ? 'إيداع نقدية/تسديد' : 'خصم من الرصيد'; const msgText = `💰 <b>إشعار مالي من الإدارة (${actionType})</b>\n\n💵 المبلغ: <b>${Math.abs(amount).toFixed(2)} EGP</b>\n📝 الملاحظة: ${notes || 'لا يوجد'}\n🧾 الطلب: <code>${tx.customId}</code>`;
                for(const e of emps) execAPI.sendMessage(e.telegramId, msgText, { parse_mode: 'HTML' }).catch(()=>{});
                await Transaction.updateOne({ _id: tx._id }, { $set: { executorWebAlert: { type: amount > 0 ? 'success' : 'error', text: msgText.replace(/\n/g, '<br>') } } }, { strict: false });
            }
        }
        res.redirect(`/executor/${bot._id}`);
    } catch (e) { res.redirect('/executors'); }
});

router.post('/executor/:id/link-manager', requireAuth, async (req, res) => {
    try {
        const botId = req.params.id; const parentId = req.body.parentBotId; const bot = await ExecutorBot.findById(botId);
        if (bot) { if (parentId === 'none') { bot.parentBotId = null; } else { bot.parentBotId = parentId; } await bot.save(); }
        res.redirect(`/executor/${botId}`);
    } catch (e) { res.redirect('/executors'); }
});

router.post('/executor/:id/toggle-status', requireAuth, async (req, res) => {
    try {
        const botId = req.params.id; const bot = await ExecutorBot.findById(botId); if (!bot) return res.redirect('/executors');
        bot.status = bot.status === 'active' ? 'paused' : 'active'; await bot.save();
        
        if (!bot.isApiBot) {
            try {
                const botEmployees = await Employee.find({ botId: bot._id, telegramId: { $exists: true, $ne: null } });
                if (botEmployees.length > 0 && bot.token) {
                    const botAPI = new Telegram(bot.token);
                    let message = bot.status === 'paused' ? `🔴 <b>إشعار إداري هام:</b>\n\nتم <b>إيقاف</b> هذا البوت مؤقتاً من قبل الإدارة المركزية.\nلا يمكنك استقبال أو تنفيذ أي عمليات حالياً حتى يتم تفعيله مجدداً.` : `🟢 <b>إشعار إداري:</b>\n\nتم <b>إعادة تشغيل وتفعيل</b> البوت بنجاح.\nيمكنك الآن استئناف عملك واستقبال الطلبات.`;
                    for (const emp of botEmployees) await botAPI.sendMessage(emp.telegramId, message, { parse_mode: 'HTML' }).catch(()=>{});
                }
            } catch (tgError) {}
        }
        res.redirect(`/executor/${bot._id}`);
    } catch (e) { res.redirect('/executors'); }
});

module.exports = router;
