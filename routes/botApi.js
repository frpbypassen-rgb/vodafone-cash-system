const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const User = require('../models/User');
const ClientBot = require('../models/ClientBot');
const ExecutorBot = require('../models/ExecutorBot');
const ClientEmployee = require('../models/ClientEmployee');
const Employee = require('../models/Employee');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');
const Counter = require('../models/Counter');
const Admin = require('../models/Admin');
const SupportTicket = require('../models/SupportTicket');
const { Telegram } = require('telegraf');
const { sendProofToClientRecipients } = require('../services/proofDeliveryService');

// ========================================================
// 🛡️ Middleware للمصادقة وتحديد هوية البوت
// ========================================================
const authenticateBot = async (req, res, next) => {
    try {
        const botToken = req.headers['x-bot-token'];
        if (!botToken) return res.status(401).json({ success: false, message: 'Missing bot token' });

        if (botToken === process.env.CLIENT_BOT_TOKEN) {
            req.botContext = { isMainBot: true, type: 'client' };
            return next();
        }

        const clientBot = await ClientBot.findOne({ token: botToken });
        if (clientBot) {
            req.botContext = { isMainBot: false, type: 'client', botData: clientBot };
            return next();
        }

        const executorBot = await ExecutorBot.findOne({ token: botToken });
        if (executorBot) {
            req.botContext = { type: 'executor', botData: executorBot };
            return next();
        }

        return res.status(401).json({ success: false, message: 'Invalid bot token' });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Auth Error' });
    }
};


