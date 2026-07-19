// bots/admin/scenes/settingsScene.js
const { Scenes, Markup, Telegram } = require('telegraf');
const Settings = require('../../../models/Settings');
const Admin = require('../../../models/Admin');
const { generateMasterClientReport, generateMasterExecutorReport } = require('../../../utils/masterReports');

const adminBotAPI = new Telegram(process.env.ADMIN_BOT_TOKEN);

const settingsWizard = new Scenes.WizardScene(
    'SETTINGS_SCENE',
    
    // 📍 الخطوة 1: عرض لوحة التحكم الحالية
    async (ctx) => {
        const set = await Settings.findOne({}) || await Settings.create({});
        const statusText = set.isManualClosed ? '🔴 مغلق يدوياً (متوقف)' : '🟢 يعمل آلياً حسب الوقت';

        await ctx.reply(
            `⚙️ <b>لوحة تحكم أوقات العمل وحالة البوت</b>\n` +
            `━━━━━━━━━━━━━━\n` +
            `🔓 <b>وقت الفتح:</b> ${set.openingTime}\n` +
            `🔒 <b>وقت الإغلاق:</b> ${set.closingTime}\n` +
            `🚦 <b>الحالة الحالية:</b> ${statusText}\n` +
            `📝 <b>رسالة الإغلاق:</b>\n<i>"${set.closedMessage}"</i>\n` +
            `━━━━━━━━━━━━━━\n` +
            `👇 <b>اختر الإجراء المطلوب:</b>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('⏰ تعديل وقت الفتح', 'edit_open_time'), Markup.button.callback('⏰ تعديل وقت الإغلاق', 'edit_close_time')],
                    [Markup.button.callback(set.isManualClosed ? '▶️ تشغيل البوت الآن' : '⏸️ إيقاف البوت وتقفيل اليوم', 'toggle_status')],
                    [Markup.button.callback('📝 تعديل رسالة الإغلاق', 'edit_msg')],
                    [Markup.button.callback('🔙 إغلاق ورجوع', 'close_settings')]
                ])
            }
        );
        return ctx.wizard.next();
    },

    // 📍 الخطوة 2: معالجة اختيار المدير
    async (ctx) => {
        if (!ctx.callbackQuery) return;
        const action = ctx.callbackQuery.data;

        if (action === 'close_settings') {
            await ctx.answerCbQuery().catch(() => {});
            await ctx.editMessageText('✅ تم إغلاق إعدادات الوقت.');
            return ctx.scene.leave();
        }

        // زر التبديل الفوري (إيقاف / تشغيل) ومحرك التقارير المركزية
        if (action === 'toggle_status') {
            await ctx.answerCbQuery().catch(() => {});
            const set = await Settings.findOne({});
            set.isManualClosed = !set.isManualClosed;
            await set.save();
            
            // إذا تم إغلاق البوت، يتم توليد وإرسال التقارير
            if (set.isManualClosed) {
                await ctx.reply('⏳ جاري إغلاق النظام وإنشاء التقارير الختامية لكافة القطاعات، يرجى الانتظار...');
                try {
                    const clientReportBuffer = await generateMasterClientReport();
                    const executorReportBuffer = await generateMasterExecutorReport();
                    const dateStr = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');

                    const admins = await Admin.find({});
                    for (const admin of admins) {
                        // إرسال تقرير العملاء والشركات
                        await adminBotAPI.sendDocument(admin.telegramId, 
                            { source: clientReportBuffer, filename: `Master_Clients_Report_${dateStr}.xlsx` },
                            { caption: '📊 **تقرير التقفيل اليومي الشامل - قطاع العملاء والشركات**', parse_mode: 'HTML' }
                        ).catch(() => {});

                        // إرسال تقرير المنفذين
                        await adminBotAPI.sendDocument(admin.telegramId, 
                            { source: executorReportBuffer, filename: `Master_Executors_Report_${dateStr}.xlsx` },
                            { caption: '🤖 **تقرير الأداء اليومي الشامل - قطاع بـوتـات التـنـفـيـذ**', parse_mode: 'HTML' }
                        ).catch(() => {});
                    }
                    await ctx.reply('✅ تم إرسال التقارير الختامية وإغلاق البوت بنجاح.');
                } catch (err) {
                    console.error('Master Report Error:', err);
                    await ctx.reply('⚠️ تم إغلاق البوت، لكن حدث خطأ أثناء توليد التقارير الشاملة.');
                }
            } else {
                await ctx.reply('✅ تم تشغيل البوت وفتحه للعملاء بنجاح!');
            }

            // إعادة تحميل اللوحة بالتحديث الجديد
            ctx.wizard.selectStep(0); 
            return ctx.wizard.steps[0](ctx);
        }

        ctx.wizard.state.action = action;

        let promptMsg = '';
        if (action === 'edit_open_time') promptMsg = '⏰ أرسل وقت الفتح الجديد بصيغة 24 ساعة (مثال: 09:00 أو 10:30):';
        if (action === 'edit_close_time') promptMsg = '⏰ أرسل وقت الإغلاق الجديد بصيغة 24 ساعة (مثال: 23:59 أو 00:00):';
        if (action === 'edit_msg') promptMsg = '📝 أرسل الرسالة التي ستظهر للعملاء عند محاولة استخدام البوت وهو مغلق:';

        await ctx.answerCbQuery().catch(() => {});
        await ctx.editMessageText(`👉 <b>${promptMsg}</b>`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء الإدخال', 'cancel_input')]])
        });
        return ctx.wizard.next();
    },

    // 📍 الخطوة 3: حفظ البيانات الجديدة
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_input') {
            await ctx.answerCbQuery().catch(() => {});
            await ctx.deleteMessage().catch(() => {});
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);
        }

        const input = ctx.message?.text?.trim();
        if (!input) return;

        const action = ctx.wizard.state.action;
        const set = await Settings.findOne({});

        try {
            // التحقق من صيغة الوقت (HH:MM)
            if (action === 'edit_open_time' || action === 'edit_close_time') {
                if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(input)) {
                    return ctx.reply('❌ صيغة الوقت خاطئة! يرجى الإرسال بصيغة HH:MM (مثال: 14:30):', Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء', 'cancel_input')]]));
                }
                if (action === 'edit_open_time') set.openingTime = input;
                if (action === 'edit_close_time') set.closingTime = input;
            }

            if (action === 'edit_msg') {
                set.closedMessage = input;
            }

            await set.save();
            await ctx.reply('✅ <b>تم حفظ الإعدادات بنجاح!</b>', { parse_mode: 'HTML' });
            
            // العودة وعرض اللوحة المحدثة
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);

        } catch (error) {
            console.error(error);
            ctx.reply('❌ حدث خطأ أثناء الحفظ.');
        }
    }
);

module.exports = settingsWizard;