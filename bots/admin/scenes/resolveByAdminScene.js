// bots/admin/scenes/resolveByAdminScene.js
const { Scenes, Markup, Telegram } = require('telegraf');
const Transaction = require('../../../models/Transaction');
const ClientBot = require('../../../models/ClientBot');
const ExecutorBot = require('../../../models/ExecutorBot'); // 🚀 استدعاء بوت التنفيذ لاستخراج الصورة

const resolveByAdminWizard = new Scenes.WizardScene(
    'RESOLVE_BY_ADMIN_SCENE',
    async (ctx) => {
        ctx.wizard.state.txId = ctx.scene.state.txId;
        await ctx.reply('📝 <b>اعتماد حل الشكوى:</b>\n\nمن فضلك اكتب "طريقة الحل" أو التوضيح النهائي الذي سيصل للعميل:', {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء الإجراء', 'cancel_res')]])
        });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_res') {
            await ctx.answerCbQuery().catch(() => {});
            await ctx.editMessageText('❌ تم إلغاء الإجراء.');
            return ctx.scene.leave();
        }

        const method = ctx.message?.text;
        if (!method || method.length < 3) return ctx.reply('⚠️ يرجى كتابة توضيح بسيط للعميل:');

        const tx = await Transaction.findById(ctx.wizard.state.txId);
        if (!tx) return ctx.reply('❌ خطأ: لم يتم العثور على بيانات العملية.');

        await ctx.reply('⏳ جاري إرسال الإشعار وتوثيق الحل للعميل...');

        const notifyMsg = `✅ <b>تحديث: تم حل مشكلتك وتوثيق الإجراء</b>\n\n` +
                          `🧾 رقم الطلب: <code>${tx.customId || tx._id}</code>\n` +
                          `📞 الرقم: <code>${tx.vodafoneNumber}</code>\n` +
                          `💵 المبلغ: ${tx.amount} EGP\n` +
                          `━━━━━━━━━━━━━━\n` +
                          `🛠 <b>طريقة الحل المعتمدة:</b>\n<i>"${method}"</i>\n\nشكراً لثقتك بمنظومة الأهرام 🚀`;

        try {
            let clientBotAPI;
            if (tx.clientBotId) {
                const comp = await ClientBot.findById(tx.clientBotId);
                clientBotAPI = new Telegram(comp.token);
            } else {
                clientBotAPI = new Telegram(process.env.CLIENT_BOT_TOKEN);
            }

            // 🚀 تحويل الصورة إلى Buffer من سيرفرات تليجرام باستخدام توكن الموظف
            let photoBuffer = null;
            if (tx.resolutionImage && tx.executorBotId) {
                try {
                    const execBot = await ExecutorBot.findById(tx.executorBotId);
                    if (execBot) {
                        const execAPI = new Telegram(execBot.token);
                        const fileLink = await execAPI.getFileLink(tx.resolutionImage);
                        const res = await fetch(fileLink.href);
                        photoBuffer = Buffer.from(await res.arrayBuffer());
                    }
                } catch (bufferErr) { console.error('Fetch buffer err:', bufferErr); }
            }

            if (photoBuffer) {
                // نرسل الـ Buffer عبر بوت العميل
                await clientBotAPI.sendPhoto(tx.userId, { source: photoBuffer }, { caption: notifyMsg, parse_mode: 'HTML' });
            } else {
                await clientBotAPI.sendMessage(tx.userId, notifyMsg, { parse_mode: 'HTML' });
            }

            tx.status = 'completed'; 
            await tx.save();

            await ctx.reply(`🚀 تم إرسال الإشعار (بالصورة) للعميل بنجاح وإغلاق التذكرة نهائياً.`);
        } catch (err) {
            console.error(err);
            await ctx.reply('⚠️ تم اعتماد الحل، لكن تعذر إرسال الإشعار للعميل.');
        }

        return ctx.scene.leave();
    }
);
module.exports = resolveByAdminWizard;