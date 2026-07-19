const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api/bot';

const editPrompt = async (ctx, text, markup = {}) => {
    try {
        if (ctx.wizard.state.promptMsgId) {
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.wizard.state.promptMsgId, null, text, { parse_mode: 'HTML', ...markup });
        } else {
            const sent = await ctx.reply(text, { parse_mode: 'HTML', ...markup });
            ctx.wizard.state.promptMsgId = sent.message_id;
        }
    } catch (e) {
        const sent = await ctx.reply(text, { parse_mode: 'HTML', ...markup });
        ctx.wizard.state.promptMsgId = sent.message_id;
    }
};

const proofWizard = new Scenes.WizardScene(
    'PROOF_SCENE',
    async (ctx) => {
        ctx.wizard.state.txId = ctx.scene.state.txId;
        ctx.wizard.state.promptMsgId = ctx.scene.state.promptMsgId;
        await editPrompt(ctx, `📸 <b>إرفاق إثبات التحويل</b>\n\nالرجاء إرسال صورة إيصال التحويل لإغلاق الطلب:`, Markup.inlineKeyboard([[Markup.button.callback('🔙 تراجع', 'proof_back')]]));
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'proof_back') {
            await ctx.answerCbQuery().catch(()=>{});
            try {
                const res = await axios.get(`${API_BASE}/executor/transactions/pending`, { headers: { 'x-bot-token': ctx.botToken } });
                const tx = res.data.txs?.find(t => t._id === ctx.wizard.state.txId);
                if (tx) {
                    const execMsg = `⚙️ <b>أنت الآن تقوم بتنفيذ هذا الطلب!</b>\n\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>رقم المحفظة:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 <b>المبلغ المطلوب:</b> ${tx.amount} EGP\n${tx.notes ? `📝 <b>الملاحظة:</b> ${tx.notes}\n` : ''}━━━━━━━━━━━━━━`;
                    await editPrompt(ctx, execMsg, Markup.inlineKeyboard([
                        [Markup.button.callback('✅ تم التحويل (إرفاق الإثبات)', `done_task_${tx._id}`)],
                        [Markup.button.callback('✏️ تعديل المبلغ المحول', `editAmount_${tx._id}`)],
                        [Markup.button.callback('❌ إلغاء الحوالة (يوجد مشكلة)', `cancelExec_${tx._id}`)]
                    ]));
                }
            } catch(e) {}
            return ctx.scene.leave();
        }

        if (ctx.message) {
            await ctx.deleteMessage().catch(()=>{});
            if (!ctx.message.photo) {
                await editPrompt(ctx, '⚠️ <b>يجب إرسال صورة إيصال الدفع.</b>\nالرجاء إرسال صورة صحيحة:', Markup.inlineKeyboard([[Markup.button.callback('🔙 تراجع', 'proof_back')]]));
                return;
            }

            await editPrompt(ctx, '⏳ <i>جاري رفع الإثبات وإشعار الإدارة والعميل...</i>');
            const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            
            try {
                const fileLink = await ctx.telegram.getFileLink(photoId);
                
                const response = await axios.post(`${API_BASE}/executor/transactions/proof`, {
                    txId: ctx.wizard.state.txId,
                    proofImage: fileLink.href,
                    telegramId: ctx.from.id.toString(),
                    employeeName: ctx.from.first_name
                }, { headers: { 'x-bot-token': ctx.botToken } });

                if (response.data.success) {
                    await editPrompt(ctx, `✅ <b>تم الإغلاق بنجاح!</b>\n\nتم إغلاق الطلب وإرسال الإشعار للعميل والإدارة.`, {});
                } else {
                    await editPrompt(ctx, '❌ ' + (response.data.message || 'خطأ أثناء الإغلاق'), {});
                }
            } catch (e) {
                console.error(e);
                await editPrompt(ctx, '❌ حدث خطأ فني في الاتصال بالخادم.', {});
            }
            return ctx.scene.leave();
        }
    }
);
module.exports = proofWizard;
