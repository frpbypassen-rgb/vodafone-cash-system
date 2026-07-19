const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { verifyAndUpgradePassword } = require('../utils/helpers');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

const User = require('../models/User');
const ClientEmployee = require('../models/ClientEmployee');
const Employee = require('../models/Employee');
const Transaction = require('../models/Transaction');
const Ledger = require('../models/Ledger');
const Settings = require('../models/Settings');
const ClientBot = require('../models/ClientBot');
const ExecutorBot = require('../models/ExecutorBot');
const Admin = require('../models/Admin');
const Counter = require('../models/Counter');
const { Telegram } = require('telegraf');

const { authenticateJWT, JWT_SECRET, JWT_REFRESH_SECRET } = require('../middlewares/jwtAuth');
const { logAction } = require('../services/auditService');
const { getRateForTier } = require('../utils/rateHelper');
const { validationResult } = require('express-validator');
const {
    loginValidator,
    transferValidator,
    cancelTaskValidator,
    completeTaskValidator,
    refreshTokenValidator
} = require('../validators/mobileValidators');

// =======================================================
// 🛡️ Rate Limiters مخصصة لكل مسار حساس
// =======================================================
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 8,                   // 8 محاولات فقط
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'TOO_MANY_REQUESTS', message: 'عدد كبير من محاولات الدخول، يرجى الانتظار 15 دقيقة' }
});

const transferLimiter = rateLimit({
    windowMs: 60 * 1000,      // دقيقة واحدة
    max: 15,                  // 15 طلب تحويل في الدقيقة
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'TOO_MANY_REQUESTS', message: 'معدل طلبات التحويل مرتفع جداً، يرجى الانتظار قليلاً' }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'TOO_MANY_REQUESTS', message: 'معدل الطلبات مرتفع جداً' }
});

// تطبيق حد عام على جميع مسارات الـ Mobile API
router.use(apiLimiter);

