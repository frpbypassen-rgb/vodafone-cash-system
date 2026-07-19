// bots/admin/scenes/settleExecutorScene.js
const { Scenes, Markup, Telegram } = require('telegraf');
const ExecutorBot = require('../../../models/ExecutorBot');
const Transaction = require('../../../models/Transaction');
const Employee = require('../../../models/Employee');

const settleExecutorWizard = new Scenes.WizardScene(
    'SETTLE_EXECUTOR_SCENE',
    // 1️⃣ الخطوة الأولى: اختيار البوت
    async (ctx) => {
        const bots = await ExecutorBot.find({});
        if (bots.length === 0) {
            await ctx.reply('❌ لا توجد بوتات تنفيذ مسجلة حالياً.');
            return ctx.scene.leave();
        }

        const buttons = bots.map(b => [Markup.button.callback(`🤖 ${b.name}`, `settle_${b._id}`)]);
        buttons.push([Markup.button.callback('🔙 إلغاء وخروج', 'cancel_settle')]);

        await ctx.reply('💵 <b>تسديد عهدة بوت تنفيذ</b>\n\nالرجاء اختيار البوت الذي تريد تسديد عهدته:', {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(buttons)
        });
        return ctx.wizard.next();
    },
    // 2️⃣ الخطوة الثانية: طلب المبلغ
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_settle') {
            await ctx.editMessageText('✅ تم الإلغاء.');
            return ctx.scene.leave();
        }

        if (ctx.callbackQuery?.data.startsWith('settle_')) {
            const botId = ctx.callbackQuery.data.split('_')[1];
            ctx.wizard.state.botId = botId;

            const execBot = await ExecutorBot.findById(botId);
            if (!execBot) return ctx.scene.leave();
            
            ctx.wizard.state.botName = execBot.name;
            ctx.wizard.state.botToken = execBot.token;

            await ctx.editMessageText(`🤖 <b>بوت: ${execBot.name}</b>\n\n💰 الرجاء إرسال المبلغ المراد تسديده (بالجنيه المصري):`, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء', 'cancel_settle')]])
            });
            return ctx.wizard.next();
        }
    },
    // 3️⃣ الخطوة الثالثة: التنفيذ والإشعار
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel_settle') {
            await ctx.editMessageText('✅ تم الإلغاء.');
            return ctx.scene.leave();
        }

        const amount = parseFloat(ctx.message?.text);
        if (isNaN(amount) || amount <= 0) {
            return ctx.reply('❌ مبلغ غير صالح! الرجاء إرسال أرقام فقط:', Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء', 'cancel_settle')]]));
        }

        const { botId, botName, botToken } = ctx.wizard.state;

        try {
            const now = new Date();
            const depId = `SETTLE-${now.getTime().toString().slice(-6)}`;
            
            // تسجيل التسديد كإيداع (Deposit) لصالح بوت التنفيذ ليتم خصمه من إجمالي العهدة
            await Transaction.create({
                userId: ctx.from.id.toString(),
                amount: amount,
                costLYD: 0,
                vodafoneNumber: '01000000000', 
                status: 'deposit',
                customId: depId,
                executorBotId: botId,
                clientBotId: null,
                companyName: botName,
                employeeName: 'الإدارة العليا (تسديد عهدة)'
            });

            await ctx.reply(`✅ <b>تم تسديد مبلغ ${amount} EGP لعهدة بوت [ ${botName} ] بنجاح!</b>`, { parse_mode: 'HTML' });

            // 🚀 إرسال الإشعار لمديري البوت التنفيذي
            const execAPI = new Telegram(botToken);
            const managers = await Employee.find({ botId: botId, role: 'manager' });
            
            if (managers.length > 0) {
                const notifyMsg = `💰 <b>إشعار سداد عهدة</b>\n\nتم سداد مبلغ <b>${amount} EGP</b> بنجاح من قبل الإدارة العليا. ✅`;
                for (const mgr of managers) {
                    try {
                        await execAPI.sendMessage(mgr.telegramId, notifyMsg, { parse_mode: 'HTML' });
                    } catch (e) {
                        console.error(`Failed to notify manager ${mgr.telegramId}`);
                    }
                }
            }

        } catch (err) {
            console.error(err);
            await ctx.reply('❌ حدث خطأ داخلي أثناء تسجيل السداد.');
        }

        return ctx.scene.leave();
    }
);

module.exports = settleExecutorWizard;