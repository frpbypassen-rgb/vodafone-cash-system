// bots/executor/scenes/employeeRegisterScene.js
const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api/bot';

const employeeRegisterWizard = new Scenes.WizardScene(
    'EMPLOYEE_REGISTER_SCENE',
    async (ctx) => {
        await ctx.reply('👋 <b>أهلاً بك في بوت التنفيذ!</b>\n\nالرجاء إرسال اسمك الثلاثي للبدء في إجراءات التسجيل:', { parse_mode: 'HTML' });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message?.text) return ctx.reply('⚠️ الرجاء إرسال اسمك كنص.');
        ctx.wizard.state.name = ctx.message.text;
        
        await ctx.reply('📞 ممتاز، الآن أرسل رقم هاتفك:', Markup.keyboard([
            [Markup.button.contactRequest('📱 إرسال رقم الهاتف تلقائياً')]
        ]).oneTime().resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message?.contact && !ctx.message?.text) return ctx.reply('⚠️ الرجاء إرسال رقم هاتفك.');
        
        const phone = ctx.message?.contact ? ctx.message.contact.phone_number : ctx.message.text;
        const telegramId = ctx.from.id.toString();

        await ctx.reply('⏳ جاري التسجيل...', Markup.removeKeyboard());

        try {
            const response = await axios.post(`${API_BASE}/executor/employee/register`, {
                telegramId,
                name: ctx.wizard.state.name,
                phone: phone
            }, { headers: { 'x-bot-token': ctx.botToken } });

            if (response.data.success) {
                if (response.data.isManager) {
                    await ctx.reply('✅ تم تسجيلك كمدير لهذا البوت بنجاح! يمكنك الآن استخدام البوت بكامل الصلاحيات.', { parse_mode: 'HTML' });
                } else {
                    await ctx.reply('✅ تم إرسال طلبك. يرجى انتظار موافقة مدير البوت.', { parse_mode: 'HTML' });
                    // Tell the managers
                    response.data.managers?.forEach(managerId => {
                        try {
                            ctx.telegram.sendMessage(managerId, `🔔 <b>طلب انضمام جديد!</b>\n\nالاسم: ${ctx.wizard.state.name}\nالرقم: ${phone}\nالمعرف: <code>${telegramId}</code>\n\nالرجاء الدخول للإدارة لتفعيله.`, { parse_mode: 'HTML' });
                        } catch(e){}
                    });
                }
            } else {
                await ctx.reply('❌ ' + (response.data.message || 'خطأ في التسجيل.'));
            }
        } catch (e) {
            await ctx.reply('❌ حدث خطأ فني أثناء التسجيل.');
        }

        return ctx.scene.leave();
    }
);
module.exports = employeeRegisterWizard;
