const { Scenes, Markup } = require('telegraf');
const ExecutorBot = require('../../../models/ExecutorBot');
const Transaction = require('../../../models/Transaction');

const settleManagerWizard = new Scenes.WizardScene(
    'SETTLE_MANAGER_SCENE',
    async (ctx) => {
        // 🟢 جلب بوتات الوكلاء (الإدارة التنفيذية) فقط
        const managerBots = await ExecutorBot.find({ isManagerBot: true, status: 'active' });

        if (managerBots.length === 0) {
            await ctx.reply('❌ لا يوجد بوتات وكلاء (إدارة تنفيذية) مسجلة في النظام.');
            return ctx.scene.leave();
        }

        const buttons = managerBots.map(b => [Markup.button.callback(`🏢 وكالة: ${b.name} | مديونية: ${Math.abs(b.balance || 0)}`, `settle_mgr_${b._id}`)]);
        buttons.push([Markup.button.callback('❌ إلغاء العملية', 'cancel_settle_mgr')]);

        await ctx.reply('👇 <b>اختر الوكالة (بوت الإدارة التنفيذي) التي تود تسديد حسابها:</b>', { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.callbackQuery && ctx.callbackQuery.data === 'cancel_settle_mgr') {
            await ctx.answerCbQuery().catch(()=>{});
            await ctx.editMessageText('✅ تم الإلغاء.');
            return ctx.scene.leave();
        }

        if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('settle_mgr_')) {
            const mgrId = ctx.callbackQuery.data.split('settle_mgr_')[1];
            ctx.wizard.state.mgrId = mgrId;
            await ctx.answerCbQuery().catch(()=>{});

            const mgrBot = await ExecutorBot.findById(mgrId);
            await ctx.editMessageText(`💰 <b>تسديد حساب وكالة التنفيذ:</b> ${mgrBot.name}\n📊 <b>المديونية الحالية:</b> ${Math.abs(mgrBot.balance || 0)} EGP\n\nالرجاء إدخال <b>المبلغ المسدد</b> للوكالة بالأرقام:\n(للإلغاء أرسل /cancel)`, { parse_mode: 'HTML' });
            return ctx.wizard.next();
        }
    },
    async (ctx) => {
        if (ctx.message && ctx.message.text === '/cancel') {
            await ctx.reply('✅ تم الإلغاء.');
            return ctx.scene.leave();
        }

        const amount = parseFloat(ctx.message.text);
        if (isNaN(amount) || amount <= 0) {
            await ctx.reply('⚠️ الرجاء إدخال مبلغ صحيح بالأرقام.');
            return;
        }

        try {
            const mgrBot = await ExecutorBot.findById(ctx.wizard.state.mgrId);

            // 🟢 تسجيل الإيداع في قاعدة البيانات لصالح الوكالة
            await Transaction.create({
                userId: 'admin',
                executorBotId: mgrBot._id, 
                amount: amount,
                costLYD: 0,
                vodafoneNumber: 'تسديد حساب وكالة',
                status: 'deposit',
                customId: `SETTLE-${Date.now().toString().slice(-6)}`,
                companyName: 'الإدارة المركزية',
                employeeName: 'تسديد نقدية (إيداع)',
                executorName: mgrBot.name
            });

            // تحديث رصيد الوكيل لتقليل المديونية
            mgrBot.balance += amount; 
            await mgrBot.save();

            await ctx.reply(`✅ <b>تم تسديد مبلغ ${amount} EGP بنجاح لحساب وكالة ${mgrBot.name}.</b>\nالمديونية المتبقية للوكالة: ${Math.abs(mgrBot.balance)} EGP`, { parse_mode: 'HTML' });
            return ctx.scene.leave();
        } catch (e) {
            await ctx.reply('❌ حدث خطأ أثناء التسديد.');
            return ctx.scene.leave();
        }
    }
);

module.exports = settleManagerWizard;