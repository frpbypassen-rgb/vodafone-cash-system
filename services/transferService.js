// services/transferService.js
// ===============================================
// 💸 خدمة التحويلات — المنطق المالي الكامل
// ===============================================
'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const ClientEmployee = require('../models/ClientEmployee');
const ClientBot = require('../models/ClientBot');
const ExecutorBot = require('../models/ExecutorBot');
const Employee = require('../models/Employee');
const Transaction = require('../models/Transaction');
const Ledger = require('../models/Ledger');
const Counter = require('../models/Counter');
const Admin = require('../models/Admin');
const Settings = require('../models/Settings');
const { Telegram } = require('telegraf');
const { logAction } = require('./auditService');
const { getRateForTier } = require('../utils/rateHelper');
const logger = require('../utils/logger');

/**
 * إنشاء تحويل جديد
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.accountType
 * @param {Object} params.transferData - { transferType, amount, number, name, notes }
 * @param {Object} params.req - Express request
 * @returns {Promise<Object>}
 */
const createTransfer = async ({ userId, accountType, transferData, req }) => {
    if (accountType === 'executor') {
        return { success: false, statusCode: 403, code: 'FORBIDDEN', message: 'صلاحيات غير كافية' };
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { transferType, amount, number, name, notes } = transferData;

        // 🛡️ 1. منع التكرار (Idempotency)
        const idempotencyKey = req.headers['idempotency-key'];
        if (idempotencyKey) {
            const existingTx = await Transaction.findOne({ idempotencyKey }).session(session);
            if (existingTx) {
                await session.abortTransaction();
                session.endSession();
                return {
                    success: true,
                    statusCode: 200,
                    code: 'DUPLICATE_IGNORED',
                    message: 'تم إرسال الطلب بالفعل',
                    txId: existingTx.customId
                };
            }
        }

        // 🛡️ 2. التحقق من حالة النظام
        const settings = await Settings.findOne({}).session(session);
        if (settings && settings.isManualClosed) {
            await session.abortTransaction();
            session.endSession();
            return { success: false, statusCode: 403, code: 'SYSTEM_CLOSED', message: 'المنظومة مغلقة حالياً' };
        }

        // 🛡️ 3. تحديد نوع العميل
        const clientInfo = await _resolveClient(userId, accountType, settings, session);
        if (!clientInfo) {
            await session.abortTransaction();
            session.endSession();
            return { success: false, statusCode: 404, code: 'USER_NOT_FOUND', message: 'المستخدم غير موجود' };
        }

        const { clientDoc, currentRate, companyName, employeeName, TargetModel, targetId,
            creditLimit, telegramIdForTx, clientBotIdForTx } = clientInfo;

        // 🛡️ 4. حساب التكلفة
        let finalRate = currentRate;
        if (transferType === 'بريد حساب' || transferType === 'post_account') finalRate = currentRate - 0.05;
        else if (transferType === 'بريد بطاقة' || transferType === 'post_card') finalRate = currentRate - 0.15;

        const costLYD = parseFloat((amount / finalRate).toFixed(3));
        const minRequiredBalance = costLYD - creditLimit;

        // 🛡️ 5. خصم الرصيد (Atomic)
        const updatedClient = await TargetModel.findOneAndUpdate(
            { _id: targetId, balance: { $gte: minRequiredBalance } },
            { $inc: { balance: -costLYD } },
            { new: true, session }
        );

        if (!updatedClient) {
            await session.abortTransaction();
            session.endSession();
            return { success: false, statusCode: 400, code: 'INSUFFICIENT_BALANCE', message: 'رصيد غير كافٍ أو تغير أثناء العملية' };
        }

        // 🛡️ 6. توليد رقم الفاتورة
        const counter = await Counter.findOneAndUpdate(
            { name: 'transaction' }, { $inc: { value: 1 } }, { upsert: true, new: true, session }
        );
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        const customId = `ATT-${yy}${mm}-${counter.value.toString().padStart(4, '0')}`;

        // 🛡️ 7. إنشاء العملية
        const newTx = new Transaction({
            userId: telegramIdForTx, clientBotId: clientBotIdForTx, amount, exchangeRate: finalRate,
            costLYD, transferType, vodafoneNumber: number, accountName: name, notes,
            status: 'pending', customId, companyName, employeeName,
            idempotencyKey,
            executorBotId: (settings && settings.autoRouteEnabled && settings.autoRouteBotId) ? settings.autoRouteBotId : undefined
        });
        await newTx.save({ session });

        // 🛡️ 8. القيد في دفتر الأستاذ
        const ledgerEntry = new Ledger({
            entityId: targetId, entityModel: TargetModel.modelName, transactionId: customId,
            type: 'TRANSFER', amount: -costLYD,
            balanceBefore: updatedClient.balance + costLYD, balanceAfter: updatedClient.balance,
            description: `تحويل ${amount} EGP إلى ${number}`
        });
        await ledgerEntry.save({ session });

        // 🟢 إتمام المعاملة
        await session.commitTransaction();
        session.endSession();

        // إرسال إشعارات (خارج الـ Transaction)
        _notifyAdminsNewTransfer(newTx, companyName, employeeName, transferType, number, name, amount, costLYD, finalRate, customId, notes).catch(() => {});

        // تسجيل في Audit Log
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

        logger.financial('Transfer created', {
            customId, amount, costLYD, transferType, userId, companyName
        });

        return {
            success: true,
            statusCode: 200,
            code: 'SUCCESS',
            message: 'تم إرسال طلبك بنجاح',
            txId: customId,
            newBalance: updatedClient.balance
        };
    } catch (error) {
        try { await session.abortTransaction(); session.endSession(); } catch (_) {}
        logger.error('Transfer creation failed', { error: error.message, userId });
        return { success: false, statusCode: 500, code: 'SERVER_ERROR', message: 'حدث خطأ داخلي أثناء معالجة الطلب' };
    }
};