// =======================================================
// 1️⃣ نظام تسجيل الدخول وتجديد التوكن
// =======================================================
router.post('/login', loginLimiter, loginValidator, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: errors.array()[0].msg });
    }

    try {
        const { username, password } = req.body;
        const searchUser = username.trim().toLowerCase();
        const searchPass = password.trim();

        let account = null; let accountType = ''; let finalBalance = 0; let telegramId = null; let executorBotId = null;

        // 🔄 الأولوية: Employee → ClientEmployee → User
        // 1. فحص المنفذ (Employee)
        const execDoc = await Employee.findOne({ $or: [{ webUsername: searchUser }, { phone: username }] }).populate('botId');
        if (execDoc) {
            const isMatch = await verifyAndUpgradePassword(searchPass, execDoc.webPassword, Employee, execDoc._id);
            if (isMatch) {
                if (execDoc.status !== 'active') {
                    await logAction({ action: 'LOGIN_FAILED', req, performedByName: username, metadata: { reason: 'ACCOUNT_BANNED', accountType: 'executor' }, success: false, errorCode: 'ACCOUNT_BANNED' });
                    return res.status(403).json({ success: false, code: 'ACCOUNT_BANNED', message: 'الحساب معلق' });
                }
                account = execDoc;
                accountType = 'executor';
                telegramId = execDoc.telegramId;
                executorBotId = execDoc.botId ? execDoc.botId._id : null;
                finalBalance = execDoc.botId ? execDoc.botId.balance : 0;
            }
        }

        // 2. فحص موظف الشركة (ClientEmployee)
        if (!account) {
            const empDoc = await ClientEmployee.findOne({ $or: [{ webUsername: searchUser }, { phone: username }] });
            if (empDoc) {
                const isMatch = await verifyAndUpgradePassword(searchPass, empDoc.webPassword, ClientEmployee, empDoc._id);
                if (isMatch) {
                    if (empDoc.status !== 'active') {
                        await logAction({ action: 'LOGIN_FAILED', req, performedByName: username, metadata: { reason: 'ACCOUNT_BANNED', accountType: 'client_company' }, success: false, errorCode: 'ACCOUNT_BANNED' });
                        return res.status(403).json({ success: false, code: 'ACCOUNT_BANNED', message: 'الحساب معلق' });
                    }
                    account = empDoc;
                    accountType = 'client_company';
                    telegramId = empDoc.telegramId;
                    const company = await ClientBot.findById(empDoc.clientBotId);
                    finalBalance = company ? company.balance : 0;
                }
            }
        }

        // 3. فحص العميل الفردي (User)
        if (!account) {
            const userDoc = await User.findOne({ $or: [{ webUsername: searchUser }, { phone: username }] });
            if (userDoc) {
                const isMatch = await verifyAndUpgradePassword(searchPass, userDoc.webPassword, User, userDoc._id);
                if (isMatch) {
                    if (userDoc.status !== 'active') {
                        await logAction({ action: 'LOGIN_FAILED', req, performedByName: username, metadata: { reason: 'ACCOUNT_BANNED', accountType: 'client_user' }, success: false, errorCode: 'ACCOUNT_BANNED' });
                        return res.status(403).json({ success: false, code: 'ACCOUNT_BANNED', message: 'الحساب معلق' });
                    }
                    account = userDoc;
                    accountType = 'client_user';
                    finalBalance = userDoc.balance;
                    telegramId = userDoc.telegramId;
                }
            }
        }

        if (!account) {
            await logAction({ action: 'LOGIN_FAILED', req, performedByName: username, metadata: { reason: 'INVALID_CREDENTIALS' }, success: false, errorCode: 'INVALID_CREDENTIALS' });
            return res.status(401).json({ success: false, code: 'INVALID_CREDENTIALS', message: 'بيانات الدخول غير صحيحة' });
        }

        executorBotId = account.executorBotId || null;
        const accessToken = jwt.sign({ userId: account._id, accountType, telegramId, executorBotId }, JWT_SECRET, { expiresIn: '1h' });
        const refreshToken = jwt.sign({ userId: account._id, accountType }, JWT_REFRESH_SECRET, { expiresIn: '30d' });

        const Model = accountType === 'executor' ? Employee : (accountType === 'client_company' ? ClientEmployee : User);
        await Model.updateOne({ _id: account._id }, { $set: { refreshToken } }, { strict: false });

        // تسجيل نجاح الدخول في سجل التدقيق
        await logAction({
            action: 'LOGIN_SUCCESS',
            req,
            performedById: account._id,
            performedByModel: accountType === 'executor' ? 'Employee' : (accountType === 'client_company' ? 'ClientEmployee' : 'User'),
            performedByName: account.name,
            metadata: { accountType }
        });

        // حساب معدل الصرف والدرجة بناءً على نوع الحساب
        const settings = await Settings.findOne({});
        let tier = 1;
        if (accountType === 'client_company') {
            const company = await ClientBot.findById(account.clientBotId);
            tier = (company && company.tier) ? company.tier : 1;
        } else if (accountType === 'client_user') {
            tier = account.tier || 1;
        }
        const currentRate = getRateForTier(tier, settings);

        res.json({
            success: true,
            accessToken,
            refreshToken,
            user: {
                name: account.name,
                balance: finalBalance,
                tier: tier
            },
            rate: currentRate
        });
    } catch (error) {
        console.error('[Login Error]', error.message);
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'خطأ في السيرفر' });
    }
});

