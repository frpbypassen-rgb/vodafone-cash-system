// bots/admin/scenes/creditLimitScene.js
const { Scenes, Markup } = require('telegraf');
const User = require('../../../models/User');
const ClientBot = require('../../../models/ClientBot');

const creditLimitWizard = new Scenes.WizardScene(
    'CREDIT_LIMIT_SCENE',
    // 📍 الخطوة 1: اختيار (فرد أم شركة)
    async (ctx) => {
        await ctx.reply(
            '💳 <b>إدارة الحدود الائتمانية (التسهيلات)</b>\n\nيرجى اختيار نوع الحساب الذي تريد تعديل حده:',
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('👤 حدود عميل (فرد)', 'limit_user')],
                    [Markup.button.callback('🏢 حدود شركة', 'limit_company')],
                    [Markup.button.callback('🔙 رجوع للقائمة', 'cancel_limit')]
                ])
            }
        );
        return ctx.wizard.next();
    },

    // 📍 الخطوة 2: طلب المعرف (ID العميل) أو عرض قائمة الشركات
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_limit') {
            await ctx.editMessageText('✅ تم الرجوع للقائمة الرئيسية.');
            return ctx.scene.leave();
        }

        if (action === 'limit_user') {
            ctx.wizard.state.type = 'USER';
            await ctx.editMessageText(
                '👤 <b>تعديل حد عميل فردي</b>\n\nيرجى إرسال ID التليجرام الخاص بالعميل:',
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'back_to_start')]])
                }
            );
            return ctx.wizard.next();
        }

        if (action === 'limit_company') {
            ctx.wizard.state.type = 'COMPANY';
            const companies = await ClientBot.find({});
            if (companies.length === 0) {
                await ctx.answerCbQuery('❌ لا توجد شركات مسجلة.', { show_alert: true });
                return;
            }

            const buttons = companies.map(c => [Markup.button.callback(`🏢 ${c.name}`, `setLimitComp_${c._id}`)]);
            buttons.push([Markup.button.callback('🔙 رجوع', 'back_to_start')]);

            await ctx.editMessageText('🏢 <b>اختر الشركة المراد تعديل حدها:</b>', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(buttons)
            });
            return ctx.wizard.next();
        }
    },

    // 📍 الخطوة 3: استقبال القيمة أو التعامل مع "رجوع"
    async (ctx) => {
        // التعامل مع زر الرجوع
        if (ctx.callbackQuery?.data === 'back_to_start') {
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);
        }

        // إذا كان المختار شركة
        if (ctx.wizard.state.type === 'COMPANY' && ctx.callbackQuery?.data.startsWith('setLimitComp_')) {
            ctx.wizard.state.targetId = ctx.callbackQuery.data.replace('setLimitComp_', '');
            const company = await ClientBot.findById(ctx.wizard.state.targetId);
            await ctx.editMessageText(
                `🏢 <b>تعديل حد:</b> ${company.name}\n💰 <b>الحد الحالي:</b> ${company.creditLimit} دينار\n\nالآن أرسل القيمة الجديدة للحد الائتماني:`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'back_to_start')]])
                }
            );
            return ctx.wizard.next();
        }

        // إذا كان المختار فرد وأرسل الـ ID
        if (ctx.wizard.state.type === 'USER' && ctx.message?.text) {
            const user = await User.findOne({ telegramId: ctx.message.text });
            if (!user) return ctx.reply('❌ لم يتم العثور على العميل، تأكد من الـ ID:');
            
            ctx.wizard.state.targetId = user.telegramId;
            await ctx.reply(
                `👤 <b>تعديل حد:</b> ${user.name}\n💰 <b>الحد الحالي:</b> ${user.creditLimit || 0} دينار\n\nأرسل القيمة الجديدة للحد الائتماني:`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'back_to_start')]])
                }
            );
            return ctx.wizard.next();
        }
    },

    // 📍 الخطوة 4: تنفيذ الحفظ
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'back_to_start') {
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);
        }

        const amount = parseFloat(ctx.message?.text);
        if (isNaN(amount)) return ctx.reply('❌ يرجى إرسال رقم صحيح:');

        try {
            if (ctx.wizard.state.type === 'USER') {
                await User.findOneAndUpdate({ telegramId: ctx.wizard.state.targetId }, { creditLimit: amount });
            } else {
                await ClientBot.findByIdAndUpdate(ctx.wizard.state.targetId, { creditLimit: amount });
            }

            await ctx.reply(`✅ تم تحديث الحد الائتماني بنجاح إلى: ${amount} دينار.`, {
                reply_markup: {
                    keyboard: [['📥 طلبات التسجيل', '💸 طلبات التحويل'], ['📊 الإحصائيات', '💳 شحن رصيد أفراد'], ['🤖 إنشاء بوت تنفيذي', '🤖 عمليات البوت'], ['🤖 إنشاء بوت عميل', '💰 شحن رصيد شركات'], ['💳 حدود العميل', '🔍 البحث برقم الهاتف']],
                    resize_keyboard: true
                }
            });
        } catch (e) {
            await ctx.reply('❌ حدث خطأ أثناء التحديث.');
        }
        return ctx.scene.leave();
    }
);

module.exports = creditLimitWizard;