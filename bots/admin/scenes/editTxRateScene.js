// bots/admin/scenes/editTxRateScene.js
const { Scenes, Markup } = require('telegraf');
const Transaction = require('../../../models/Transaction');
const User = require('../../../models/User');
const ClientBot = require('../../../models/ClientBot');

const editTxRateWizard = new Scenes.WizardScene(
    'EDIT_TX_RATE_SCENE',
    // الخطوة 1: طلب رقم العملية
    async (ctx) => {
        await ctx.reply('🔍 <b>من فضلك أرسل رقم الطلب (ID أو رقم العملية) المراد تعديل سعرها:</b>', { 
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('🔙 إلغاء', 'cancel')]])
        });
        return ctx.wizard.next();
    },
    // الخطوة 2: البحث وعرض التفاصيل
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel') {
            await ctx.editMessageText('✅ تم الإلغاء.');
            return ctx.scene.leave();
        }

        const searchId = ctx.message?.text?.trim();
        if (!searchId) return ctx.reply('⚠️ يرجى إرسال رقم صحيح.');

        // البحث برقم الـ ID الخاص بقاعدة البيانات أو الـ Custom ID
        const tx = await Transaction.findOne({ $or: [{ _id: searchId }, { customId: searchId }] }).catch(()=>null);

        if (!tx) {
            return ctx.reply('❌ لم يتم العثور على هذه العملية، تأكد من الرقم وأعد المحاولة:');
        }

        if (tx.status === 'rejected' || tx.status === 'cancelled_by_admin') {
            return ctx.reply('⚠️ هذه العملية ملغية أو مرفوضة بالفعل ولا يمكن تعديل سعرها، يرجى المحاولة برقم آخر:');
        }

        ctx.wizard.state.tx = tx;
        const currentRate = (tx.amount / tx.costLYD).toFixed(3);

        await ctx.reply(
            `📑 <b>بيانات العملية الحالية:</b>\n` +
            `👤 <b>العميل:</b> ${tx.employeeName || 'غير محدد'}\n` +
            `💵 <b>المبلغ:</b> ${tx.amount} EGP\n` +
            `💰 <b>التكلفة الحالية:</b> ${tx.costLYD.toFixed(2)} LYD\n` +
            `💱 <b>سعر الصرف المحسوب:</b> ${currentRate}\n` +
            `📌 <b>الحالة:</b> ${tx.status}\n\n` +
            `✍️ <b>أرسل سعر الصرف الجديد الآن (مثال: 6.45):</b>\n\n<i>(لإلغاء العملية أرسل كلمة "إلغاء")</i>`,
            { parse_mode: 'HTML' }
        );
        return ctx.wizard.next();
    },
    // الخطوة 3: التنفيذ وتعديل الأرصدة
    async (ctx) => {
        if (ctx.message?.text === 'إلغاء') {
            await ctx.reply('✅ تم الإلغاء.');
            return ctx.scene.leave();
        }

        const newRate = parseFloat(ctx.message?.text);
        if (isNaN(newRate) || newRate <= 0) {
            return ctx.reply('❌ يرجى إرسال رقم صحيح لسعر الصرف (مثال: 6.45):');
        }

        const tx = ctx.wizard.state.tx;
        const oldCost = tx.costLYD;
        const newCost = tx.amount / newRate; // (المبلغ بالجنيه / السعر) = (التكلفة بالدينار)
        const diff = newCost - oldCost; 

        try {
            // 1. تعديل رصيد العميل أو الشركة بالفرق (بالزيادة أو النقصان)
            if (tx.clientBotId) {
                const company = await ClientBot.findById(tx.clientBotId);
                if (company) {
                    company.balance -= diff; 
                    await company.save();
                }
            } else {
                const user = await User.findOne({ telegramId: tx.userId });
                if (user) {
                    user.balance -= diff;
                    await user.save();
                }
            }

            // 2. تحديث بيانات العملية وإضافة ملاحظة إدارية
            tx.costLYD = newCost;
            tx.adminNotes = (tx.adminNotes || '') + `\n[تم تعديل السعر من ${(tx.amount/oldCost).toFixed(3)} إلى ${newRate} بواسطة الإدارة]`;
            await tx.save();

            let diffText = '';
            if (diff > 0) {
                diffText = `🔴 تم خصم ${Math.abs(diff).toFixed(2)} LYD إضافية من العميل.`;
            } else if (diff < 0) {
                diffText = `🟢 تم استرداد ${Math.abs(diff).toFixed(2)} LYD وإعادتها لرصيد العميل.`;
            } else {
                diffText = `⚪ السعر لم يتغير عن السابق.`;
            }

            await ctx.reply(
                `✅ <b>تم تعديل سعر العملية والتسوية بنجاح!</b>\n\n` +
                `💰 التكلفة القديمة: ${oldCost.toFixed(2)} LYD\n` +
                `💵 التكلفة الجديدة: ${newCost.toFixed(2)} LYD\n` +
                `🔄 <b>التسوية الآلية:</b> ${diffText}`,
                { parse_mode: 'HTML' }
            );

        } catch (error) {
            console.error(error);
            await ctx.reply('❌ حدث خطأ فني أثناء تعديل الرصيد.');
        }
        return ctx.scene.leave();
    }
);

module.exports = editTxRateWizard;