// bots/admin/actions/forwardTask.js
const Transaction = require('../../../models/Transaction');
const ExecutorBot = require('../../../models/ExecutorBot');
const { Markup } = require('telegraf');

module.exports = async (ctx) => {
    try {
        const txId = ctx.match[1];
        
        const transaction = await Transaction.findById(txId);
        if (!transaction || transaction.status !== 'pending') {
            return ctx.answerCbQuery('❌ الطلب غير متاح أو تمت معالجته مسبقاً!', { show_alert: true }).catch(()=>{});
        }

        // 1. جلب بوتات التنفيذ المباشر فقط (استثناء الوكلاء)
        const bots = await ExecutorBot.find({ status: 'active', isManagerBot: false });
        
        if (bots.length === 0) {
            return ctx.answerCbQuery('❌ لا يوجد أي بوت تنفيذي مباشر متاح حالياً!', { show_alert: true }).catch(()=>{});
        }

        // 2. إنشاء زر لكل بوت تنفيذي موجود
        const buttons = bots.map(bot => {
            return [Markup.button.callback(`🤖 ${bot.name}`, `assign_${txId}_${bot._id}`)];
        });
        buttons.push([Markup.button.callback('❌ إلغاء العملية', `cancelReq_${txId}`)]);

        // 3. جلب النص سواء كان رسالة عادية أو وصف لصورة
        const currentText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || 'طلب تحويل';
        const newText = `${currentText}\n\n👇 <b>الرجاء اختيار بوت التنفيذ الذي سيقوم بالعملية:</b>`;

        // 4. التفريق الذكي بين الرسالة النصية والمصورة لتجنب انهيار البوت
        if (ctx.callbackQuery.message.photo) {
            await ctx.editMessageCaption(newText, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(buttons)
            }).catch(()=>{});
        } else {
            await ctx.editMessageText(newText, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard(buttons)
            }).catch(()=>{});
        }

    } catch (error) {
        console.error(`[Forward Task Error]: ${error.message}`);
        ctx.answerCbQuery('حدث خطأ أثناء تحميل بوتات التنفيذ.', { show_alert: true }).catch(()=>{});
    }
};