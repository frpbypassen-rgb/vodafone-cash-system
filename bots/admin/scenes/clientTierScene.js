// bots/admin/scenes/clientTierScene.js
const { Scenes, Markup } = require('telegraf');
const User = require('../../../models/User');
const ClientBot = require('../../../models/ClientBot');

const clientTierWizard = new Scenes.WizardScene(
    'CLIENT_TIER_SCENE',
    // 📍 الخطوة 1: اختيار نوع العميل
    async (ctx) => {
        await ctx.reply(
            '🎚️ <b>إدارة مستويات التسعير السرية</b>\n\nلمن تريد تغيير مستوى الأسعار؟',
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('👤 عميل (فرد)', 'tier_user')],
                    [Markup.button.callback('🏢 شركة', 'tier_company')],
                    [Markup.button.callback('🔙 إلغاء وخروج', 'cancel_tier')]
                ])
            }
        );
        return ctx.wizard.next();
    },

    // 📍 الخطوة 2: طلب البيانات (ID أو اختيار شركة)
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_tier') {
            await ctx.editMessageText('✅ تم الرجوع للقائمة الرئيسية.');
            return ctx.scene.leave();
        }

        if (action === 'tier_user') {
            ctx.wizard.state.type = 'USER';
            await ctx.editMessageText('👤 <b>تعديل مستوى فرد</b>\n\nيرجى إرسال ID التليجرام الخاص بالعميل:', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'back_to_step_1')]])
            });
            return ctx.wizard.next();
        }

        if (action === 'tier_company') {
            ctx.wizard.state.type = 'COMPANY';
            const companies = await ClientBot.find({});
            if (companies.length === 0) return ctx.answerCbQuery('❌ لا توجد شركات مسجلة.', { show_alert: true });

            const buttons = companies.map(c => [Markup.button.callback(`🏢 ${c.name} (المستوى: ${c.tier || 1})`, `setTierComp_${c._id}`)]);
            buttons.push([Markup.button.callback('🔙 رجوع', 'back_to_step_1')]); // إضافة زر الرجوع

            await ctx.editMessageText('🏢 <b>اختر الشركة المراد تعديل مستواها:</b>', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(buttons)
            });
            return ctx.wizard.next();
        }
    },

    // 📍 الخطوة 3: عرض خيارات المستويات
    async (ctx) => {
        // معالجة زر الرجوع للخطوة 1
        if (ctx.callbackQuery?.data === 'back_to_step_1') {
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);
        }

        // مسار الشركة
        if (ctx.wizard.state.type === 'COMPANY' && ctx.callbackQuery?.data.startsWith('setTierComp_')) {
            ctx.wizard.state.targetId = ctx.callbackQuery.data.replace('setTierComp_', '');
            await ctx.editMessageText('🎚️ <b>اختر المستوى الجديد لهذه الشركة:</b>', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('1️⃣ المستوى الأول (الأساسي)', 'saveTier_1')],
                    [Markup.button.callback('2️⃣ المستوى الثاني', 'saveTier_2')],
                    [Markup.button.callback('3️⃣ المستوى الثالث', 'saveTier_3')],
                    [Markup.button.callback('🔙 رجوع لاختيار الشركة', 'back_to_step_2')]
                ])
            });
            return ctx.wizard.next();
        }

        // مسار الفرد (استقبال الـ ID)
        if (ctx.wizard.state.type === 'USER' && ctx.message?.text) {
            const user = await User.findOne({ telegramId: ctx.message.text });
            if (!user) return ctx.reply('❌ لم يتم العثور على العميل، تأكد من الـ ID:', Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'back_to_step_1')]]));
            
            ctx.wizard.state.targetId = user._id;
            await ctx.reply(`👤 العميل: ${user.name} (مستوى حالي: ${user.tier || 1})\n\n🎚️ <b>اختر المستوى الجديد:</b>`, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('1️⃣ المستوى الأول (الأساسي)', 'saveTier_1')],
                    [Markup.button.callback('2️⃣ المستوى الثاني', 'saveTier_2')],
                    [Markup.button.callback('3️⃣ المستوى الثالث', 'saveTier_3')],
                    [Markup.button.callback('🔙 رجوع لتعديل الـ ID', 'back_to_step_2_user')]
                ])
            });
            return ctx.wizard.next();
        }
    },

    // 📍 الخطوة 4: الحفظ النهائي أو الرجوع
    async (ctx) => {
        const action = ctx.callbackQuery?.data;

        // معالجة أزرار الرجوع للخطوة 2
        if (action === 'back_to_step_2' || action === 'back_to_step_2_user') {
            ctx.wizard.selectStep(1);
            // محاكاة الضغطة السابقة لإعادة عرض الخطوة 2 بناءً على النوع
            ctx.callbackQuery.data = ctx.wizard.state.type === 'USER' ? 'tier_user' : 'tier_company';
            return ctx.wizard.steps[1](ctx);
        }

        if (action && action.startsWith('saveTier_')) {
            const newTier = parseInt(action.replace('saveTier_', ''));
            const targetId = ctx.wizard.state.targetId;
            
            if (ctx.wizard.state.type === 'USER') {
                await User.findByIdAndUpdate(targetId, { tier: newTier });
            } else {
                await ClientBot.findByIdAndUpdate(targetId, { tier: newTier });
            }

            await ctx.editMessageText(`✅ <b>تم نقل العميل/الشركة إلى المستوى [ ${newTier} ] بنجاح!</b>`, { parse_mode: 'HTML' });
            return ctx.scene.leave();
        }
    }
);

module.exports = clientTierWizard;