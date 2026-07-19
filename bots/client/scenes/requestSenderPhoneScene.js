// bots/client/scenes/requestSenderPhoneScene.js
const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = `http://127.0.0.1:${process.env.PORT || 3000}/api/bot`;

const requestSenderPhoneWizard = new Scenes.WizardScene(
    'REQUEST_SENDER_PHONE_SCENE',
    async (ctx) => {
        const telegramId = ctx.from.id.toString();
        const botData = ctx.wizard.state.botData;

        try {
            const res = await axios.get(`${API_BASE}/client/transactions/completed?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
            const txs = res.data.txs;

            if (!txs || txs.length === 0) {
                await ctx.reply('❌ لا توجد عمليات مكتملة لطلب رقم المنفذ لها.');
                return ctx.scene.leave();
            }

            let msg = '📞 <b>طلب رقم منفذ الحوالة</b>\n\nاختر العملية التي تريد معرفة الرقم الذي تم التحويل منه:';
            const buttons = txs.map(t => [Markup.button.callback(`💵 ${t.amount} EGP | 📞 ${t.vodafoneNumber}`, `reqPhoneTx_${t._id}`)]);
            buttons.push([Markup.button.callback('🔙 رجوع', 'cancel_req')]);
            await ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
            return ctx.wizard.next();
        } catch (e) {
            ctx.reply('❌ حدث خطأ داخلي، يرجى المحاولة لاحقاً.');
            return ctx.scene.leave();
        }
    },
    async (ctx) => {
        const action = ctx.callbackQuery?.data;
        if (action === 'cancel_req') { await ctx.editMessageText('✅ تم الإلغاء.'); return ctx.scene.leave(); }
        
        if (action && action.startsWith('reqPhoneTx_')) {
            const txId = action.split('_')[1];
            const botData = ctx.wizard.state.botData;

            await ctx.editMessageText('⏳ جاري إرسال الطلب للإدارة والموظف المنفذ...');

            try {
                await axios.post(`${API_BASE}/client/transactions/request-phone`, { txId }, { headers: { 'x-bot-token': botData.token } });
                await ctx.reply('✅ تم إرسال طلبك. سيصلك إشعار بالرقم فور إرفاقه من الموظف المنفذ.');
            } catch (e) {
                await ctx.reply('❌ تعذر إرسال الطلب. يرجى المحاولة لاحقاً.');
            }
            return ctx.scene.leave();
        }
    }
);
module.exports = requestSenderPhoneWizard;