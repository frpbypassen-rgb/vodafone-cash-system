// bots/admin/actions/activateUser.js
const User = require('../../../models/User');
const { Telegram } = require('telegraf');
const clientBotAPI = new Telegram(process.env.CLIENT_BOT_TOKEN);

module.exports = async (ctx) => {
    try {
        const telegramId = ctx.match[1]; // استخراج الأيدي من الزر
        
        const user = await User.findOne({ telegramId });
        if (!user) {
            return ctx.answerCbQuery('❌ العميل غير موجود!', { show_alert: true });
        }

        if (user.status === 'active') {
            return ctx.answerCbQuery('⚠️ الحساب مفعل مسبقاً!', { show_alert: true });
        }

        // تفعيل الحساب
        user.status = 'active';
        await user.save();

        // تعديل رسالة الإدارة
        await ctx.editMessageText(
            `${ctx.callbackQuery.message.text}\n\n✅ **الحالة:** تم تفعيل الحساب بنجاح.`
        );

        // إرسال إشعار للعميل
        await clientBotAPI.sendMessage(
            telegramId,
            `🎉 **تم تفعيل حسابك بنجاح!**\n\nيمكنك الآن استخدام النظام. أرسل /start للبدء.`
        );

    } catch (error) {
        console.error(`[Activate User Error]: ${error.message}`);
        ctx.answerCbQuery('حدث خطأ أثناء التفعيل.', { show_alert: true });
    }
};