router.post('/refresh-token', refreshTokenValidator, async (req, res) => {
    const { refreshToken } = req.body;

    jwt.verify(refreshToken, JWT_REFRESH_SECRET, async (err, decoded) => {
        if (err) return res.status(403).json({ success: false, code: 'TOKEN_INVALID', message: 'توكن غير صالح أو منتهي' });

        try {
            const { userId, accountType } = decoded;
            const Model = accountType === 'executor' ? Employee : (accountType === 'client_company' ? ClientEmployee : User);
            const account = await Model.findById(userId).populate(accountType === 'executor' ? 'botId' : '');

            if (!account || account.refreshToken !== refreshToken || account.status !== 'active') {
                await logAction({ action: 'TOKEN_REFRESH', req, performedById: userId, performedByModel: accountType === 'executor' ? 'Employee' : 'User', success: false, errorCode: 'SESSION_REVOKED' });
                return res.status(403).json({ success: false, code: 'SESSION_REVOKED', message: 'تم إبطال الجلسة' });
            }

            const telegramId = account.telegramId;
            const executorBotId = accountType === 'executor' && account.botId ? account.botId._id : null;
            const newAccessToken = jwt.sign({ userId: account._id, accountType, telegramId, executorBotId }, JWT_SECRET, { expiresIn: '1h' });
            res.json({ success: true, token: newAccessToken });
        } catch (e) {
            res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'خطأ في السيرفر' });
        }
    });
});

router.post('/logout', authenticateJWT, async (req, res) => {
    try {
        const { userId, accountType } = req.user;
        const Model = accountType === 'executor' ? Employee : (accountType === 'client_company' ? ClientEmployee : User);
        await Model.updateOne({ _id: userId }, { $unset: { refreshToken: 1 } }, { strict: false });
        res.json({ success: true, message: 'تم تسجيل الخروج وإبطال الجلسة' });
    } catch(e) { res.status(500).json({ success: false, message: 'خطأ داخلي' }); }
});

// ✅ New route: client home (GET /client/home)
router.get('/client/home', authenticateJWT, async (req, res) => {
    try {
        const { userId, accountType } = req.user;
        let balance = 0;
        let tier = 1;
        if (accountType === 'client_company') {
            const emp = await ClientEmployee.findById(userId);
            if (emp) {
                const comp = await ClientBot.findById(emp.clientBotId);
                if (comp) {
                    balance = comp.balance || 0;
                    tier = comp.tier || 1;
                }
            }
        } else if (accountType === 'client_user') {
            const user = await User.findById(userId);
            if (user) {
                balance = user.balance || 0;
                tier = user.tier || 1;
            }
        }
        const settings = await Settings.findOne({});
        const currentRate = getRateForTier(tier, settings);
        const isOpen = true;
        res.json({ success: true, balance: Number(balance), rate: Number(currentRate), isOpen });
    } catch (e) {
        console.error('[Client Home]', e);
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'خطأ داخلي' });
    }
});

// =======================================================
// 2️⃣ مسارات العملاء (سجل العمليات والأسعار)
// =======================================================


router.post('/client/exchange-rate', authenticateJWT, async (req, res) => {
    try {
        const { userId, accountType } = req.user;
        const settings = await Settings.findOne({});
        let finalRate = getRateForTier(1, settings);
        let balance = 0;

        if (accountType === 'client_company') {
            const emp = await ClientEmployee.findById(userId);
            if (emp) {
                const comp = await ClientBot.findById(emp.clientBotId);
                if (comp) {
                    finalRate = getRateForTier(comp.tier || 1, settings);
                    balance = comp.balance || 0;
                }
            }
        } else if (accountType === 'client_user') {
            const user = await User.findById(userId);
            if (user) {
                finalRate = getRateForTier(user.tier || 1, settings);
                balance = user.balance || 0;
            }
        }
        res.json({ success: true, balance: Number(balance), exchangeRate: Number(finalRate) });
    } catch (error) {
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'خطأ داخلي بالسيرفر' });
    }
});

