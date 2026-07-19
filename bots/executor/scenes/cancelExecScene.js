// executor/scenes/cancelExecScene.js
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

const cancelExecWizard = new Scenes.WizardScene(
    'CANCEL_EXEC_SCENE',
    async (ctx) => {
        ctx.wizard.state.txId = ctx.scene.state.txId;
        ctx.wizard.state.promptMsgId = ctx.scene.state.promptMsgId;
        await editPrompt(ctx, `❌ <b>إلغاء تنفيذ الطلب</b>\n\nالرجاء كتابة سبب إلغاء الحوالة (مثال: المحفظة لا تقبل، الرقم خطأ، إلخ):`, Markup.inlineKeyboard([[Markup.button.callback('🔙 تراجع', 'cancel_back')]]));
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_back') {
            await ctx.answerCbQuery().catch(()=>{});
            try {
                const response = await axios.get(`${API_BASE}/executor/transactions/pending`, { headers: { 'x-bot-token': ctx.botToken } });
                if (response.data.success) {
                    const tx = response.data.txs.find(t => t._id === ctx.wizard.state.txId);
                    if (tx) {
                        const execMsg = `⚙️ <b>أنت الآن تقوم بتنفيذ هذا الطلب!</b>\n\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>رقم المحفظة:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 <b>المبلغ المطلوب:</b> ${tx.amount} EGP\n${tx.notes ? `📝 <b>الملاحظة:</b> ${tx.notes}\n` : ''}━━━━━━━━━━━━━━`;
                        await editPrompt(ctx, execMsg, Markup.inlineKeyboard([
                            [Markup.button.callback('✅ تم التحويل (إرفاق الإثبات)', `done_task_${tx._id}`)],
                            [Markup.button.callback('✏️ تعديل المبلغ المحول', `editAmount_${tx._id}`)],
                            [Markup.button.callback('❌ إلغاء الحوالة (يوجد مشكلة)', `cancelExec_${tx._id}`)]
                        ]));
                    }
                }
            } catch (e) { console.error(e); }
            return ctx.scene.leave();
        }

        if (ctx.message) {
            await ctx.deleteMessage().catch(()=>{});
            const reason = ctx.message.text?.trim();
            if (!reason) {
                await editPrompt(ctx, '⚠️ <b>الرجاء كتابة السبب كنص:</b>', Markup.inlineKeyboard([[Markup.button.callback('🔙 تراجع', 'cancel_back')]]));
                return;
            }

            await editPrompt(ctx, '⏳ <i>جاري معالجة الإلغاء...</i>');

            try {
                const response = await axios.post(`${API_BASE}/executor/transactions/reject`, {
                    txId: ctx.wizard.state.txId,
                    telegramId: ctx.from.id.toString(),
                    reason: reason
                }, { headers: { 'x-bot-token': ctx.botToken } });

                if (response.data.success) {
                    const tx = response.data.tx;
                    await editPrompt(ctx, `✅ <b>تم الإلغاء!</b>\n\nتم إلغاء الطلب <code>${tx.customId || tx._id}</code> بسبب: ${reason}\nوتم إشعار العميل وإرجاع الرصيد بنجاح.`, {});
                } else {
                    await editPrompt(ctx, '❌ ' + (response.data.message || 'حدث خطأ أثناء الإلغاء.'), {});
                }
            } catch (e) {
                console.error(e);
                await editPrompt(ctx, '❌ حدث خطأ فني في الاتصال بالخادم.', {});
            }
            return ctx.scene.leave();
        }
    }
);
module.exports = cancelExecWizard;
