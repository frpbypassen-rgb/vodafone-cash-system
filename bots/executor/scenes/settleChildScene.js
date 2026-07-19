// bots/executor/scenes/settleChildScene.js
const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api/bot';

const settleChildWizard = new Scenes.WizardScene(
    'SETTLE_CHILD_SCENE',
    async (ctx) => {
        await ctx.reply('⏳ جاري جلب الفروع...', Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء', 'cancel_settle')]]));
        try {
            const response = await axios.get(`${API_BASE}/executor/child-bots`, { headers: { 'x-bot-token': ctx.botToken } });
            if (response.data.success && response.data.bots.length > 0) {
                const kbs = response.data.bots.map(b => [Markup.button.callback(`${b.name} (${b.balance} د.ل)`, `settleBot_${b._id}`)]);
                kbs.push([Markup.button.callback('🔙 إلغاء', 'cancel_settle')]);
                await ctx.editMessageText('🏢 <b>اختر الفرع لتسوية رصيده:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(kbs) });
            } else {
                await ctx.editMessageText('❌ لا توجد فروع تابعة لتسويتها.');
                return ctx.scene.leave();
            }
        } catch(e) {
            await ctx.editMessageText('❌ حدث خطأ فني.');
            return ctx.scene.leave();
        }
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_settle') {
            await ctx.editMessageText('❌ تم الإلغاء.');
            return ctx.scene.leave();
        }
        
        if (ctx.callbackQuery?.data.startsWith('settleBot_')) {
            const childId = ctx.callbackQuery.data.split('_')[1];
            await ctx.editMessageText('⏳ جاري التصفية...');
            try {
                const response = await axios.post(`${API_BASE}/executor/child-bots/settle`, { childId }, { headers: { 'x-bot-token': ctx.botToken } });
                if (response.data.success) {
                    await ctx.editMessageText(`✅ تم التصفية بنجاح. المبلغ المستلم: ${response.data.amount} د.ل`);
                } else {
                    await ctx.editMessageText('❌ فشلت التصفية.');
                }
            } catch(e) { await ctx.editMessageText('❌ خطأ فني.'); }
            return ctx.scene.leave();
        }
    }
);
module.exports = settleChildWizard;
