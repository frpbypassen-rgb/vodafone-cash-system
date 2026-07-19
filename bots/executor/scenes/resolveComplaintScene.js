// bots/executor/scenes/resolveComplaintScene.js
const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api/bot';

const resolveComplaintWizard = new Scenes.WizardScene(
    'RESOLVE_COMPLAINT_SCENE',
    async (ctx) => {
        ctx.wizard.state.txId = ctx.scene.state.txId;
        const typeNames = { 'Solved': '✅ تم حل الشكوى', 'Tech': '🛠 مشكلة فنية', 'Return': '🔙 إرجاع للإدارة' };
        ctx.wizard.state.typeName = typeNames[ctx.scene.state.type];

        await ctx.reply(`📝 <b>توضيح حل الشكوى: [ ${ctx.wizard.state.typeName} ]</b>\n\nمن فضلك اكتب "ملاحظة" تشرح فيها للإدارة كيف تم التعامل مع المشكلة:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء', 'cancel_resolve')]]) });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_resolve') {
            await ctx.editMessageText('❌ تم الإلغاء.');
            return ctx.scene.leave();
        }
        if (!ctx.message?.text || ctx.message.text.length < 3) return ctx.reply('⚠️ يرجى كتابة توضيح بسيط:');
        ctx.wizard.state.resolutionNote = ctx.message.text;

        await ctx.reply(`📸 <b>الآن ارفق صورة إثبات للحل (اختياري):</b>\n\nأرسل صورة الآن، أو اضغط أدناه:`, { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback('📤 إرسال بدون صورة', 'send_note_only'), Markup.button.callback('🔙 إلغاء', 'cancel_resolve')]]) });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_resolve') {
            await ctx.editMessageText('❌ تم الإلغاء.');
            return ctx.scene.leave();
        }

        let imageBase64 = null;
        if (ctx.callbackQuery?.data === 'send_note_only') {
            await ctx.answerCbQuery().catch(()=>{});
        } else if (ctx.message?.photo) {
            const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            try {
                const fileLink = await ctx.telegram.getFileLink(photoId);
                const response = await fetch(fileLink.href);
                const buffer = Buffer.from(await response.arrayBuffer());
                imageBase64 = buffer.toString('base64');
            } catch (e) {}
        } else {
            return ctx.reply('⚠️ يرجى إرسال صورة أو الضغط على "بدون صورة":');
        }

        await ctx.reply('⏳ جاري إرسال التقرير للإدارة...');
        try {
            const response = await axios.post(`${API_BASE}/executor/complaint/resolve`, {
                txId: ctx.wizard.state.txId,
                telegramId: ctx.from.id.toString(),
                resolutionNote: ctx.wizard.state.resolutionNote,
                typeName: ctx.wizard.state.typeName,
                imageBuffer: imageBase64
            }, { headers: { 'x-bot-token': ctx.botToken } });

            if (response.data.success) {
                await ctx.reply('✅ تم إرسال تقرير الحل للإدارة بنجاح.');
            } else {
                await ctx.reply('❌ فشل الإرسال.');
            }
        } catch(e) { await ctx.reply('❌ خطأ فني.'); }
        return ctx.scene.leave();
    }
);
module.exports = resolveComplaintWizard;