/**
 * إلغاء مهمة وإرجاع الرصيد
 */
const cancelTransfer = async ({ taskId, telegramId, reason, req }) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const tx = await Transaction.findById(taskId).session(session);
        const emp = await Employee.findOne({ telegramId }).session(session);
        if (!emp) throw new Error('EMPLOYEE_NOT_FOUND');

        if (!tx || tx.status !== 'accepted' || tx.operatorId !== emp.telegramId) {
            throw new Error('INVALID_STATE');
        }

        // تحديد الجهة المستهدفة
        let targetId, TargetModel;
        if (tx.clientBotId) {
            TargetModel = ClientBot;
            targetId = tx.clientBotId;
        } else if (tx.userId) {
            TargetModel = User;
            const u = await User.findOne({ telegramId: tx.userId });
            targetId = u._id;
        }

        // إرجاع الرصيد
        const updatedClient = await TargetModel.findByIdAndUpdate(
            targetId, { $inc: { balance: tx.costLYD } }, { new: true, session }
        );

        // تسجيل المرتجع في الدفتر
        const ledgerEntry = new Ledger({
            entityId: targetId, entityModel: TargetModel.modelName, transactionId: tx.customId,
            type: 'REFUND', amount: tx.costLYD,
            balanceBefore: updatedClient.balance - tx.costLYD, balanceAfter: updatedClient.balance,
            description: `استرجاع تكلفة حوالة ملغاة (السبب: ${reason})`
        });
        await ledgerEntry.save({ session });

        tx.status = 'rejected';
        tx.notes = (tx.notes ? tx.notes + '\n' : '') + `[تم الإلغاء | المنفذ: ${emp.name} | السبب: ${reason}]`;
        await tx.save({ session });

        await session.commitTransaction();
        session.endSession();

        // إشعارات تيليجرام (خارج الـ Transaction)
        _notifyCancellation(tx, emp, reason).catch(() => {});

        // Audit Log
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

        logger.financial('Transfer cancelled', {
            customId: tx.customId, executor: emp.name, reason, refund: tx.costLYD
        });

        return { success: true, statusCode: 200, message: 'تم الإلغاء وإرجاع الرصيد بنجاح' };
    } catch (e) {
        try { await session.abortTransaction(); session.endSession(); } catch (_) {}
        const code = e.message === 'INVALID_STATE' ? 'INVALID_STATE' : 'SERVER_ERROR';
        return { success: false, statusCode: 500, code, message: 'فشل الإلغاء' };
    }
};

// ─── Helper Functions ────────────────────────────────────────

/**
 * تحديد نوع العميل واسترجاع البيانات
 */