// ========================================================
// 🤖 System initialization endpoints (No auth required)
// ========================================================
router.get('/system/client-bots', async (req, res) => {
    try {
        const bots = await ClientBot.find({ status: 'active' }).lean();
        res.json({ success: true, bots });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.get('/system/executor-bots', async (req, res) => {
    try {
        const bots = await ExecutorBot.find({ status: { $ne: 'inactive' } }).lean();
        res.json({ success: true, bots });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.use(authenticateBot);

// ========================================================
// ⚙️ مسارات الإعدادات العامة
// ========================================================
router.get('/settings', async (req, res) => {
    try {
        const set = await Settings.findOne({}).lean() || {};
        res.json({ success: true, settings: set });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// 👤 مسارات بوتات العملاء (Client Bots)
// ========================================================

// جلب تفاصيل المستخدم للعميل (أو الموظف في شركة)
router.post('/client/user', async (req, res) => {
    try {
        if (req.botContext.type !== 'client') return res.status(403).json({ success: false });
        const { telegramId, name, phone } = req.body;

        if (req.botContext.isMainBot) {
            let user = await User.findOne({ telegramId });
            // تسجيل مبدئي إذا لم يكن موجود
            if (!user && name && phone) {
                user = await User.create({ telegramId, name, phone, status: 'pending', balance: 0 });
            }
            return res.json({ success: true, user });
        } else {
            const company = req.botContext.botData;
            let emp = await ClientEmployee.findOne({ telegramId, clientBotId: company._id });
            if (!emp && name && phone) {
                emp = await ClientEmployee.create({ telegramId, name, phone, clientBotId: company._id, status: 'pending' });
            }
            return res.json({ success: true, user: emp, company });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// إنشاء معاملة تحويل مالي
router.post('/client/transfer', async (req, res) => {
    try {
        if (req.botContext.type !== 'client') return res.status(403).json({ success: false });
        
        const { telegramId, amountEGP, transferType, vodafoneNumber, accountNumber, accountName, nationalId, governorate, idCardImage, notes } = req.body;
        
        const { isMainBot, botData } = req.botContext;
        const set = await Settings.findOne({}).lean();
        
        // التحقق من الحماية ضد التكرار (سبام)
        const spamFilter = isMainBot ? { userId: telegramId, clientBotId: null } : { clientBotId: botData._id };
        spamFilter.vodafoneNumber = vodafoneNumber || accountNumber;
        
        const lastTx = await Transaction.findOne(spamFilter).sort({ createdAt: -1 });
        if (lastTx) {
            const diffSecs = (Date.now() - lastTx.createdAt.getTime()) / 1000;
            if (lastTx.amount === amountEGP && diffSecs < 300) return res.status(429).json({ success: false, waitTime: Math.ceil(300 - diffSecs), message: 'Duplicate amount recently' });
            if (diffSecs < 60) return res.status(429).json({ success: false, waitTime: Math.ceil(60 - diffSecs), message: 'Too many requests' });
        }

        // جلب معلومات المستخدم
        let TargetModel = isMainBot ? User : ClientBot;
        let targetFilter = isMainBot ? { telegramId } : { _id: botData._id };
        let employeeName = 'مجهول';
        
        let accountDoc = await TargetModel.findOne(targetFilter);
        if (!accountDoc) return res.status(404).json({ success: false, message: 'Account not found' });

        if (isMainBot) {
            employeeName = accountDoc.name;
        } else {
            const emp = await ClientEmployee.findOne({ telegramId, clientBotId: botData._id });
            if (emp) employeeName = emp.name;
        }

        let tier = accountDoc.tier || 1;
        let baseRate = set.rateLevel1 || 6.40;
        if (tier === 2) baseRate = set.rateLevel2 || 6.45;
        if (tier === 3) baseRate = set.rateLevel3 || 6.50;

        let finalRate = baseRate;
        if (transferType === 'post_account') finalRate = baseRate - 0.05;
        else if (transferType === 'post_card') finalRate = baseRate - 0.15;
        if (finalRate <= 0) finalRate = baseRate;

        const costLYD = parseFloat((amountEGP / finalRate).toFixed(3));
        const creditLimit = accountDoc.creditLimit || 0;
        const minRequiredBalance = costLYD - creditLimit;

        // خصم ذري
        const updatedAccount = await TargetModel.findOneAndUpdate(
            { ...targetFilter, balance: { $gte: minRequiredBalance } },
            { $inc: { balance: -costLYD } },
            { new: true }
        );

        if (!updatedAccount) return res.status(400).json({ success: false, message: 'INSUFFICIENT_BALANCE' });

        // توليد رقم تسلسلي
        const counter = await Counter.findOneAndUpdate({ name: 'transaction' }, { $inc: { value: 1 } }, { upsert: true, new: true });
        const yy = new Date().getFullYear().toString().slice(-2);
        const mm = (new Date().getMonth() + 1).toString().padStart(2, '0');
        const customOrderId = `ATT-${yy}${mm}-${counter.value.toString().padStart(4, '0')}`;

        let dbAccountName = accountName || '';
        if (transferType === 'post_card' && nationalId) {
            dbAccountName = `${accountName}\n🆔 الرقم القومي: <code>${nationalId}</code>\n📍 المحافظة: ${governorate}`;
        }

        const transaction = await Transaction.create({
            userId: telegramId,
            amount: amountEGP,
            costLYD: costLYD,
            exchangeRate: finalRate,
            vodafoneNumber: vodafoneNumber || accountNumber,
            transferType: transferType || 'vodafone_cash',
            accountName: dbAccountName,
            idCardImage: idCardImage,
            notes: notes,
            status: 'pending',
            customId: customOrderId,
            clientBotId: isMainBot ? null : botData._id,
            companyName: isMainBot ? 'عميل فردي' : botData.name,
            employeeName: employeeName,
            executorBotId: (set && set.autoRouteEnabled && set.autoRouteBotId) ? set.autoRouteBotId : undefined
        });

        // إشعارات الإدارة المباشرة
        setImmediate(async () => {
            try {
                const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
                const sourceHeader = isMainBot ? `👤 <b>عميل فردي:</b> ${employeeName}` : `🏢 <b>الشركة:</b> ${botData.name}\n👨‍💻 <b>الموظف:</b> ${employeeName}`;
                let typeLabel = transferType === 'post_account' ? '📮 حساب بريد' : (transferType === 'post_card' ? '💳 بطاقة عميل' : '📱 فودافون كاش');
                const adminNoteDisplay = notes ? `\n📝 <b>ملاحظة:</b> <i>${notes}</i>` : '';
                
                const msgText = `🔔 <b>طلب تحويل (${typeLabel})!</b>\n\n${sourceHeader}\n📞 <b>الرقم:</b> <code>${transaction.vodafoneNumber}</code>\n🇪🇬 <b>المبلغ المطلوب:</b> ${transaction.amount} EGP\n🇱🇾 <b>الدفع:</b> ${transaction.costLYD.toFixed(2)} LYD (سعر: ${finalRate})\n🧾 <b>رقم الطلب:</b> <code>${transaction.customId}</code>${adminNoteDisplay}`;
                const inlineKb = { inline_keyboard: [ [{ text: '🤖 تحويل لبوت تنفيذي', callback_data: `forward_${transaction._id}` }], [{ text: '❌ إلغاء العملية', callback_data: `cancelReq_${transaction._id}` }] ] };

                const allAdmins = await Admin.find({});
                let savedMsgs = [];
                let idUrl = null;

                if (idCardImage) {
                    try {
                        let cToken = isMainBot ? process.env.CLIENT_BOT_TOKEN : botData.token;
                        const tempApi = new Telegram(cToken);
                        idUrl = (await tempApi.getFileLink(idCardImage)).href;
                    } catch(e){}
                }

                for (const admin of allAdmins) {
                    if (admin.telegramId && !admin.webUsername) {
                        try {
                            let sent;
                            if (idUrl) sent = await adminAPI.sendPhoto(admin.telegramId, { url: idUrl }, { caption: msgText, parse_mode: 'HTML', reply_markup: inlineKb });
                            else sent = await adminAPI.sendMessage(admin.telegramId, msgText, { parse_mode: 'HTML', reply_markup: inlineKb });
                            if(sent) savedMsgs.push({ telegramId: admin.telegramId, messageId: sent.message_id });
                        } catch(e) {}
                    }
                }
                if (savedMsgs.length > 0) {
                    transaction.adminMessages = savedMsgs;
                    await transaction.save();
                }
            } catch(e) {}
        });

        res.json({ success: true, transaction });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// ========================================================
// 👨‍💻 مسارات بوتات المنفذين (Executor Bots)
// ========================================================
router.post('/executor/user', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { telegramId } = req.body;
        const emp = await Employee.findOne({ telegramId, botId: req.botContext.botData._id });
        res.json({ success: true, employee: emp, bot: req.botContext.botData });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// 🔗 مسارات تفعيل التليجرام (Telegram Linking)
// ========================================================
router.post('/client/link-telegram', async (req, res) => {
    try {
        if (req.botContext.type !== 'client') return res.status(403).json({ success: false });
        const { token, telegramId } = req.body;
        const actualToken = token.replace('LINK-CLIENT-', '');
        
        let targetAccount = null;
        if (req.botContext.isMainBot) {
            targetAccount = await User.findOne({ telegramLinkToken: actualToken });
        } else {
            targetAccount = await ClientEmployee.findOne({ telegramLinkToken: actualToken, clientBotId: req.botContext.botData._id });
        }

        if (!targetAccount) return res.status(404).json({ success: false, message: 'Invalid or expired token' });

        targetAccount.telegramId = telegramId;
        targetAccount.telegramLinkToken = undefined;
        if (targetAccount.status === 'pending') targetAccount.status = 'active';
        await targetAccount.save();

        res.json({ success: true, name: targetAccount.name });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/executor/link-telegram', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { token, telegramId } = req.body;
        const actualToken = token.replace('LINK-EXEC-', '');
        
        const targetAccount = await Employee.findOne({ telegramLinkToken: actualToken });
        if (!targetAccount || (targetAccount.telegramLinkExpires && new Date(targetAccount.telegramLinkExpires) < new Date())) {
            return res.status(404).json({ success: false, message: 'Invalid or expired token' });
        }

        targetAccount.telegramId = telegramId;
        targetAccount.telegramLinkToken = undefined;
        targetAccount.telegramLinkExpires = undefined;
        await targetAccount.save();

        res.json({ success: true, name: targetAccount.name });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
// ========================================================
// 🤖 مسارات البوت المضافة للفصل الكامل (Decoupling)
// ========================================================

// جلب بيانات لوحة التحكم للعميل
router.get('/client/dashboard', async (req, res) => {
    try {
        const { telegramId } = req.query;
        let settings = await Settings.findOne();
        if (!settings) settings = await Settings.create({});
        
        const isMainBot = req.botContext.isMainBot;
        let account = null;
        let company = null;

        if (isMainBot) {
            account = await User.findOne({ telegramId });
        } else {
            account = await ClientEmployee.findOne({ telegramId, clientBotId: req.botContext.botData._id });
            company = req.botContext.botData;
        }

        res.json({
            success: true,
            isRegistered: !!(account && account.name),
            settings: { welcomeMessage: settings.welcomeMessage || 'مرحباً بك في منظومة الأهرام الرقمية للصرافة.' },
            account,
            company
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// تعيين بيانات الويب
router.post('/client/web-credentials', async (req, res) => {
    try {
        const { telegramId, username, password } = req.body;
        const isMainBot = req.botContext.isMainBot;
        
        let account = isMainBot 
            ? await User.findOne({ telegramId }) 
            : await ClientEmployee.findOne({ telegramId, clientBotId: req.botContext.botData._id });
            
        if (!account) return res.status(404).json({ success: false, message: 'Account not found' });

        const userExists = await User.findOne({ webUsername: username });
        const empExists = await ClientEmployee.findOne({ webUsername: username });

        if ((userExists && userExists.telegramId !== telegramId) || (empExists && empExists.telegramId !== telegramId)) {
            return res.status(400).json({ success: false, message: 'Username exists' });
        }

        account.webUsername = username;
        account.webPassword = password;
        await account.save();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// جلب العمليات المعلقة
router.get('/client/pending-transactions', async (req, res) => {
    try {
        const { telegramId } = req.query;
        const isMainBot = req.botContext.isMainBot;
        
        let filter = isMainBot ? { userId: telegramId, clientBotId: null } : { clientBotId: req.botContext.botData._id };
        filter.status = { $in: ['pending', 'processing', 'accepted'] };

        const pendingTxs = await Transaction.find(filter).sort({ createdAt: -1 });
        res.json({ success: true, pendingTxs });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// تذكير الإدارة
router.post('/client/remind-admin', async (req, res) => {
    try {
        const { txId } = req.body;
        const tx = await Transaction.findById(txId);
        if (!tx || ['completed', 'rejected'].includes(tx.status)) {
            return res.status(400).json({ success: false, message: 'Not pending' });
        }

        const isMainBot = !tx.clientBotId;
        let clientInfo = '';
        if (isMainBot) {
            const user = await User.findOne({ telegramId: tx.userId });
            clientInfo = `👤 <b>العميل الفردي:</b> ${user ? user.name : 'غير معروف'}`;
        } else {
            const company = await ClientBot.findById(tx.clientBotId);
            clientInfo = `🏢 <b>الشركة:</b> ${company ? company.name : 'غير معروف'}\n👨‍💻 <b>الموظف:</b> ${tx.employeeName || 'غير مسجل'}`;
        }

        let executorInfo = '❌ لم يتم التوجيه لمنفذ بعد';
        if (tx.executorBotId) {
            const execBot = await ExecutorBot.findById(tx.executorBotId);
            executorInfo = `🤖 <b>البوت المنفذ:</b> ${execBot ? execBot.name : 'غير معروف'}`;
        }

        const adminReminder = `🔔 <b>تذكير باستعجال طلب!</b>\n\n` +
                              `🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n` +
                              `${clientInfo}\n` +
                              `📞 <b>الرقم/الحساب:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n` +
                              `💵 <b>المبلغ:</b> ${tx.amount} EGP\n` +
                              `${executorInfo}`;

        const adminBotAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        const admins = await Admin.find({});
        for (const admin of admins) {
            await adminBotAPI.sendMessage(admin.telegramId, adminReminder, { parse_mode: 'HTML' }).catch(()=>{});
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// جلب إحصائيات الحساب
router.get('/client/account-info', async (req, res) => {
    try {
        const { telegramId } = req.query;
        const isMainBot = req.botContext.isMainBot;
        
        let targetId = isMainBot ? { userId: telegramId, clientBotId: null } : { clientBotId: req.botContext.botData._id };
        const totalTxs = await Transaction.countDocuments({ ...targetId, status: 'completed' });
        const sumTxs = await Transaction.aggregate([
            { $match: { ...targetId, status: 'completed' } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);

        res.json({ success: true, totalTxs, sumAmount: sumTxs[0]?.total || 0 });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================================
// 📩 مسارات الشكاوي والدعم وأرقام المرسلين
// ========================================================
router.get('/client/transactions/completed', async (req, res) => {
    try {
        if (req.botContext.type !== 'client') return res.status(403).json({ success: false });
        const { telegramId } = req.query;
        let filter = req.botContext.isMainBot ? { userId: telegramId, clientBotId: null } : { clientBotId: req.botContext.botData._id };
        filter.status = 'completed';
        const txs = await Transaction.find(filter).sort({ updatedAt: -1 }).limit(10).lean();
        res.json({ success: true, txs });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.get('/client/transactions/search', async (req, res) => {
    try {
        if (req.botContext.type !== 'client') return res.status(403).json({ success: false });
        const { telegramId, searchId } = req.query;
        let filter = req.botContext.isMainBot ? { userId: telegramId, clientBotId: null } : { clientBotId: req.botContext.botData._id };
        
        const mongoose = require('mongoose');
        let queryOptions = [{ customId: searchId }];
        if (mongoose.Types.ObjectId.isValid(searchId)) queryOptions.push({ _id: searchId });
        
        filter.$or = queryOptions;
        
        const tx = await Transaction.findOne(filter).lean();
        if (!tx) return res.json({ success: false });
        res.json({ success: true, tx });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/client/complaint', async (req, res) => {
    try {
        if (req.botContext.type !== 'client') return res.status(403).json({ success: false });
        const { txId, telegramId, complaintText } = req.body;
        
        const tx = await Transaction.findById(txId);
        if (!tx) return res.status(404).json({ success: false });
        
        tx.complaint = complaintText;
        tx.hasComplaint = true;
        await tx.save();
        
        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        let execBotName = 'غير محدد';
        if (tx.executorBotId) {
            const execBot = await ExecutorBot.findById(tx.executorBotId);
            if (execBot) execBotName = execBot.name;
        }
        
        const msg = `⚠️ <b>شكوى جديدة على عملية!</b>\n\n🧾 <b>الطلب:</b> <code>${tx.customId || tx._id}</code>\n🤖 <b>المنفذ:</b> ${execBotName}\n\n📝 <b>تفاصيل الشكوى:</b>\n<i>${complaintText}</i>`;
        const admins = await Admin.find({});
        for (const admin of admins) {
            try { await adminAPI.sendMessage(admin.telegramId, msg, { parse_mode: 'HTML' }); } catch(e){}
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/client/transactions/request-phone', async (req, res) => {
    try {
        if (req.botContext.type !== 'client') return res.status(403).json({ success: false });
        const { txId } = req.body;
        
        const tx = await Transaction.findById(txId);
        if (!tx) return res.status(404).json({ success: false });
        
        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        const adminMsgText = `📞 <b>طلب رقم منفذ الحوالة!</b>\n\nالعميل يطلب معرفة الرقم الذي تم تحويل العملية منه.\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>المحول إليه:</b> <code>${tx.vodafoneNumber}</code>\n👨‍💻 <b>الموظف المنفذ:</b> ${tx.executorName}\n\n⏳ <i>في انتظار إرفاق الرقم من الموظف...</i>`;
        
        tx.phoneReqAdminMessages = [];
        const admins = await Admin.find({});
        for (const admin of admins) {
            try { 
                const sent = await adminAPI.sendMessage(admin.telegramId, adminMsgText, { parse_mode: 'HTML' }); 
                tx.phoneReqAdminMessages.push({ telegramId: admin.telegramId, messageId: sent.message_id });
            } catch(e){}
        }
        
        if (tx.executorBotId && tx.operatorId) {
            const execBot = await ExecutorBot.findById(tx.executorBotId);
            if (execBot) {
                const execAPI = new Telegram(execBot.token);
                const execMsg = `📞 <b>طلب هام من العميل!</b>\n\nالعميل يطلب معرفة <b>رقم فودافون كاش</b> الذي قمت بالتحويل منه للطلب:\n🧾 <code>${tx.customId || tx._id}</code>\n📞 المحول إليه: <code>${tx.vodafoneNumber}</code>\n💵 المبلغ: ${tx.amount} EGP`;
                try {
                    await execAPI.sendMessage(tx.operatorId, execMsg, {
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([[Markup.button.callback('📱 إرفاق رقم الهاتف', `providePhone_${tx._id}`)]])
                    });
                } catch (e) {}
            }
        }
        
        await tx.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/client/support/ticket', async (req, res) => {
    try {
        if (req.botContext.type !== 'client') return res.status(403).json({ success: false });
        const { telegramId, text, imageUrl } = req.body;
        
        const SupportTicket = require('../models/SupportTicket');
        const User = require('../models/User');
        const ClientEmployee = require('../models/ClientEmployee');
        const ClientBot = require('../models/ClientBot');
        
        let entityType, entityId, name, phone;
        
        if (req.botContext.isMainBot) {
            const user = await User.findOne({ telegramId });
            if (!user) return res.status(404).json({ success: false });
            entityType = 'client_user';
            entityId = user._id;
            name = user.name;
            phone = user.phone;
        } else {
            const emp = await ClientEmployee.findOne({ telegramId, clientBotId: req.botContext.botData._id });
            const comp = await ClientBot.findById(req.botContext.botData._id);
            if (!emp || !comp) return res.status(404).json({ success: false });
            entityType = 'client_company';
            entityId = comp._id;
            name = `${comp.name} - ${emp.name}`;
            phone = emp.phone;
        }
        
        let ticket = await SupportTicket.findOne({ telegramId, status: { $ne: 'closed' } });
        
        if (!ticket) {
            ticket = new SupportTicket({
                entityType, entityId, telegramId, name, phone,
                botToken: req.botContext.botData.token, messages: []
            });
        }
        
        ticket.messages.push({ sender: 'user', text: text || 'صورة بدون نص', imageUrl: imageUrl || '', createdAt: new Date() });
        ticket.status = 'open';
        ticket.unreadAdmin = (ticket.unreadAdmin || 0) + 1;
        await ticket.save();
        
        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        const admins = await Admin.find({});
        const phoneLine = phone ? `\n📞 <b>رقم الهاتف:</b> <code>${phone}</code>` : '';
        for (const admin of admins) {
            await adminAPI.sendMessage(admin.telegramId, `🚨 <b>رسالة دعم فني جديدة!</b>\n\n👤 من: ${name}${phoneLine}\n💬 الرسالة: ${text || 'صورة'}\n\nيرجى مراجعة لوحة التحكم للرد.`, { parse_mode: 'HTML' }).catch(()=>{});
        }
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});


// ========================================================
// ⚙️ مسارات النظام والتقارير (System & Reports API)
// ========================================================

router.get('/system/client-bots', async (req, res) => {
    try {
        const bots = await ClientBot.find({ status: 'active' });
        res.json({ success: true, bots });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});





// جلب بيانات التقرير للإكسيل
router.post('/client/report-data', async (req, res) => {
    try {
        if (req.botContext.type !== 'client') return res.status(403).json({ success: false });
        const { entityFilter, start, end } = req.body;
        
        const txs = await Transaction.find({ status: 'completed', ...entityFilter, updatedAt: { $gte: new Date(start), $lte: new Date(end) } }).sort({ updatedAt: 1 }).lean();
        const deposits = await Transaction.find({ status: 'deposit', ...entityFilter, updatedAt: { $gte: new Date(start), $lte: new Date(end) } }).lean();
        const settings = await Settings.findOne({}).lean() || {};
        
        res.json({ success: true, txs, deposits, settings });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// ========================================================
// 🤖 مسارات بوتات التنفيذ (Executor Bots)
// ========================================================

router.get('/executor/dashboard', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const telegramId = req.query.telegramId;
        const botData = req.botContext.botData;

        const employee = await Employee.findOne({ telegramId, botId: botData._id }).lean();
        if (!employee) return res.json({ success: true, isRegistered: false, employee: null, botData });

        const set = await Settings.findOne({}).lean() || {};
        
        // Count active transactions
        const activeTxs = await Transaction.countDocuments({ 
            executorBotId: botData._id, 
            status: { $in: ['pending', 'processing', 'accepted'] } 
        });

        // Closing summary
        const todayStr = new Date().toLocaleDateString('en-GB');
        const totalClosed = await Transaction.aggregate([
            { $match: { executorBotId: botData._id, status: 'completed', employeeName: employee.name, 
                        updatedAt: { $gte: new Date(new Date().setHours(0,0,0,0)), $lte: new Date(new Date().setHours(23,59,59,999)) } } },
            { $group: { _id: null, total: { $sum: "$amount" } } }
        ]);
        const totalAmount = totalClosed[0]?.total || 0;

        res.json({ success: true, isRegistered: true, employee, botData, settings: set, activeTxs, totalAmount, todayStr });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/executor/employee/register', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { telegramId, name, phone } = req.body;
        const botData = req.botContext.botData;

        let emp = await Employee.findOne({ telegramId, botId: botData._id });
        if (emp) return res.json({ success: false, message: 'Already registered' });

        const isManager = (await Employee.countDocuments({ botId: botData._id })) === 0;
        emp = await Employee.create({
            telegramId, name, phone, botId: botData._id,
            status: isManager ? 'active' : 'pending',
            permissions: isManager ? ['manage_employees', 'view_reports', 'manage_balance', 'can_close', 'cancel_requests', 'can_edit'] : []
        });

        if (!isManager) {
            const managers = await Employee.find({ botId: botData._id, permissions: 'manage_employees' });
            // Should send notification to managers, handled by bot
            res.json({ success: true, isManager: false, employee: emp, managers: managers.map(m => m.telegramId) });
        } else {
            res.json({ success: true, isManager: true, employee: emp });
        }
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.get('/executor/transactions/pending', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const botData = req.botContext.botData;
        
        const txs = await Transaction.find({ executorBotId: botData._id, status: { $in: ['pending', 'processing', 'accepted'] } })
                                     .sort({ createdAt: -1 }).lean();
        res.json({ success: true, txs });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});


router.post('/executor/transactions/proof', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { txId, proofImage, employeeName, telegramId } = req.body;
        
        const tx = await Transaction.findById(txId);
        if (!tx || tx.status === 'completed') return res.status(400).json({ success: false, message: 'Invalid transaction' });
        
        tx.proofImage = proofImage;
        tx.proofImages = [proofImage];
        tx.status = 'completed';
        if(employeeName) tx.executorEmployeeName = employeeName;
        await tx.save();

        const clientMsg = `✅ <b>تم تنفيذ طلبك بنجاح!</b>\n\n🧾 الطلب: <code>${tx.customId || tx._id}</code>\n\n<i>مرفق الإثبات أدناه.</i>`;
        await sendProofToClientRecipients(tx, {
            caption: clientMsg,
            proofRefs: [proofImage],
            sourceBotToken: req.botContext.botData.token
        });

        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        const adminMsg = `✅ <b>تم تنفيذ حوالة بنجاح!</b>\n\n👤 <b>الجهة/العميل:</b> ${tx.companyName || 'عميل فردي'}\n👤 <b>اسم المرسل:</b> ${tx.employeeName || 'غير مسجل'}\n🤖 <b>بواسطة المنفذ:</b> ${tx.executorName || 'غير محدد'}\n━━━━━━━━━━━━━━\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>الرقم المحول إليه:</b> <code>${tx.vodafoneNumber}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP`;
        
        const allAdmins = await Admin.find({});
        for (const admin of allAdmins) {
            try { await adminAPI.sendPhoto(admin.telegramId, proofImage, { caption: adminMsg, parse_mode: 'HTML' }); } catch(e){}
        }
        
        res.json({ success: true, tx });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/executor/transactions/edit', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { txId, newAmount, proofImage, telegramId } = req.body;
        
        const emp = await Employee.findOne({ telegramId, botId: req.botContext.botData._id });
        if (!emp || (!emp.permissions.includes('can_edit') && !emp.permissions.includes('manage_employees'))) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const tx = await Transaction.findById(txId);
        if (!tx || ['completed', 'rejected'].includes(tx.status)) return res.status(400).json({ success: false, message: 'Cannot edit' });

        const oldAmount = tx.amount;
        const oldLYD = tx.costLYD;
        
        tx.amount = newAmount;
        const set = await Settings.findOne();
        
        let targetDoc;
        let diffAmount = 0;
        
        if (!tx.clientBotId) targetDoc = await User.findOne({ telegramId: tx.userId });
        else targetDoc = await ClientBot.findById(tx.clientBotId);

        let refundLYD = 0;
        if (targetDoc) {
            let baseRate = set.rateLevel1 || 6.40;
            if (targetDoc.tier === 2) baseRate = set.rateLevel2 || 6.45;
            if (targetDoc.tier === 3) baseRate = set.rateLevel3 || 6.50;
            
            let finalRate = baseRate;
            if (tx.transferType === 'post_account') finalRate = baseRate - 0.05;
            else if (tx.transferType === 'post_card') finalRate = baseRate - 0.15;
            if (finalRate <= 0) finalRate = baseRate;
            
            const newCost = parseFloat((newAmount / finalRate).toFixed(3));
            diffAmount = newCost - oldLYD;
            refundLYD = oldLYD - newCost;
            
            if (diffAmount > 0 && targetDoc.balance < diffAmount) {
                return res.status(400).json({ success: false, message: 'INSUFFICIENT_FUNDS' });
            }
            
            targetDoc.balance -= diffAmount;
            await targetDoc.save();
            
            tx.costLYD = newCost;
        }

        tx.proofImage = proofImage;
        tx.proofImages = [proofImage];
        tx.status = 'completed';
        tx.notes = (tx.notes ? tx.notes + ' | ' : '') + `تعديل مبلغ من ${oldAmount} إلى ${newAmount}`;
        await tx.save();

        const clientMsg = `✅ <b>تم تنفيذ طلبك جزئياً!</b>\n\n🧾 الطلب: <code>${tx.customId || tx._id}</code>\n⚠️ <b>ملاحظة:</b> تم التحويل بمبلغ ${newAmount} EGP (بدلاً من ${oldAmount} EGP)\n💰 <b>تم إرجاع الفارق:</b> ${refundLYD.toFixed(2)} دينار لحسابك.\n\n<i>مرفق الإثبات أدناه.</i>`;
        await sendProofToClientRecipients(tx, {
            caption: clientMsg,
            proofRefs: [proofImage],
            sourceBotToken: req.botContext.botData.token
        });

        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        const adminMsg = `⚠️ <b>تم تنفيذ حوالة بنجاح (مع تعديل المبلغ)!</b>\n\n👤 <b>الجهة/العميل:</b> ${tx.companyName || 'عميل فردي'}\n👤 <b>اسم المرسل:</b> ${tx.employeeName || 'غير مسجل'}\n🤖 <b>بواسطة بوت:</b> ${tx.executorBotName || 'غير محدد'}\n👨‍💻 <b>الموظف المنفذ:</b> ${tx.executorName || 'غير محدد'}\n━━━━━━━━━━━━━━\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>الرقم المحول إليه:</b> <code>${tx.vodafoneNumber}</code>\n💵 <b>المبلغ الجديد:</b> ${newAmount} EGP (كان ${oldAmount})\n💰 <b>تم إرجاع:</b> ${refundLYD.toFixed(2)} LYD للعميل.`;
        
        const allAdmins = await Admin.find({});
        for (const admin of allAdmins) {
            try { await adminAPI.sendPhoto(admin.telegramId, proofImage, { caption: adminMsg, parse_mode: 'HTML' }); } catch(e){}
        }

        res.json({ success: true, tx, diffAmount, oldAmount });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/executor/transactions/phone', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { txId, phone } = req.body;
        
        const tx = await Transaction.findById(txId);
        if (!tx) return res.status(404).json({ success: false });
        
        tx.providedSenderPhone = phone;
        await tx.save();
        res.json({ success: true, tx });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/executor/support/ticket', async (req, res) => {
    try {
        const { telegramId, message, type } = req.body;
        if (req.botContext.type !== 'executor' || type !== 'executor') {
            return res.status(403).json({ success: false });
        }

        const emp = await Employee.findOne({ telegramId, botId: req.botContext.botData._id });
        if (!emp) return res.status(404).json({ success: false });

        let ticket = await SupportTicket.findOne({ telegramId, status: { $ne: 'closed' } });
        if (!ticket) {
            ticket = new SupportTicket({
                entityType: 'executor',
                entityId: emp._id,
                telegramId,
                name: emp.name || 'منفذ',
                phone: emp.phone || 'غير مسجل',
                botToken: req.botContext.botData.token,
                messages: []
            });
        }

        ticket.messages.push({
            sender: 'user',
            senderName: emp.name || 'منفذ',
            text: message || '',
            createdAt: new Date()
        });
        ticket.status = 'open';
        ticket.unreadAdmin = (ticket.unreadAdmin || 0) + 1;
        await ticket.save();
        
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.get('/executor/child-bots', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const bots = await ExecutorBot.find({ parentBotId: req.botContext.botData._id }).lean();
        res.json({ success: true, bots });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/executor/child-bots/settle', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { childId } = req.body;
        
        const child = await ExecutorBot.findById(childId);
        if (!child || child.parentBotId.toString() !== req.botContext.botData._id.toString()) return res.status(400).json({ success: false });
        
        const amount = child.balance;
        child.balance = 0;
        await child.save();
        
        req.botContext.botData.balance += amount;
        await req.botContext.botData.save();
        
        res.json({ success: true, amount });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/executor/report-data', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { employeeName, start, end } = req.body;
        const botData = req.botContext.botData;
        
        let filter = { executorBotId: botData._id, status: 'completed' };
        if (employeeName && employeeName !== 'الكل') filter.executorEmployeeName = employeeName;
        if (start && end) filter.updatedAt = { $gte: new Date(start), $lte: new Date(end) };
        
        const txs = await Transaction.find(filter).sort({ updatedAt: 1 }).lean();
        const settings = await Settings.findOne({}).lean() || {};
        
        res.json({ success: true, txs, settings });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/executor/web-credentials', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { telegramId, username, password } = req.body;
        const botData = req.botContext.botData;

        let emp = await Employee.findOne({ telegramId, botId: botData._id });
        if (!emp) return res.status(404).json({ success: false, message: 'Not found' });

        const empExists = await Employee.findOne({ webUsername: username });
        if (empExists && empExists.telegramId !== telegramId) {
            return res.status(400).json({ success: false, message: 'Username taken' });
        }
        
        emp.webUsername = username;
        emp.webPassword = password;
        await emp.save();

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});


router.post('/executor/transactions/reject', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { txId, telegramId, reason } = req.body;
        
        const tx = await Transaction.findById(txId);
        if (!tx) return res.status(404).json({ success: false });

        tx.status = 'rejected';
        tx.notes = (tx.notes ? tx.notes + '\n' : '') + `[تم الإلغاء | السبب: ${reason}]`;
        await tx.save();

        if (tx.clientBotId) await ClientBot.findByIdAndUpdate(tx.clientBotId, { $inc: { balance: tx.costLYD } });
        else await User.findOneAndUpdate({ telegramId: tx.userId }, { $inc: { balance: tx.costLYD } });

        let clientAPI;
        if (tx.clientBotId) {
            const comp = await ClientBot.findById(tx.clientBotId);
            if (comp) clientAPI = new Telegram(comp.token);
        }
        if (!clientAPI) clientAPI = new Telegram(process.env.CLIENT_BOT_TOKEN);
        
        const clientMsg = `❌ <b>تم إلغاء طلب التحويل وإرجاع الرصيد!</b>\n\n👤 <b>المرسل:</b> ${tx.employeeName || 'غير محدد'}\n🧾 <b>رقم العملية:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>رقم الهاتف/الحساب:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP\n⚠️ <b>سبب الإلغاء:</b> ${reason}`;
        
        try { await clientAPI.sendMessage(tx.userId, clientMsg, { parse_mode: 'HTML' }); } catch(e){}

        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        const adminMsg = `🚨 <b>تنبيه للإدارة: تم إلغاء عملية من قِبل المنفذ!</b>\n\n🏢 <b>الجهة/العميل:</b> ${tx.companyName || 'عميل فردي'}\n👤 <b>الموظف الطالب:</b> ${tx.employeeName || 'غير محدد'}\n🤖 <b>بواسطة المنفذ:</b> ${tx.executorName}\n\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>الرقم/الحساب:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP\n🇱🇾 <b>التكلفة المسترجعة:</b> ${tx.costLYD.toFixed(2)} LYD\n⚠️ <b>سبب الإلغاء:</b> <b>${reason}</b>`;
        
        const allAdmins = await Admin.find({});
        for (const admin of allAdmins) {
            await adminAPI.sendMessage(admin.telegramId, adminMsg, { parse_mode: 'HTML' }).catch(()=>{});
        }

        res.json({ success: true, tx });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});


router.post('/executor/closing/submit', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { telegramId, dateStr, imageBuffer, note } = req.body;
        
        const txs = await Transaction.find({ executorBotId: req.botContext.botData._id, status: 'completed' });
        
        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        const adminMsg = `🏦 <b>طلب إغلاق مالي جديد من منفذ</b>\n\n👤 <b>الجهة/الشركة:</b> ${req.botContext.botData.name}\n📅 <b>التاريخ:</b> ${dateStr}\n📝 <b>ملاحظة المنفذ:</b> ${note || 'لا يوجد'}`;
        
        const allAdmins = await Admin.find({});
        for (const admin of allAdmins) {
            try {
                if (imageBuffer) {
                    // Requires imageBuffer as base64 string from client
                    const buffer = Buffer.from(imageBuffer, 'base64');
                    await adminAPI.sendPhoto(admin.telegramId, { source: buffer }, { caption: adminMsg, parse_mode: 'HTML' });
                } else {
                    await adminAPI.sendMessage(admin.telegramId, adminMsg, { parse_mode: 'HTML' });
                }
            } catch(e){}
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/executor/complaint/resolve', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { txId, telegramId, resolutionNote, typeName, imageBuffer } = req.body;
        
        const tx = await Transaction.findById(txId);
        if (!tx) return res.status(404).json({ success: false });

        let opName = "مجهول";
        const emp = await Employee.findOne({ telegramId, botId: req.botContext.botData._id });
        if (emp) opName = emp.name;

        const adminMsg = `🏁 <b>تقرير حل شكوى من المنفذ</b>\n\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>رقم المحفظة:</b> <code>${tx.vodafoneNumber}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP\n👤 <b>الموظف المسؤول:</b> ${opName}\n━━━━━━━━━━━━━━\n📌 <b>الإجراء المتخذ:</b> ${typeName}\n📝 <b>ملاحظة الموظف:</b>\n<i>"${resolutionNote}"</i>` + (imageBuffer ? '' : `\n\n⚠️ <i>(تم الإرسال بدون إرفاق صورة جديدة)</i>`);

        const adminKeyboard = { inline_keyboard: [
            [{ text: '✅ إغلاق الشكوى نهائياً', callback_data: `compSolved_${tx._id}` }],
            [{ text: '❌ إلغاء وخصم القيمة', callback_data: `compCancel_${tx._id}` }]
        ] };

        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        const allAdmins = await Admin.find({});
        const adminIds = new Set(allAdmins.map(a => a.telegramId));
        if (process.env.ADMIN_TELEGRAM_ID) adminIds.add(process.env.ADMIN_TELEGRAM_ID);

        for (const targetAdminId of adminIds) {
            try {
                if (imageBuffer) {
                    const buffer = Buffer.from(imageBuffer, 'base64');
                    await adminAPI.sendPhoto(targetAdminId, { source: buffer }, { caption: adminMsg, parse_mode: 'HTML', reply_markup: adminKeyboard });
                } else {
                    await adminAPI.sendMessage(targetAdminId, adminMsg, { parse_mode: 'HTML', reply_markup: adminKeyboard });
                }
            } catch(e){}
        }

        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});


router.post('/executor/bot/status', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { status } = req.body;
        req.botContext.botData.status = status;
        await req.botContext.botData.save();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/executor/employee/manage', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { action, empId } = req.body; // action: approve, reject, suspend, activate
        
        const emp = await Employee.findById(empId);
        if (!emp || emp.botId.toString() !== req.botContext.botData._id.toString()) return res.status(400).json({ success: false });

        if (action === 'approve') emp.status = 'active';
        else if (action === 'reject') { await Employee.findByIdAndDelete(empId); return res.json({ success: true, emp }); }
        else if (action === 'suspend') emp.status = 'suspended';
        else if (action === 'activate') emp.status = 'active';

        await emp.save();
        res.json({ success: true, emp });
    } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/executor/task/action', async (req, res) => {
    try {
        if (req.botContext.type !== 'executor') return res.status(403).json({ success: false });
        const { action, txId, telegramId } = req.body; // action: accept, reject

        const tx = await Transaction.findById(txId);
        if (!tx) return res.status(404).json({ success: false });

        const emp = await Employee.findOne({ telegramId, botId: req.botContext.botData._id });
        if (!emp) return res.status(403).json({ success: false });

        if (action === 'accept') {
            if (tx.status !== 'processing') return res.status(400).json({ success: false, message: 'Taken' });
            tx.status = 'accepted';
            tx.executorEmployeeName = emp.name;
            await tx.save();
            res.json({ success: true, tx });
        } else if (action === 'reject') {
            if (tx.status !== 'processing') return res.status(400).json({ success: false, message: 'Handled' });
            tx.status = 'pending';
            tx.executorBotId = undefined;
            await tx.save();
            res.json({ success: true, tx });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

module.exports = router;