// =======================================================
// 3️⃣ مسار التحويل البنكي المحصن (Idempotency + Ledger + Transactions)
// =======================================================
router.post('/client/new-transfer', authenticateJWT, transferLimiter, transferValidator, async (req, res) => {
    // 🟢 بدء المعاملة الذرية (Transaction)
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { transferType, amount, number, name, notes } = req.body;
        const { userId, accountType } = req.user; 
        if(accountType === 'executor') throw new Error('FORBIDDEN');

        // 🛡️ 1. منع التكرار (Idempotency Check)
        const idempotencyKey = req.headers['idempotency-key'];
        if (idempotencyKey) {
            const existingTx = await Transaction.findOne({ idempotencyKey }).session(session);
            if (existingTx) {
                await session.abortTransaction();
                session.endSession();
                return res.json({ success: true, code: 'DUPLICATE_IGNORED', message: 'تم إرسال الطلب بالفعل', txId: existingTx.customId });
            }
        }

        const settings = await Settings.findOne({}).session(session);
        if (settings && settings.isManualClosed) throw new Error('SYSTEM_CLOSED');

        let clientDoc, currentRate = settings ? (settings.rateLevel1 || 6.40) : 6.40;
        let companyName = 'عميل فردي', employeeName = 'غير محدد';
        let TargetModel, targetId, creditLimit = 0;
        let telegramIdForTx = null, clientBotIdForTx = null;

        // 🛡️ 2. تحديد نوع العميل وسحب البيانات
        if (accountType === 'client_user') {
            clientDoc = await User.findById(userId).session(session);
            if (clientDoc) {
                const tier = clientDoc.tier || 1;
                currentRate = getRateForTier(tier, settings);
                employeeName = clientDoc.name; creditLimit = clientDoc.creditLimit || 0;
                TargetModel = User; targetId = clientDoc._id; telegramIdForTx = clientDoc.telegramId;
            }
        } else {
            const emp = await ClientEmployee.findById(userId).session(session);
            if (emp) {
                employeeName = emp.name;
                clientDoc = await ClientBot.findById(emp.clientBotId).session(session);
                if (clientDoc) {
                    companyName = clientDoc.name;
                    const tier = clientDoc.tier || 1;
                    currentRate = getRateForTier(tier, settings);
                    creditLimit = clientDoc.creditLimit || 0;
                    TargetModel = ClientBot; targetId = clientDoc._id; clientBotIdForTx = clientDoc._id;
                }
            }
        }

        if (!clientDoc) throw new Error('USER_NOT_FOUND');

        let finalRate = currentRate;
        if (transferType === 'بريد حساب' || transferType === 'post_account') finalRate = currentRate - 0.05;
        else if (transferType === 'بريد بطاقة' || transferType === 'post_card') finalRate = currentRate - 0.15;

        const costLYD = parseFloat((amount / finalRate).toFixed(3));
        const minRequiredBalance = costLYD - creditLimit;
        
        // 🛡️ 3. خصم الرصيد مع القفل الآمن (Atomic Update)
        const updatedClient = await TargetModel.findOneAndUpdate(
            { _id: targetId, balance: { $gte: minRequiredBalance } }, 
            { $inc: { balance: -costLYD } }, 
            { new: true, session } 
        );

        if (!updatedClient) throw new Error('INSUFFICIENT_BALANCE');

        // 🛡️ 4. توليد رقم تسلسلي للفاتورة
        const counter = await Counter.findOneAndUpdate(
            { name: 'transaction' }, { $inc: { value: 1 } }, { upsert: true, new: true, session }
        );
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        const customId = `ATT-${yy}${mm}-${counter.value.toString().padStart(4, '0')}`;

        // 🛡️ 5. إنشاء فاتورة العملية
        const newTx = new Transaction({
            userId: telegramIdForTx, clientBotId: clientBotIdForTx, amount: amount, exchangeRate: finalRate,
            costLYD: costLYD, transferType: transferType, vodafoneNumber: number, accountName: name, notes: notes,
            status: 'pending', customId: customId, companyName: companyName, employeeName: employeeName,
            idempotencyKey: idempotencyKey, // حفظ الكود لمنع التكرار
            executorBotId: (settings && settings.autoRouteEnabled && settings.autoRouteBotId) ? settings.autoRouteBotId : undefined
        });
        await newTx.save({ session });

        // 🛡️ 6. تسجيل العملية في دفتر الأستاذ (Financial Ledger)
        const ledgerEntry = new Ledger({
            entityId: targetId,
            entityModel: TargetModel.modelName,
            transactionId: customId,
            type: 'TRANSFER',
            amount: -costLYD,
            balanceBefore: updatedClient.balance + costLYD,
            balanceAfter: updatedClient.balance,
            description: `تحويل ${amount} EGP إلى ${number}`
        });
        await ledgerEntry.save({ session });

        // 🟢 إتمام العملية وتثبيتها في قاعدة البيانات
        await session.commitTransaction();
        session.endSession();

        // --- إرسال إشعارات تيليجرام (خارج الـ Transaction لكي لا تعطل الحفظ) ---
        setImmediate(async () => {
            try {
                const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
                let typeLabel = transferType === 'post_account' ? '📮 حساب بريد' : (transferType === 'post_card' ? '💳 بطاقة عميل' : '📱 فودافون كاش');
                const adminMsg = `🆕 <b>طلب تحويل جديد (تطبيق الموبايل)!</b>\n\n🏢 <b>الجهة:</b> ${companyName}\n👤 <b>بواسطة:</b> ${employeeName}\nنوع التحويل: ${typeLabel}\n📞 <b>الرقم/الحساب:</b> <code>${number}</code>\n${name ? `👤 <b>الاسم:</b> ${name}\n` : ''}💵 <b>المبلغ:</b> ${amount} EGP\n💸 <b>التكلفة:</b> ${costLYD} LYD (السعر: ${finalRate.toFixed(2)})\n🧾 <b>الطلب:</b> <code>${customId}</code>\n${notes ? `📝 <b>ملاحظات:</b> ${notes}` : ''}`;
                const keyboard = { inline_keyboard: [[{ text: '🤖 توجيه لبوت التنفيذ', callback_data: `forward_${newTx._id}` }], [{ text: '❌ رفض وإلغاء', callback_data: `cancelReq_${newTx._id}` }]] };
                const admins = await Admin.find({});
                let savedAdminMsgs = [];
                for (const admin of admins) {
                    if (admin.telegramId && !admin.webUsername) {
                        try {
                            const sent = await adminAPI.sendMessage(admin.telegramId, adminMsg, { parse_mode: 'HTML', reply_markup: keyboard });
                            if(sent) savedAdminMsgs.push({ telegramId: admin.telegramId, messageId: sent.message_id });
                        } catch(e) {}
                    }
                }
                if (savedAdminMsgs.length > 0) { await Transaction.findByIdAndUpdate(newTx._id, { adminMessages: savedAdminMsgs }); }
            } catch(err) {}
        });

        // 🟢 تسجيل التحويل في Audit Log (خارج الـ Transaction)
        await logAction({
            action: 'TRANSFER_CREATED',
            req,
            performedById: userId,
            performedByModel: accountType === 'client_company' ? 'ClientEmployee' : 'User',
            performedByName: employeeName,
            targetId: newTx._id,
            targetModel: 'Transaction',
            newData: { customId, amount, number, transferType, costLYD, finalRate },
            metadata: { companyName, balance: updatedClient.balance }
        });

        res.json({ success: true, code: 'SUCCESS', message: 'تم إرسال طلبك بنجاح', txId: customId, newBalance: updatedClient.balance });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();

        if (error.message === 'INSUFFICIENT_BALANCE') {
            return res.status(400).json({ success: false, code: 'INSUFFICIENT_BALANCE', message: 'رصيد غير كافٍ أو تغير أثناء العملية' });
        } else if (error.message === 'SYSTEM_CLOSED') {
            return res.status(403).json({ success: false, code: 'SYSTEM_CLOSED', message: 'المنظومة مغلقة حالياً' });
        } else if (error.message === 'FORBIDDEN') {
            return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'صلاحيات غير كافية' });
        }
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'حدث خطأ داخلي أثناء معالجة الطلب' });
    }
});