const _resolveClient = async (userId, accountType, settings, session) => {
    let clientDoc, currentRate, companyName = 'عميل فردي', employeeName = 'غير محدد';
    let TargetModel, targetId, creditLimit = 0;
    let telegramIdForTx = null, clientBotIdForTx = null;

    if (accountType === 'client_user') {
        clientDoc = await User.findById(userId).session(session);
        if (clientDoc) {
            const tier = clientDoc.tier || 1;
            currentRate = getRateForTier(tier, settings);
            employeeName = clientDoc.name;
            creditLimit = clientDoc.creditLimit || 0;
            TargetModel = User;
            targetId = clientDoc._id;
            telegramIdForTx = clientDoc.telegramId;
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
                TargetModel = ClientBot;
                targetId = clientDoc._id;
                clientBotIdForTx = clientDoc._id;
            }
        }
    }

    if (!clientDoc) return null;

    return {
        clientDoc, currentRate, companyName, employeeName,
        TargetModel, targetId, creditLimit,
        telegramIdForTx, clientBotIdForTx
    };
};

/**
 * إرسال إشعار للمديرين عند إنشاء تحويل جديد
 */
const _notifyAdminsNewTransfer = async (newTx, companyName, employeeName, transferType, number, name, amount, costLYD, finalRate, customId, notes) => {
    try {
        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        let typeLabel = transferType === 'post_account' ? '📮 حساب بريد' : (transferType === 'post_card' ? '💳 بطاقة عميل' : '📱 فودافون كاش');
        const adminMsg = `🆕 <b>طلب تحويل جديد (تطبيق الموبايل)!</b>\n\n🏢 <b>الجهة:</b> ${companyName}\n👤 <b>بواسطة:</b> ${employeeName}\nنوع التحويل: ${typeLabel}\n📞 <b>الرقم/الحساب:</b> <code>${number}</code>\n${name ? `👤 <b>الاسم:</b> ${name}\n` : ''}💵 <b>المبلغ:</b> ${amount} EGP\n💸 <b>التكلفة:</b> ${costLYD} LYD (السعر: ${finalRate.toFixed(2)})\n🧾 <b>الطلب:</b> <code>${customId}</code>\n${notes ? `📝 <b>ملاحظات:</b> ${notes}` : ''}`;
        const keyboard = {
            inline_keyboard: [
                [{ text: '🤖 توجيه لبوت التنفيذ', callback_data: `forward_${newTx._id}` }],
                [{ text: '❌ رفض وإلغاء', callback_data: `cancelReq_${newTx._id}` }]
            ]
        };
        const admins = await Admin.find({});
        let savedAdminMsgs = [];
        for (const admin of admins) {
            if (admin.telegramId && !admin.webUsername) {
                try {
                    const sent = await adminAPI.sendMessage(admin.telegramId, adminMsg, { parse_mode: 'HTML', reply_markup: keyboard });
                    if (sent) savedAdminMsgs.push({ telegramId: admin.telegramId, messageId: sent.message_id });
                } catch (e) {}
            }
        }
        if (savedAdminMsgs.length > 0) {
            await Transaction.findByIdAndUpdate(newTx._id, { adminMessages: savedAdminMsgs });
        }
    } catch (err) {
        logger.error('Failed to notify admins about new transfer', { error: err.message });
    }
};

/**
 * إشعارات إلغاء العملية
 */
const _notifyCancellation = async (tx, emp, reason) => {
    try {
        let clientAPI = tx.clientBotId
            ? new Telegram((await ClientBot.findById(tx.clientBotId)).token)
            : new Telegram(process.env.CLIENT_BOT_TOKEN);
        const clientMsg = `❌ <b>تم إلغاء طلب التحويل وإرجاع الرصيد!</b>\n\n👤 <b>المرسل:</b> ${tx.employeeName || 'غير محدد'}\n🧾 <b>رقم العملية:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>رقم الهاتف/الحساب:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP\n⚠️ <b>سبب الإلغاء:</b> ${reason}`;
        await clientAPI.sendMessage(tx.userId, clientMsg, { parse_mode: 'HTML' }).catch(() => {});

        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
        const adminMsg = `🚨 <b>تنبيه للإدارة: تم إلغاء عملية من قِبل المنفذ!</b>\n\n🏢 <b>الجهة/العميل:</b> ${tx.companyName || 'عميل فردي'}\n🤖 <b>المنفذ:</b> ${emp.name}\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP\n⚠️ <b>السبب:</b> <b>${reason}</b>`;
        const allAdmins = await Admin.find({});
        for (const admin of allAdmins) {
            await adminAPI.sendMessage(admin.telegramId, adminMsg, { parse_mode: 'HTML' }).catch(() => {});
        }
    } catch (e) {
        logger.error('Failed to send cancellation notifications', { error: e.message });
    }
};

module.exports = { createTransfer, cancelTransfer };
