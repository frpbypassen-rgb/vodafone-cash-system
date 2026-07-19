// bots/admin/scenes/addExecutorScene.js
const { Scenes, Markup } = require('telegraf');
const ExecutorBot = require('../../../models/ExecutorBot');
const { launchExecutorBot } = require('../../executor/manager'); 

const addExecutorScene = new Scenes.WizardScene(
    'ADD_EXECUTOR_SCENE',
    async (ctx) => {
        await ctx.reply('🤖 **إنشاء وإضافة بوت تنفيذي جديد**\n\n📝 الرجاء إرسال **اسم** البوت (مثال: بوت التنفيذ 1):');
        return ctx.wizard.next();
    },
    async (ctx) => {
        ctx.wizard.state.botName = ctx.message?.text;
        await ctx.reply('🔑 ممتاز. الآن الرجاء إرسال **التوكن (Token)** الخاص بالبوت:');
        return ctx.wizard.next();
    },
    async (ctx) => {
        ctx.wizard.state.token = ctx.message?.text;
        
        // 🟢 السطر الجديد: سؤال المدير عن نوع البوت
        await ctx.reply(
            '⚙️ **تحديد نوع البوت:**\nهل هذا البوت سيكون للتنفيذ المباشر (استقبال حوالات) أم بوت إداري (وكيل يجمع تحويلات بوتات أخرى)؟',
            Markup.inlineKeyboard([
                [Markup.button.callback('🤖 بوت تنفيذ مباشر', 'type_normal')],
                [Markup.button.callback('🏢 بوت إداري (وكيل)', 'type_manager')]
            ])
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        await ctx.answerCbQuery().catch(()=>{});
        
        const isManager = ctx.callbackQuery.data === 'type_manager';
        const { botName, token } = ctx.wizard.state;

        try {
            const newBot = await ExecutorBot.create({
                name: botName,
                token: token,
                isManagerBot: isManager // 🟢 حفظ النوع
            });
            
            launchExecutorBot(newBot);

            const typeText = isManager ? 'إداري (وكيل)' : 'تنفيذ مباشر';
            await ctx.editMessageText(`✅ تم حفظ وتشغيل البوت الـ ${typeText} "${botName}" بنجاح!`);
        } catch (error) {
            console.error(`[Add Executor Error]: ${error.message}`);
            await ctx.editMessageText('❌ حدث خطأ أثناء الحفظ. ربما هذا التوكن مسجل بالفعل في النظام.');
        }

        return ctx.scene.leave();
    }
);

module.exports = addExecutorScene;