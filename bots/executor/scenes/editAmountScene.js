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

const editAmountWizard = new Scenes.WizardScene(
    'EDIT_AMOUNT_SCENE',
    async (ctx) => {
        ctx.wizard.state.txId = ctx.scene.state.txId;
        ctx.wizard.state.promptMsgId = ctx.scene.state.promptMsgId;
        
        try {
            const res = await axios.get(`${API_BASE}/executor/transactions/pending`, { headers: { 'x-bot-token': ctx.botToken } });
            const tx = res.data.txs?.find(t => t._id === ctx.wizard.state.txId);
            if (!tx) return ctx.scene.leave();
            ctx.wizard.state.tx = tx;
            await editPrompt(ctx, `✏️ <b>تعديل المبلغ (تحويل جزئي)</b>\n\nالمبلغ الأصلي: <b>${tx.amount} EGP</b>\n\nالرجاء إرسال المبلغ الجديد (الذي تم تحويله فعلياً):`, Markup.inlineKeyboard([[Markup.button.callback('🔙 تراجع', 'edit_back')]]));
        } catch(e) { return ctx.scene.leave(); }
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'edit_back') {
            const tx = ctx.wizard.state.tx;
            const execMsg = `⚙️ <b>أنت الآن تقوم بتنفيذ هذا الطلب!</b>\n\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>رقم المحفظة:</b> <code>${tx.vodafoneNumber}</code>\n💵 <b>المبلغ المطلوب:</b> ${tx.amount} EGP\n${tx.notes ? `📝 <b>الملاحظة:</b> ${tx.notes}\n` : ''}━━━━━━━━━━━━━━`;
            await editPrompt(ctx, execMsg, Markup.inlineKeyboard([
                [Markup.button.callback('✅ تم التحويل (إرفاق الإثبات)', `done_task_${tx._id}`)],
                [Markup.button.callback('✏️ تعديل المبلغ المحول', `editAmount_${tx._id}`)],
                [Markup.button.callback('❌ إلغاء الحوالة (يوجد مشكلة)', `cancelExec_${tx._id}`)]
            ]));
            return ctx.scene.leave();
        }

        if (ctx.message) {
            await ctx.deleteMessage().catch(()=>{});
            const newAmount = parseFloat(ctx.message.text?.trim());
            if (isNaN(newAmount) || newAmount <= 0) {
                await editPrompt(ctx, '⚠️ <b>مبلغ غير صالح!</b>\nالرجاء كتابة رقم صحيح:', Markup.inlineKeyboard([[Markup.button.callback('🔙 تراجع', 'edit_back')]]));
                return;
            }

            ctx.wizard.state.newAmount = newAmount;
            await editPrompt(ctx, `✅ تم حفظ المبلغ الجديد: <b>${newAmount} EGP</b>\n\n📸 الرجاء إرسال صورة الإثبات الآن:`, Markup.inlineKeyboard([[Markup.button.callback('🔙 تراجع', 'edit_back')]]));
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'edit_back') {
            const tx = ctx.wizard.state.tx;
            await editPrompt(ctx, `✏️ <b>تعديل المبلغ (تحويل جزئي)</b>\n\nالمبلغ الأصلي: <b>${tx.amount} EGP</b>\n\nالرجاء إرسال المبلغ الجديد (الذي تم تحويله فعلياً):`, Markup.inlineKeyboard([[Markup.button.callback('🔙 تراجع', 'cancel_scene')]]));
            ctx.wizard.selectStep(1);
            return;
        }
        if (ctx.message) {
            await ctx.deleteMessage().catch(()=>{});
            if (!ctx.message.photo) {
                await editPrompt(ctx, '⚠️ <b>يجب إرسال صورة.</b>\nالرجاء إرسال صورة الإثبات:', Markup.inlineKeyboard([[Markup.button.callback('🔙 تراجع', 'edit_back')]]));
                return;
            }

            await editPrompt(ctx, '⏳ <i>جاري معالجة الإثبات وإغلاق الطلب وإشعار الإدارة...</i>');
            const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            
            try {
                const fileLink = await ctx.telegram.getFileLink(photoId);
                const response = await axios.post(`${API_BASE}/executor/transactions/edit`, {
                    txId: ctx.wizard.state.txId,
                    newAmount: ctx.wizard.state.newAmount,
                    proofImage: fileLink.href,
                    telegramId: ctx.from.id.toString()
                }, { headers: { 'x-bot-token': ctx.botToken } });

                if (response.data.success) {
                    await editPrompt(ctx, `✅ <b>اكتملت العملية بنجاح!</b>\n\nتم تنفيذ الطلب بمبلغ ${ctx.wizard.state.newAmount} واسترجاع الفارق للعميل، وتم الإرسال للإدارة.`, {});
                } else {
                    await editPrompt(ctx, '❌ ' + (response.data.message || 'خطأ أثناء الإغلاق'), {});
                }
            } catch (e) {
                await editPrompt(ctx, '❌ حدث خطأ فني في الاتصال بالخادم.', {});
            }
            return ctx.scene.leave();
        }
    }
);
module.exports = editAmountWizard;