// =======================================================
// 4️⃣ مسارات المنفذين (Executors API)
// =======================================================
router.get('/executor/live-tasks', authenticateJWT, async (req, res) => {
    try {
        const { telegramId, executorBotId, accountType } = req.user;
        if(accountType !== 'executor') return res.status(403).json({success: false});

        const tasks = await Transaction.find({ executorBotId: executorBotId, status: { $in: ['processing', 'accepted'] } }).sort({ createdAt: 1 }).lean(); 
        const alerts = await Transaction.find({ executorBotId: executorBotId, emergencyAlert: { $exists: true, $ne: null }, status: { $in: ['processing', 'accepted'] } }).lean();
        res.json({ success: true, tasks, alerts });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/executor/accept-task/:id', authenticateJWT, async (req, res) => {
    try {
        const { telegramId, accountType } = req.user;
        if(accountType !== 'executor') return res.status(403).json({success: false});

        const emp = await Employee.findOne({ telegramId }).populate('botId');
        if (!emp) return res.status(404).json({ success: false, code: 'EMPLOYEE_NOT_FOUND', message: 'لم يتم العثور على حساب المنفذ' });

        const tx = await Transaction.findOneAndUpdate(
            { _id: req.params.id, status: 'processing' },
            { $set: { status: 'accepted', operatorId: emp.telegramId, executorName: emp.name, emergencyAlert: undefined } },
            { new: true }
        );

        if (!tx) return res.json({ success: false, code: 'ALREADY_TAKEN', message: 'عذراً، تم سحب الطلب من قِبل زميل آخر' });

        if (tx.broadcastMessages && tx.broadcastMessages.length > 0) {
            const execBotAPI = new Telegram(emp.botId.token);
            let typeLabel = tx.transferType === 'post_account' ? '📮 حساب بريد' : (tx.transferType === 'post_card' ? '💳 بطاقة عميل' : '📱 فودافون كاش');
            const msgText = `🔒 <b>تم سحب المهمة (${typeLabel})</b>\n\n📞 الرقم/الحساب: <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 المبلغ: ${tx.amount} EGP\n🧾 الطلب: <code>${tx.customId}</code>\n\n👨‍💻 <b>تم الاستلام بواسطة:</b> ${emp.name}`;
            
            for (const msg of tx.broadcastMessages) {
                try {
                    if (tx.transferType === 'post_card' && tx.idCardImage) { await execBotAPI.editMessageCaption(msg.telegramId, msg.messageId, undefined, msgText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }); } 
                    else { await execBotAPI.editMessageText(msg.telegramId, msg.messageId, undefined, msgText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }); }
                } catch(e) {}
            }
        }
        res.json({ success: true });
    } catch(e) { res.json({ success: false, message: e.message }); }
});

