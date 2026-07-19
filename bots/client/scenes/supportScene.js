// bots/client/scenes/supportScene.js
const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = `http://127.0.0.1:${process.env.PORT || 3000}/api/bot`;

const supportWizard = new Scenes.WizardScene(
    'SUPPORT_SCENE',
    async (ctx) => {
        await ctx.reply(
            '🎧 <b>الدعم الفني والمساعدة</b>\n\n' +
            'الرجاء كتابة رسالتك أو استفسارك في رسالة واحدة، وسيقوم فريق الدعم بالرد عليك في أقرب وقت ممكن.\n\n' +
            '<i>(يمكنك إرسال نص، أو صورة مع توضيح)</i>\n' +
            'لإلغاء العملية أرسل الغاء ❌',
            { parse_mode: 'HTML', ...Markup.keyboard([['الغاء ❌']]).resize() }
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && (ctx.message.text === '/cancel' || ctx.message.text === 'الغاء ❌')) {
            await ctx.reply('✅ تم إلغاء الإرسال.', Markup.keyboard([
                ['💸 تحويل فودافون كاش (مصر)', '📮 تحويل بريد'],
                ['👤 حسابي', '🎧 الدعم الفني وتواصل معنا']
            ]).resize());
            return ctx.scene.leave();
        }

        if (!ctx.message || (!ctx.message.text && !ctx.message.photo)) {
            await ctx.reply('⚠️ الرجاء إرسال رسالة نصية أو صورة توضح مشكلتك.');
            return;
        }

        try {
            const botData = ctx.scene.state.botData;
            const telegramId = ctx.from.id.toString();
            
            let text = ctx.message.text || ctx.message.caption || '';
            let imageUrl = '';
            if (ctx.message.photo) {
                imageUrl = ctx.message.photo[ctx.message.photo.length - 1].file_id;
            }

            await axios.post(`${API_BASE}/client/support/ticket`, 
                { telegramId, text, imageUrl }, 
                { headers: { 'x-bot-token': botData.token } }
            );

            await ctx.reply('✅ <b>تم استلام رسالتك بنجاح!</b>\nسيقوم فريق الدعم بالرد عليك في أقرب وقت.', { 
                parse_mode: 'HTML',
                ...Markup.keyboard([
                    ['💸 تحويل فودافون كاش (مصر)', '📮 تحويل بريد'],
                    ['👤 حسابي', '🎧 الدعم الفني وتواصل معنا']
                ]).resize()
            });

            return ctx.scene.leave();
        } catch (err) {
            console.error(err);
            await ctx.reply('❌ حدث خطأ، يرجى المحاولة لاحقاً.');
            return ctx.scene.leave();
        }
    }
);
module.exports = supportWizard;