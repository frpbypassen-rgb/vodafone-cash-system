// controllers/executor/executorController.js
// ===============================================
// 👷 Controller — عمليات المنفذين
// ===============================================
'use strict';

const Transaction = require('../../models/Transaction');
const Employee = require('../../models/Employee');
const ExecutorBot = require('../../models/ExecutorBot');
const Admin = require('../../models/Admin');
const { Telegram } = require('telegraf');
const transferService = require('../../services/transferService');
const { logAction } = require('../../services/auditService');

/**
 * GET /executor/live-tasks — المهام المتاحة
 */
const getLiveTasks = async (req, res) => {
    try {
        const { telegramId, executorBotId, accountType } = req.user;
        if (accountType !== 'executor') return res.status(403).json({ success: false });

        const tasks = await Transaction.find({
            executorBotId, status: { $in: ['processing', 'accepted'] }
        }).sort({ createdAt: 1 }).lean();

        const alerts = await Transaction.find({
            executorBotId,
            emergencyAlert: { $exists: true, $ne: null },
            status: { $in: ['processing', 'accepted'] }
        }).lean();

        res.json({ success: true, tasks, alerts });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};

/**
 * POST /executor/accept-task/:id — قبول مهمة
 */
const acceptTask = async (req, res) => {
    try {
        const { telegramId, accountType } = req.user;
        if (accountType !== 'executor') return res.status(403).json({ success: false });

        const emp = await Employee.findOne({ telegramId }).populate('botId');
        if (!emp) return res.status(404).json({ success: false, code: 'EMPLOYEE_NOT_FOUND', message: 'لم يتم العثور على حساب المنفذ' });

        const tx = await Transaction.findOneAndUpdate(
            { _id: req.params.id, status: 'processing' },
            { $set: { status: 'accepted', operatorId: emp.telegramId, executorName: emp.name, emergencyAlert: undefined } },
            { new: true }
        );

        if (!tx) return res.json({ success: false, code: 'ALREADY_TAKEN', message: 'عذراً، تم سحب الطلب من قِبل زميل آخر' });

        // تحديث رسائل البث
        if (tx.broadcastMessages && tx.broadcastMessages.length > 0) {
            const execBotAPI = new Telegram(emp.botId.token);
            let typeLabel = tx.transferType === 'post_account' ? '📮 حساب بريد' : (tx.transferType === 'post_card' ? '💳 بطاقة عميل' : '📱 فودافون كاش');
            const msgText = `🔒 <b>تم سحب المهمة (${typeLabel})</b>\n\n📞 الرقم/الحساب: <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 المبلغ: ${tx.amount} EGP\n🧾 الطلب: <code>${tx.customId}</code>\n\n👨‍💻 <b>تم الاستلام بواسطة:</b> ${emp.name}`;

            for (const msg of tx.broadcastMessages) {
                try {
                    if (tx.transferType === 'post_card' && tx.idCardImage) {
                        await execBotAPI.editMessageCaption(msg.telegramId, msg.messageId, undefined, msgText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
                    } else {
                        await execBotAPI.editMessageText(msg.telegramId, msg.messageId, undefined, msgText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } });
                    }
                } catch (e) {}
            }
        }

        // Audit Log
        await logAction({
            action: 'TASK_ACCEPTED',
            req,
            performedById: emp._id,
            performedByModel: 'Employee',
            performedByName: emp.name,
            targetId: tx._id,
            targetModel: 'Transaction',
            metadata: { customId: tx.customId, amount: tx.amount }
        });

        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
};

/**
 * POST /executor/cancel-task/:id — إلغاء مهمة
 */
const cancelTask = async (req, res) => {
    try {
        const { reason } = req.body;
        const { telegramId, accountType } = req.user;
        if (accountType !== 'executor') return res.status(403).json({ success: false, code: 'FORBIDDEN' });

        const result = await transferService.cancelTransfer({
            taskId: req.params.id,
            telegramId,
            reason,
            req
        });
        return res.status(result.statusCode).json(result);
    } catch (e) {
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'فشل الإلغاء' });
    }
};

/**
 * POST /executor/complete-task/:id — إتمام مهمة
 */
const completeTask = async (req, res) => {
    try {
        const { imageBase64, senderPhone } = req.body;
        const { telegramId, accountType } = req.user;
        if (accountType !== 'executor') return res.status(403).json({ success: false });
        if (!imageBase64) return res.json({ success: false, message: 'يرجى إرفاق صورة الإثبات' });

        const tx = await Transaction.findById(req.params.id);
        const emp = await Employee.findOne({ telegramId }).populate('botId');

        if (!tx || tx.status !== 'accepted' || tx.operatorId !== emp.telegramId) {
            return res.json({ success: false, message: 'الطلب غير متاح للإنهاء' });
        }

        // خصم العهدة
        if (emp.botId.parentBotId) {
            await ExecutorBot.findByIdAndUpdate(emp.botId.parentBotId, { $inc: { balance: -tx.amount } });
        }
        await ExecutorBot.findByIdAndUpdate(emp.botId._id, { $inc: { balance: -tx.amount } });

        // إرسال الإثبات
        const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);

        let typeLabel = tx.transferType === 'post_account' ? 'حساب بريد' : (tx.transferType === 'post_card' ? 'بطاقة عميل' : 'فودافون كاش');
        let senderPhoneDisplay = senderPhone ? `\n📞 <b>الرقم المرجعي:</b> <code>${senderPhone}</code>` : '';
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
                    } else {
                        await adminAPI.sendPhoto(admin.telegramId, savedFileId, { caption: adminMsgCaption, parse_mode: 'HTML' });
                    }
                } catch (e) {}
            }
        }

        tx.status = 'completed';
        tx.proofImage = savedFileId;
        if (senderPhone) tx.executorSenderPhone = senderPhone;
        await tx.save();

        // Audit Log
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
    } catch (e) {
        res.status(500).json({ success: false, message: 'خطأ في السيرفر' });
    }
};

module.exports = { getLiveTasks, acceptTask, cancelTask, completeTask };