router.post('/executor/cancel-task/:id', authenticateJWT, cancelTaskValidator, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { reason } = req.body;
        const { telegramId, accountType } = req.user;
        if(accountType !== 'executor') throw new Error('FORBIDDEN');

        const tx = await Transaction.findById(req.params.id).session(session);
        const emp = await Employee.findOne({ telegramId }).session(session);
        if (!emp) throw new Error('EMPLOYEE_NOT_FOUND');

        if (tx && tx.status === 'accepted' && tx.operatorId === emp.telegramId) {
            
            let targetId, TargetModel;
            if (tx.clientBotId) { TargetModel = ClientBot; targetId = tx.clientBotId; }
            else if (tx.userId) { TargetModel = User; targetId = await User.findOne({telegramId: tx.userId}).then(u => u._id); }

            const updatedClient = await TargetModel.findByIdAndUpdate(targetId, { $inc: { balance: tx.costLYD } }, { new: true, session });
            
            // تسجيل المرتجع في الدفتر
            const ledgerEntry = new Ledger({
                entityId: targetId, entityModel: TargetModel.modelName, transactionId: tx.customId, type: 'REFUND',
                amount: tx.costLYD, balanceBefore: updatedClient.balance - tx.costLYD, balanceAfter: updatedClient.balance,
                description: `استرجاع تكلفة حوالة ملغاة (السبب: ${reason})`
            });
            await ledgerEntry.save({ session });

            tx.status = 'rejected';
            tx.notes = (tx.notes ? tx.notes + '\n' : '') + `[تم الإلغاء | المنفذ: ${emp.name} | السبب: ${reason}]`;
            await tx.save({ session });

            await session.commitTransaction();
            session.endSession();

            // اشعارات تيليجرام
            setImmediate(async () => {
                try {
                    let clientAPI = tx.clientBotId ? new Telegram((await ClientBot.findById(tx.clientBotId)).token) : new Telegram(process.env.CLIENT_BOT_TOKEN);
                    const clientMsg = `❌ <b>تم إلغاء طلب التحويل وإرجاع الرصيد!</b>\n\n👤 <b>المرسل:</b> ${tx.employeeName || 'غير محدد'}\n🧾 <b>رقم العملية:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>رقم الهاتف/الحساب:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP\n⚠️ <b>سبب الإلغاء:</b> ${reason}`;
                    await clientAPI.sendMessage(tx.userId, clientMsg, { parse_mode: 'HTML' }).catch(()=>{});
                    
                    const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
                    const adminMsg = `🚨 <b>تنبيه للإدارة: تم إلغاء عملية من قِبل المنفذ!</b>\n\n🏢 <b>الجهة/العميل:</b> ${tx.companyName || 'عميل فردي'}\n🤖 <b>المنفذ:</b> ${emp.name}\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP\n⚠️ <b>السبب:</b> <b>${reason}</b>`;
                    const allAdmins = await Admin.find({});
                    for (const admin of allAdmins) { await adminAPI.sendMessage(admin.telegramId, adminMsg, { parse_mode: 'HTML' }).catch(()=>{}); }
                } catch(e){}
            });

            // 🟢 تسجيل الإلغاء في Audit Log
            await logAction({
                action: 'TRANSFER_CANCELLED',
                req,
                performedById: emp._id,
                performedByModel: 'Employee',
                performedByName: emp.name,
                targetId: tx._id,
                targetModel: 'Transaction',
                oldData: { status: 'accepted', costLYD: tx.costLYD },
                newData: { status: 'rejected', reason },
                metadata: { customId: tx.customId, refundAmount: tx.costLYD }
            });

            return res.json({ success: true, message: 'تم الإلغاء وإرجاع الرصيد بنجاح' });
        }
        throw new Error('INVALID_STATE');
    } catch (e) { 
        await session.abortTransaction(); session.endSession();
        res.status(500).json({ success: false, code: e.message === 'INVALID_STATE' ? 'INVALID_STATE' : 'SERVER_ERROR', message: 'فشل الإلغاء' }); 
    }
});

