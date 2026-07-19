// bots/admin/scenes/addClientBotScene.js
const { Scenes, Markup } = require('telegraf');
const ClientBot = require('../../../models/ClientBot');

const addClientBotScene = new Scenes.WizardScene(
    'ADD_CLIENT_BOT_SCENE',
    async (ctx) => {
        await ctx.reply('🤖 <b>إنشاء بوت عميل (شركة) جديد</b>\n\n📝 يرجى إرسال اسم الشركة أو العميل:', { parse_mode: 'HTML', ...Markup.removeKeyboard() });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        ctx.wizard.state.name = ctx.message.text;
        await ctx.reply('📱 يرجى إرسال رقم هاتف الشركة:');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        ctx.wizard.state.phone = ctx.message.text;
        await ctx.reply('🔑 يرجى إرسال التوكن (Token) الخاص بالبوت (من BotFather):');
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        const token = ctx.message.text;
        await ctx.reply('⏳ جاري تسجيل البوت في قاعدة البيانات...');

        try {
            const newBot = await ClientBot.create({
                name: ctx.wizard.state.name,
                phone: ctx.wizard.state.phone,
                token: token
            });

            // سنقوم لاحقاً باستدعاء المشغل الديناميكي هنا
            try {
                const { launchClientBot } = require('../../client/manager');
                launchClientBot(newBot);
            } catch (e) {
                console.log('سيتم تشغيل البوت عند توفر مدير العملاء');
            }

            await ctx.reply(
                `✅ <b>تم إنشاء بوت العميل بنجاح!</b>\n\n` +
                `🏢 <b>الشركة:</b> ${newBot.name}\n` +
                `📱 <b>الهاتف:</b> ${newBot.phone}\n\n` +
                `سيتمكن موظفو الشركة الآن من استخدام هذا البوت لإرسال التحويلات إليك.`,
                {
                    parse_mode: 'HTML',
                    ...Markup.keyboard([
                        ['📥 طلبات التسجيل', '💸 طلبات التحويل'],
                        ['📊 الإحصائيات', '💳 شحن رصيد'],
                        ['🤖 إنشاء بوت تنفيذي', '🤖 عمليات البوت'],
                        ['🤖 إنشاء بوت عميل', '💳 حدود العميل'],
                        ['🔍 البحث برقم الهاتف']
                    ]).resize()
                }
            );
        } catch (error) {
            console.error(error);
            if (error.code === 11000) {
                await ctx.reply('❌ هذا التوكن مسجل بالفعل لبوت آخر في النظام!');
            } else {
                await ctx.reply('❌ حدث خطأ أثناء الحفظ.');
            }
        }
        return ctx.scene.leave();
    }
);

module.exports = addClientBotScene;