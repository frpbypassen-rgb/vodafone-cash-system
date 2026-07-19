const express = require('express');
const router = express.Router();
const { Telegram } = require('telegraf');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

const User = require('../models/User');
const ClientBot = require('../models/ClientBot');
const ExecutorBot = require('../models/ExecutorBot');
const ClientEmployee = require('../models/ClientEmployee');
const Employee = require('../models/Employee');
const { requireAuth } = require('../middlewares/auth');

router.get('/broadcast', requireAuth, async (req, res) => {
    const users = await User.find({ status: 'active' }); const companies = await ClientBot.find({ status: 'active' }); const executors = await ExecutorBot.find({ status: 'active' }); res.render('broadcast', { users, companies, executors, query: req.query });
});

router.post('/broadcast/send', requireAuth, upload.single('imageFile'), async (req, res) => {
    const { target, message, specificUserId, specificCompanyId, specificExecutorId } = req.body;
    try {
        let photoData = null; if (req.file) photoData = { source: req.file.buffer };
        const sendMsg = async (token, chatId, text, photo) => {
            if (!token || !chatId) return;
            const api = new Telegram(token);
            try { if (photo) await api.sendPhoto(chatId, photo, { caption: text, parse_mode: 'HTML' }); else await api.sendMessage(chatId, text, { parse_mode: 'HTML' }); } catch (e) {}
        };
        const mainClientToken = process.env.CLIENT_BOT_TOKEN;

        if (target === 'all' || target === 'users') { const users = await User.find({ status: 'active' }); for (const u of users) await sendMsg(mainClientToken, u.telegramId, message, photoData); }
        if (target === 'all' || target === 'companies') { const clientEmps = await ClientEmployee.find({ status: 'active' }).populate('clientBotId'); for (const emp of clientEmps) { if (emp.clientBotId && emp.clientBotId.status === 'active') await sendMsg(emp.clientBotId.token, emp.telegramId, message, photoData); } }
        if (target === 'all' || target === 'employees') { const execEmps = await Employee.find({ status: 'active' }).populate('botId'); for (const emp of execEmps) { if (emp.botId && ['active', 'paused'].includes(emp.botId.status)) await sendMsg(emp.botId.token, emp.telegramId, message, photoData); } }
        if (target === 'specific_user') await sendMsg(mainClientToken, specificUserId, message, photoData);
        if (target === 'specific_company') { const comp = await ClientBot.findById(specificCompanyId); if (comp) { const emps = await ClientEmployee.find({ clientBotId: comp._id, status: 'active' }); for (const emp of emps) await sendMsg(comp.token, emp.telegramId, message, photoData); } }
        if (target === 'specific_executor') { const execBot = await ExecutorBot.findById(specificExecutorId); if (execBot) { const emps = await Employee.find({ botId: execBot._id, status: 'active' }); for (const emp of emps) await sendMsg(execBot.token, emp.telegramId, message, photoData); } }
        res.redirect('/broadcast?success=true');
    } catch (e) { res.redirect('/broadcast?error=failed'); }
});

module.exports = router;