router.post('/executor/complete-task/:id', authenticateJWT, completeTaskValidator, async (req, res) => {
    try {
        const { imageBase64, senderPhone } = req.body;
        const { telegramId, accountType } = req.user;
        if(accountType !== 'executor') return res.status(403).json({success: false});
        if (!imageBase64) return res.json({ success: false, message: 'يرجى إرفاق صورة الإثبات' });

        const tx = await Transaction.findById(req.params.id);
        const emp = await Employee.findOne({ telegramId }).populate('botId');

        if (!tx || tx.status !== 'accepted' || tx.operatorId !== emp.telegramId) {
            return res.json({ success: false, message: 'الطلب غير متاح للإنهاء' });
        }

        if (emp.botId.parentBotId) { await ExecutorBot.findByIdAndUpdate(emp.botId.parentBotId, { $inc: { balance: -tx.amount } }); }
        await ExecutorBot.findByIdAndUpdate(emp.botId._id, { $inc: { balance: -tx.amount } });

        const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), 'base64');
        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        
        let typeLabel = tx.transferType === 'post_account' ? 'حساب بريد' : (tx.transferType === 'post_card' ? 'بطاقة عميل' : 'فودافون كاش');
        let senderPhoneDisplay = senderPhone ? `\n📞 <b>رقم المُرسل:</b> <code>${senderPhone}</code>` : '';
        const adminMsgCaption = `✅ <b>تم تنفيذ طلب تحويل (${typeLabel}) بنجاح!</b>\n\n🧾 <b>رقم الطلب:</b> <code>${tx.customId}</code>\n📞 <b>الرقم/الحساب:</b> <code>${tx.vodafoneNumber}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP\n👨‍💻 <b>المنفذ:</b> ${emp.name}${senderPhoneDisplay}`;

        let savedFileId = null;
        const admins = await Admin.find({});
        for (const admin of admins) {
            if (admin.telegramId && !admin.webUsername) {
                try {
                    let sentMsg;
                    if (!savedFileId) {
                        sentMsg = await adminAPI.sendPhoto(admin.telegramId, { source: buffer }, { caption: adminMsgCaption, parse_mode: 'HTML' });
                        savedFileId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
                    } else { await adminAPI.sendPhoto(admin.telegramId, savedFileId, { caption: adminMsgCaption, parse_mode: 'HTML' }); }
                } catch(e) {}
            }
        }

        tx.status = 'completed';
        tx.proofImage = savedFileId;
        if (senderPhone) tx.executorSenderPhone = senderPhone;
        await tx.save();

        // 🟢 تسجيل إتمام المهمة في Audit Log
        await logAction({
            action: 'TRANSFER_COMPLETED',
            req,
            performedById: emp._id,
            performedByModel: 'Employee',
            performedByName: emp.name,
            targetId: tx._id,
            targetModel: 'Transaction',
            oldData: { status: 'accepted' },
            newData: { status: 'completed', proofImage: savedFileId, senderPhone: senderPhone || null },
            metadata: { customId: tx.customId, amount: tx.amount, transferType: tx.transferType }
        });

        res.json({ success: true, message: 'تم إرسال الإثبات بنجاح' });
    } catch (e) { res.status(500).json({ success: false, message: 'خطأ في السيرفر' }); }
});

