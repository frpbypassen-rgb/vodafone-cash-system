// bots/admin/scenes/searchUserScene.js
const { Scenes, Markup } = require('telegraf');
const User = require('../../../models/User');
const ClientBot = require('../../../models/ClientBot');
const ClientEmployee = require('../../../models/ClientEmployee');
const Employee = require('../../../models/Employee');
const ExecutorBot = require('../../../models/ExecutorBot');

const searchUserWizard = new Scenes.WizardScene(
    'SEARCH_USER_SCENE',
    
    // 📍 الخطوة 1: عرض خيارات البحث الثلاثة
    async (ctx) => {
        await ctx.reply(
            '🔍 <b>نـظـام الـبـحـث الـشـامـل</b>\n\nيرجى اختيار طريقة البحث المطلوبة:',
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📱 بحث عن عميل (برقم الهاتف)', 'search_client')],
                    [Markup.button.callback('👨‍💻 بحث عن موظف تنفيذ (هاتف أو ID)', 'search_executor')],
                    [Markup.button.callback('🆔 بحث شامل وموسع (برقم الـ ID)', 'search_global')],
                    [Markup.button.callback('🔙 إلغاء ورجوع', 'cancel_search')]
                ])
            }
        );
        return ctx.wizard.next();
    },

    // 📍 الخطوة 2: استقبال الاختيار وطلب البيانات
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_search') {
            await ctx.editMessageText('✅ تم الإلغاء والرجوع للقائمة الرئيسية.');
            return ctx.scene.leave();
        }

        ctx.wizard.state.searchType = action;

        let promptMsg = '';
        if (action === 'search_client') {
            promptMsg = '📱 <b>البحث عن عميل (أفراد / شركات):</b>\n\nالرجاء إرسال رقم الهاتف (مثال: 010... أو 09...):';
        } else if (action === 'search_executor') {
            promptMsg = '👨‍💻 <b>البحث عن موظف تنفيذي:</b>\n\nالرجاء إرسال رقم الهاتف <b>أو</b> الـ ID الخاص بالموظف:';
        } else if (action === 'search_global') {
            promptMsg = '🆔 <b>البحث الشامل في كل البوتات:</b>\n\nالرجاء إرسال رقم التليجرام (ID) للبحث عن جميع تحركاته:';
        }

        await ctx.editMessageText(promptMsg, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع للخيارات', 'back_to_menu')]])
        });

        return ctx.wizard.next();
    },

    // 📍 الخطوة 3: تنفيذ البحث واستخراج البطاقات
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'back_to_menu') {
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);
        }

        const input = ctx.message?.text?.trim();
        if (!input) return ctx.reply('❌ يرجى إرسال نص صحيح للبحث:');

        const searchType = ctx.wizard.state.searchType;
        await ctx.reply('⏳ جاري المسح في قواعد البيانات...');

        try {
            let foundAny = false;

            // 1️⃣ البحث عن عملاء وبوتات شركات (برقم الهاتف)
            if (searchType === 'search_client') {
                // البحث في الأفراد
                const user = await User.findOne({ phone: input });
                if (user) {
                    foundAny = true;
                    await ctx.reply(
                        `👤 <b>بطاقة عميل (فردي)</b>\n` +
                        `━━━━━━━━━━━━━━\n` +
                        `📌 <b>الاسم:</b> ${user.name}\n` +
                        `📱 <b>الهاتف:</b> ${user.phone}\n` +
                        `🆔 <b>الـ ID:</b> <code>${user.telegramId}</code>\n` +
                        `💰 <b>الرصيد:</b> ${user.balance} دينار\n` +
                        `💳 <b>التسهيلات:</b> ${user.creditLimit || 0} دينار\n` +
                        `🎚️ <b>مستوى التسعير:</b> ${user.tier || 1}\n` +
                        `🚦 <b>الحالة:</b> ${user.status === 'active' ? '🟢 نشط' : '🔴 غير نشط'}\n` +
                        `📅 <b>الانضمام:</b> ${user.createdAt.toLocaleDateString('en-GB')}`,
                        { parse_mode: 'HTML' }
                    );
                }

                // البحث في موظفي الشركات
                const clientEmps = await ClientEmployee.find({ phone: input }).populate('clientBotId');
                for (const emp of clientEmps) {
                    foundAny = true;
                    const companyName = emp.clientBotId ? emp.clientBotId.name : 'شركة محذوفة';
                    await ctx.reply(
                        `🏢 <b>بطاقة عميل (موظف شركة)</b>\n` +
                        `━━━━━━━━━━━━━━\n` +
                        `📌 <b>الاسم:</b> ${emp.name}\n` +
                        `📱 <b>الهاتف:</b> ${emp.phone}\n` +
                        `🆔 <b>الـ ID:</b> <code>${emp.telegramId}</code>\n` +
                        `🏢 <b>الشركة التابع لها:</b> ${companyName}\n` +
                        `🚦 <b>الحالة:</b> ${emp.status === 'active' ? '🟢 نشط' : '🔴 محظور/معلق'}\n` +
                        `📅 <b>الانضمام:</b> ${emp.createdAt.toLocaleDateString('en-GB')}`,
                        { parse_mode: 'HTML' }
                    );
                }
            }

            // 2️⃣ البحث عن موظف تنفيذ (هاتف أو ID)
            else if (searchType === 'search_executor') {
                const emps = await Employee.find({ $or: [{ phone: input }, { telegramId: input }] }).populate('botId');
                for (const emp of emps) {
                    foundAny = true;
                    const botName = emp.botId ? emp.botId.name : 'بوت محذوف';
                    const roleName = emp.role === 'Manager' ? '👑 مدير البوت' : '👨‍💻 منفذ طلبات';
                    await ctx.reply(
                        `🛠 <b>بطاقة موظف تنفيذي</b>\n` +
                        `━━━━━━━━━━━━━━\n` +
                        `📌 <b>الاسم:</b> ${emp.name}\n` +
                        `📱 <b>الهاتف:</b> ${emp.phone}\n` +
                        `🆔 <b>الـ ID:</b> <code>${emp.telegramId}</code>\n` +
                        `🤖 <b>البوت التابع له:</b> ${botName}\n` +
                        `⚙️ <b>الصلاحية:</b> ${roleName}\n` +
                        `🚦 <b>الحالة:</b> ${emp.status === 'active' ? '🟢 نشط' : '🔴 غير نشط'}\n` +
                        `📅 <b>الانضمام:</b> ${emp.createdAt.toLocaleDateString('en-GB')}`,
                        { parse_mode: 'HTML' }
                    );
                }
            }

            // 3️⃣ المسح الشامل (بالـ ID)
            else if (searchType === 'search_global') {
                const targetId = input;
                let summary = `🌐 <b>التقرير الشامل للحساب:</b> <code>${targetId}</code>\n━━━━━━━━━━━━━━\n`;

                const user = await User.findOne({ telegramId: targetId });
                if (user) {
                    foundAny = true;
                    summary += `👤 <b>مسجل كعميل (فردي):</b>\n🔸 الاسم: ${user.name}\n🔸 الهاتف: ${user.phone}\n🔸 الحالة: ${user.status === 'active' ? '🟢 نشط' : '🔴 غير نشط'}\n\n`;
                }

                const clientEmps = await ClientEmployee.find({ telegramId: targetId }).populate('clientBotId');
                if (clientEmps.length > 0) {
                    foundAny = true;
                    summary += `🏢 <b>مسجل كموظف في الشركات التالية:</b>\n`;
                    clientEmps.forEach(e => {
                        summary += `🔸 ${e.clientBotId?.name || 'شركة محذوفة'} (الاسم المسجل: ${e.name})\n`;
                    });
                    summary += `\n`;
                }

                const execEmps = await Employee.find({ telegramId: targetId }).populate('botId');
                if (execEmps.length > 0) {
                    foundAny = true;
                    summary += `🛠 <b>مسجل كطاقم في بوتات التنفيذ:</b>\n`;
                    execEmps.forEach(e => {
                        summary += `🔸 ${e.botId?.name || 'بوت محذوف'} (الصلاحية: ${e.role})\n`;
                    });
                }

                if (foundAny) {
                    await ctx.reply(summary, { parse_mode: 'HTML' });
                }
            }

            if (!foundAny) {
                await ctx.reply('❌ لم يتم العثور على أي نتائج مطابقة في قواعد البيانات لهذا البحث.');
            }

            // عرض خيارات بعد انتهاء البحث
            await ctx.reply('👇 ماذا تريد أن تفعل الآن؟', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('🔍 إجراء بحث جديد', 'back_to_menu')],
                    [Markup.button.callback('🏠 إنهاء وإغلاق', 'end_search')]
                ])
            });
            return ctx.wizard.next();

        } catch (error) {
            console.error(error);
            await ctx.reply('❌ حدث خطأ داخلي أثناء البحث.');
            return ctx.scene.leave();
        }
    },

    // 📍 الخطوة 4: ما بعد البحث
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        
        if (ctx.callbackQuery.data === 'back_to_menu') {
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);
        }
        
        if (ctx.callbackQuery.data === 'end_search') {
            await ctx.editMessageText('✅ تم إنهاء البحث.');
            return ctx.scene.leave();
        }
    }
);

module.exports = searchUserWizard;