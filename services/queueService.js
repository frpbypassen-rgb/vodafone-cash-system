// services/queueService.js
const fs = require('fs');
const path = require('path');
const Transaction = require('../models/Transaction');
const ExecutorBot = require('../models/ExecutorBot');
const ClientBot = require('../models/ClientBot');
const ClientEmployee = require('../models/ClientEmployee');
const Admin = require('../models/Admin');
const Employee = require('../models/Employee');
const { Telegram } = require('telegraf');
const { executeTransferViaApi, generateCustomReceipt, getApiReferenceNumber } = require('./externalApiService');
const { updateBalanceWithLedger } = require('./walletService');

const updateExecutorLog = async (tx, newText, execAPI) => {
    if (tx.broadcastMessages && tx.broadcastMessages.length > 0) {
        for (const msg of tx.broadcastMessages) {
            try { await execAPI.editMessageText(msg.telegramId, msg.messageId, null, newText, { parse_mode: 'HTML' }); } catch (e) {}
        }
    }
};

class ApiTransferQueue {
    constructor() { this.queue = []; this.isProcessing = false; }

    async addJob(txId, apiBotId) {
        this.queue.push({ txId, apiBotId });
        try {
            const tx = await Transaction.findById(txId);
            const executorBot = await ExecutorBot.findById(apiBotId);
            if (tx && executorBot && (!tx.broadcastMessages || tx.broadcastMessages.length === 0)) {
                const botToUseId = executorBot.parentBotId || executorBot._id;
                const botToUse = await ExecutorBot.findById(botToUseId);
                if (botToUse && botToUse.token) {
                    const execAPI = new Telegram(botToUse.token);
                    const staff = await Employee.find({ botId: botToUse._id, status: 'active' });
                    const initialMsg = `🟡 <b>سجل API (في طابور المعالجة)</b>\n\n🤖 البوت: ${executorBot.name}\n🧾 الطلب: <code>${tx.customId}</code>\n📞 الرقم: <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 المبلغ: ${tx.amount} EGP\n⏳ جاري الانتظار في طابور التنفيذ...`;
                    for (const s of staff) {
                        if (s.telegramId) {
                            try { const sentMsg = await execAPI.sendMessage(s.telegramId, initialMsg, { parse_mode: 'HTML' }); tx.broadcastMessages.push({ telegramId: s.telegramId, messageId: sentMsg.message_id }); } catch(e){}
                        }
                    }
                    await tx.save();
                }
            }
        } catch (e) {}
        this.processQueue();
    }

    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) return;
        this.isProcessing = true;
        const job = this.queue.shift();

        try {
            const tx = await Transaction.findById(job.txId);
            const executorBot = await ExecutorBot.findById(job.apiBotId);

            if (tx && executorBot && tx.status === 'processing') {
                const botToUseId = executorBot.parentBotId || executorBot._id;
                const botToUse = await ExecutorBot.findById(botToUseId);
                const execAPI = botToUse && botToUse.token ? new Telegram(botToUse.token) : null;

                if (execAPI) await updateExecutorLog(tx, `🔄 <b>سجل API (جاري الاتصال بالشبكة)</b>\n\n🤖 البوت: ${executorBot.name}\n🧾 الطلب: <code>${tx.customId}</code>\n📞 الرقم: <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 المبلغ: ${tx.amount} EGP\n🌐 يتم الآن إرسال الطلب والتفاوض مع شبكة المحمول...`, execAPI);

                const apiResult = await executeTransferViaApi(tx, executorBot);
                let prevNotes = tx.notes ? tx.notes + '\n\n' : '';
                let detailedLog = `\n--- سجل الـ API ---\n${apiResult.processLog}`;

                const adminAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);
                const admins = await Admin.find({});

                if (apiResult.success === true) {
                    const exactRefNumber = getApiReferenceNumber(apiResult);

                    if (exactRefNumber) {
                        tx.status = 'completed'; tx.executorName = 'تنفيذ آلي (API)';
                        tx.notes = prevNotes + `[نجاح آلي | المرجع: ${exactRefNumber}]` + detailedLog;

                        await updateBalanceWithLedger('ExecutorBot', executorBot._id, -tx.amount, 'TRANSFER', tx.customId, 'تنفيذ API آلي');

                        // 🟢 1. توليد الصورة من الـ API وحفظها في الهارد ديسك فقط
                        const receiptBuffer = await generateCustomReceipt(tx, apiResult);
                        let localImagePath = null;
                        let fullLocalPath = null;

                        if (receiptBuffer) {
                            try {
                                const uploadDir = path.join(process.cwd(), 'uploads', 'proofs');
                                if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
                                const fileName = `api_proof_${tx._id}_${Date.now()}.jpg`;
                                fullLocalPath = path.join(uploadDir, fileName);
                                
                                // حفظ الملف بالسيرفر
                                fs.writeFileSync(fullLocalPath, receiptBuffer);
                                localImagePath = `/uploads/proofs/${fileName}`;
                                
                                // 🟢 2. تثبيت المسار في الداتابيز بشكل قاطع
                                tx.proofImage = localImagePath;
                                tx.proofImages = [localImagePath];
                                tx.set('localProofImage', localImagePath, { strict: false });
                            } catch (fileErr) {
                                console.error('[API File Save Error]:', fileErr.message);
                            }
                        }

                        // 🟢 حفظ العملية والصورة فوراً لمنع أي استبدال لاحق
                        await tx.save(); 

                        if (execAPI) {
                            const successText = `✅ <b>سجل API (اكتمل التنفيذ بنجاح)</b>\n\n🤖 البوت: ${executorBot.name}\n🧾 الطلب: <code>${tx.customId}</code>\n📞 الرقم: <code>${tx.vodafoneNumber || tx.accountNumber}</code>\n💵 المبلغ: ${tx.amount} EGP\n🔢 المرجع: <code>${exactRefNumber}</code>\n✨ تم التنفيذ آلياً وخصم الرصيد بضمان.`;
                            await updateExecutorLog(tx, successText, execAPI);

                            if (tx.broadcastMessages && tx.broadcastMessages.length > 0) {
                                for (const msg of tx.broadcastMessages) {
                                    try {
                                        if (fullLocalPath && fs.existsSync(fullLocalPath)) {
                                            // استخدام Stream الآمن للملفات
                                            await execAPI.sendPhoto(msg.telegramId, { source: fs.createReadStream(fullLocalPath) }, { reply_to_message_id: msg.messageId });
                                        }
                                    } catch (e) {}
                                }
                            }
                        }

                        // 🟢 3. إرسال الصورة لبوت الإدارة المركزية باستخدام Stream
                        const adminCaption = `🤖⚡ <b>تم التنفيذ الآلي بنجاح!</b>\nالطلب <code>${tx.customId}</code> بقيمة ${tx.amount} EGP عبر ${executorBot.name}.`;
                        for (const admin of admins) {
                            if (admin.telegramId) {
                                try {
                                    if (fullLocalPath && fs.existsSync(fullLocalPath)) {
                                        await adminAPI.sendPhoto(admin.telegramId, { source: fs.createReadStream(fullLocalPath) }, { caption: adminCaption, parse_mode: 'HTML' });
                                    } else {
                                        await adminAPI.sendMessage(admin.telegramId, adminCaption + "\n\n⚠️ (لم يتم توليد صورة الإيصال)", { parse_mode: 'HTML' });
                                    }
                                } catch (e) {}
                            }
                        }

                        // 🟢 4. إرسال الصورة للعميل
                        const clientMsg = `✅ <b>تـم تـنـفـيـذ طـلـبـك بـنـجـاح! (تحويل آلي)</b> ⚡\n\n🧾 <b>رقم الطلب:</b> <code>${tx.customId}</code>\n📞 <b>الرقم/الحساب:</b> <code>${tx.vodafoneNumber || tx.accountNumber}</code>\n💵 <b>المبلغ:</b> ${tx.amount} EGP\n💸 <b>التكلفة:</b> ${tx.costLYD.toFixed(2)} LYD`;
                        let clientAPI = new Telegram(tx.clientBotId ? (await ClientBot.findById(tx.clientBotId)).token : process.env.CLIENT_BOT_TOKEN);
                        let isCompany = !!tx.clientBotId;

                        if (isCompany) {
                            const emps = await ClientEmployee.find({ clientBotId: tx.clientBotId, status: 'active' });
                            for (const e of emps) { 
                                try { 
                                    if (fullLocalPath && fs.existsSync(fullLocalPath)) {
                                        await clientAPI.sendPhoto(e.telegramId, { source: fs.createReadStream(fullLocalPath) }, { caption: clientMsg, parse_mode: 'HTML' }); 
                                    } else {
                                        await clientAPI.sendMessage(e.telegramId, clientMsg, { parse_mode: 'HTML' }); 
                                    }
                                } catch(err) { } 
                            }
                        } else {
                            try { 
                                if (fullLocalPath && fs.existsSync(fullLocalPath)) {
                                    await clientAPI.sendPhoto(tx.userId, { source: fs.createReadStream(fullLocalPath) }, { caption: clientMsg, parse_mode: 'HTML' }); 
                                } else {
                                    await clientAPI.sendMessage(tx.userId, clientMsg, { parse_mode: 'HTML' }); 
                                }
                            } catch(err) { }
                        }
                    } else {
                        tx.status = 'pending'; tx.executorBotId = executorBot._id; tx.executorName = 'في انتظار تحديث (API)';
                        tx.notes = prevNotes + `[في الانتظار - بانتظار رقم مرجعي مشفر من الـ API | المرجع الحالي: ${exactRefNumber}]` + detailedLog;
                        tx.set('isApiReview', undefined, { strict: false }); tx.set('apiResultData', undefined, { strict: false }); tx.set('originalApiBotId', undefined, { strict: false });
                        await tx.save();

                        if (execAPI) await updateExecutorLog(tx, `🟠 <b>سجل API (معلق بانتظار تحديث)</b>\n\n🤖 البوت: ${executorBot.name}\n🧾 الطلب: <code>${tx.customId}</code>\n📞 الرقم: <code>${tx.vodafoneNumber || tx.accountNumber}</code>\n💵 المبلغ: ${tx.amount} EGP\n🔢 المرجع (مكشوف): <code>${exactRefNumber}</code>\n⚠️ العملية قيد الانتظار التلقائي لحين وصول الرد النهائي المشفر لإكمالها.`, execAPI);
                        for (const admin of admins) { if (admin.telegramId) adminAPI.sendMessage(admin.telegramId, `⏳ <b>عملية قيد الانتظار التلقائي (API)</b>\nالطلب <code>${tx.customId}</code> برقم مرجعي مكشوف، وينتظر وصول الرد النهائي لإكماله.`, { parse_mode: 'HTML' }).catch(()=>{}); }
                    }
                } else if (apiResult.success === 'pending') {
                    tx.status = 'pending'; tx.notes = prevNotes + `[العملية معلقة بانتظار شبكة المحمول | المرجع: ${apiResult.external_transaction_id}]` + detailedLog;
                    tx.executorBotId = executorBot._id; tx.executorBotName = executorBot.name; await tx.save();
                    if (execAPI) await updateExecutorLog(tx, `⏳ <b>سجل API (معلق من الشبكة)</b>\n\n🤖 البوت: ${executorBot.name}\n🧾 الطلب: <code>${tx.customId}</code>\n📞 الرقم: <code>${tx.vodafoneNumber || tx.accountNumber}</code>\n💵 المبلغ: ${tx.amount} EGP\n⚠️ قيد الانتظار لرد نهائي وتحديث من شبكة المحمول.`, execAPI);
                    for (const admin of admins) { if(admin.telegramId) await adminAPI.sendMessage(admin.telegramId, `⏳ <b>عملية قيد الانتظار (شبكة المحمول)</b>\nالطلب <code>${tx.customId}</code> معلق عبر ${executorBot.name}.`, { parse_mode: 'HTML' }).catch(()=>{}); }
                } else {
                    tx.status = 'pending'; tx.notes = prevNotes + `[فشل التنفيذ الآلي: ${apiResult.message}]` + detailedLog;
                    tx.executorBotId = undefined; tx.executorBotName = undefined; await tx.save();
                    if (execAPI) await updateExecutorLog(tx, `❌ <b>سجل API (فشل التنفيذ الآلي)</b>\n\n🤖 البوت: ${executorBot.name}\n🧾 الطلب: <code>${tx.customId}</code>\n📞 الرقم: <code>${tx.vodafoneNumber || tx.accountNumber}</code>\n💵 المبلغ: ${tx.amount} EGP\n⚠️ السبب: ${apiResult.message}\n🔙 تم إعادة الطلب للقائمة العامة (مرفوض).`, execAPI);
                }
            }
        } catch (error) {
            try {
                const tx = await Transaction.findById(job.txId);
                if (tx) {
                    tx.status = 'pending'; tx.executorBotId = undefined; tx.executorBotName = undefined;
                    tx.notes = (tx.notes ? tx.notes + '\n\n' : '') + `[خطأ داخلي في السيرفر أثناء المعالجة: ${error.message}]`;
                    await tx.save();
                    const botToUseId = tx.originalApiBotId || tx.executorBotId;
                    if(botToUseId) { const botToUse = await ExecutorBot.findById(botToUseId); if(botToUse && botToUse.token) { const execAPI = new Telegram(botToUse.token); await updateExecutorLog(tx, `❌ <b>سجل API (انهيار النظام)</b>\n\n🧾 الطلب: <code>${tx.customId}</code>\n⚠️ عطل برمجي داخلي: ${error.message}\n🔙 تم الإرجاع للقائمة للحماية.`, execAPI); } }
                }
            } catch(e){}
        }

        this.isProcessing = false;
        setTimeout(() => this.processQueue(), 2000); 
    }
}
module.exports = new ApiTransferQueue();