// =======================================================
// 5️⃣ 🛡️ جلب إثباتات العمليات وحماية الصلاحيات لتطبيق الموبايل
// =======================================================
router.get('/transaction/image/:id', authenticateJWT, async (req, res) => {
    try {
        const { userId, accountType, executorBotId, telegramId } = req.user;
        const tx = await Transaction.findById(req.params.id);
        if (!tx) return res.status(404).json({ success: false, message: 'العملية غير موجودة' });

        let hasAccess = false;
        if (accountType === 'executor') {
            if (tx.executorBotId && tx.executorBotId.toString() === executorBotId) hasAccess = true;
            if (tx.managerBotId && tx.managerBotId.toString() === executorBotId) hasAccess = true;
        } else if (accountType === 'client_company') {
            const emp = await ClientEmployee.findById(userId);
            if (emp && tx.clientBotId && tx.clientBotId.toString() === emp.clientBotId.toString()) hasAccess = true;
        } else if (accountType === 'client_user') {
            if (tx.userId === telegramId) hasAccess = true;
        }

        if (!hasAccess) return res.status(403).json({ success: false, message: 'غير مصرح لك بعرض هذا المرفق' });

        let photoId = tx.proofImages && tx.proofImages.length > 0 ? tx.proofImages[0] : tx.proofImage;
        if (!photoId) return res.status(404).json({ success: false, message: 'لا توجد صورة إثبات' });

        let fileLink = null;
        let tokensToTry = [process.env.ADMIN_BOT_TOKEN, process.env.CLIENT_BOT_TOKEN];
        if (tx.executorBotId) { const execBot = await ExecutorBot.findById(tx.executorBotId); if (execBot && execBot.token) tokensToTry.push(execBot.token); }
        if (tx.clientBotId) { const clientBot = await ClientBot.findById(tx.clientBotId); if (clientBot && clientBot.token) tokensToTry.push(clientBot.token); }

        for (const token of tokensToTry) {
            if (!token) continue;
            try { const api = new Telegram(token); fileLink = await api.getFileLink(photoId); if (fileLink) break; } catch(e) {}
        }

        if (!fileLink) return res.status(404).json({ success: false, message: 'لا يمكن جلب الصورة، ربما انتهت صلاحيتها' });
        res.json({ success: true, url: fileLink.href });

    } catch (e) { res.status(500).json({ success: false, message: 'خطأ داخلي في الخادم' }); }
});

module.exports = router;