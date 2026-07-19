// bots/executor/scenes/financialClosingScene.js
const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api/bot';

const financialClosingWizard = new Scenes.WizardScene(
    'FINANCIAL_CLOSING_SCENE',
    async (ctx) => {
        ctx.wizard.state.dateStr = new Date().toLocaleDateString('en-GB');
        await ctx.reply(`🏦 <b>الإغلاق المالي ليوم ${ctx.wizard.state.dateStr}</b>\n\nإذا كان لديك ملاحظات (مثل عجز أو زيادة)، اكتبها الآن، أو اضغط "تخطي":`, Markup.inlineKeyboard([[Markup.button.callback('⏭ تخطي الملاحظة', 'skip_note'), Markup.button.callback('🔙 إلغاء', 'cancel_close')]]));
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_close') {
            await ctx.editMessageText('❌ تم الإلغاء.');
            return ctx.scene.leave();
        }
        
        ctx.wizard.state.note = '';
        if (ctx.callbackQuery?.data === 'skip_note') {
            await ctx.answerCbQuery().catch(()=>{});
        } else if (ctx.message?.text) {
            ctx.wizard.state.note = ctx.message.text;
        } else {
            return ctx.reply('⚠️ الرجاء كتابة نص أو الضغط على تخطي:');
        }

        await ctx.reply('📸 <b>الرجاء إرفاق صورة الإغلاق أو إيصال التوريد إن وجد، أو اضغط "إرسال بدون صورة":</b>', Markup.inlineKeyboard([[Markup.button.callback('📤 إرسال بدون صورة', 'send_no_photo'), Markup.button.callback('🔙 إلغاء', 'cancel_close')]]));
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_close') {
            await ctx.editMessageText('❌ تم الإلغاء.');
            return ctx.scene.leave();
        }

        let imageBase64 = null;
        if (ctx.callbackQuery?.data === 'send_no_photo') {
            await ctx.answerCbQuery().catch(()=>{});
        } else if (ctx.message?.photo) {
            const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            try {
                const fileLink = await ctx.telegram.getFileLink(photoId);
                const response = await fetch(fileLink.href);
                const buffer = Buffer.from(await response.arrayBuffer());
                imageBase64 = buffer.toString('base64');
            } catch (e) {
                return ctx.reply('❌ خطأ في قراءة الصورة.');
            }
        } else {
            return ctx.reply('⚠️ الرجاء إرسال صورة أو الضغط على الزر:');
        }

        await ctx.reply('⏳ جاري إرسال الإغلاق للإدارة...');
        try {
            const response = await axios.post(`${API_BASE}/executor/closing/submit`, {
                telegramId: ctx.from.id.toString(),
                dateStr: ctx.wizard.state.dateStr,
                note: ctx.wizard.state.note,
                imageBuffer: imageBase64
            }, { headers: { 'x-bot-token': ctx.botToken } });

            if (response.data.success) {
                await ctx.reply('✅ تم إرسال طلب الإغلاق للإدارة بنجاح.');
            } else {
                await ctx.reply('❌ فشل في الإرسال.');
            }
        } catch (e) { await ctx.reply('❌ حدث خطأ فني.'); }
        return ctx.scene.leave();
    }
);
module.exports = financialClosingWizard;
