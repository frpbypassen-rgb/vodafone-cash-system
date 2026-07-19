// bots/executor/scenes/supportScene.js
const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api/bot';

const supportWizard = new Scenes.WizardScene(
    'SUPPORT_SCENE',
    async (ctx) => {
        await ctx.reply('🎧 <b>الدعم الفني</b>\n\nاكتب رسالتك وسنرد عليك في أقرب وقت:', { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء', 'cancel_support')]]) });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_support') {
            await ctx.editMessageText('❌ تم الإلغاء.');
            return ctx.scene.leave();
        }
        if (!ctx.message?.text) return ctx.reply('⚠️ الرجاء كتابة رسالة نصية:');

        await ctx.reply('⏳ جاري إرسال الرسالة...');
        try {
            const response = await axios.post(`${API_BASE}/executor/support/ticket`, {
                telegramId: ctx.from.id.toString(),
                message: ctx.message.text,
                type: 'executor'
            }, { headers: { 'x-bot-token': ctx.botToken } });
            
            if (response.data.success) {
                await ctx.reply('✅ تم إرسال رسالتك لفريق الدعم الفني.');
            } else {
                await ctx.reply('❌ فشل الإرسال.');
            }
        } catch(e) { await ctx.reply('❌ خطأ فني.'); }
        return ctx.scene.leave();
    }
);
module.exports = supportWizard;
