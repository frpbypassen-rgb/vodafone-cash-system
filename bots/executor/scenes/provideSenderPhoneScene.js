// bots/executor/scenes/provideSenderPhoneScene.js
const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api/bot';

const provideSenderPhoneWizard = new Scenes.WizardScene(
    'PROVIDE_PHONE_SCENE',
    async (ctx) => {
        ctx.wizard.state.txId = ctx.scene.state.txId;
        await ctx.reply('📞 الرجاء إرسال رقم الهاتف الذي تم التحويل منه:', Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء', 'cancel_phone')]]));
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_phone') {
            await ctx.editMessageText('❌ تم الإلغاء.');
            return ctx.scene.leave();
        }

        const phone = ctx.message?.text?.trim();
        if (!phone) return ctx.reply('⚠️ الرجاء كتابة الرقم:');

        await ctx.reply('⏳ جاري الحفظ...');
        try {
            const response = await axios.post(`${API_BASE}/executor/transactions/phone`, {
                txId: ctx.wizard.state.txId,
                phone: phone
            }, { headers: { 'x-bot-token': ctx.botToken } });

            if (response.data.success) {
                await ctx.reply('✅ تم حفظ الرقم بنجاح وإشعار العميل وإدارة المنظومة.');
            } else {
                await ctx.reply('❌ فشل الحفظ.');
            }
        } catch(e) { await ctx.reply('❌ حدث خطأ فني.'); }
        return ctx.scene.leave();
    }
);
module.exports = provideSenderPhoneWizard;
