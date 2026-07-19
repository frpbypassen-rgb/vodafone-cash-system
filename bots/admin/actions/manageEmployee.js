// bots/admin/actions/manageEmployee.js
const Employee = require('../../../models/Employee');
const ExecutorBot = require('../../../models/ExecutorBot');
const { Telegram, Markup } = require('telegraf');

module.exports = async (ctx, action) => {
    try {
        const empId = ctx.match[1]; 
        
        const emp = await Employee.findById(empId);
        if (!emp) return ctx.answerCbQuery('❌ الموظف غير موجود أو تم حذفه!', { show_alert: true });

        const execBot = await ExecutorBot.findById(emp.botId);
        if (!execBot) return ctx.answerCbQuery('❌ البوت التنفيذي المرتبط بهذا الموظف لم يعد موجوداً!', { show_alert: true });

        const execBotAPI = new Telegram(execBot.token); 

        // جلب النص القديم للرسالة لمنع فقدانه
        const oldText = ctx.callbackQuery.message.text || ctx.callbackQuery.message.caption || 'طلب انضمام موظف';
        const adminName = ctx.from.first_name;

        let finalStatusText = '';
        let roleName = '';

        // 📍 حالة: القبول المبدئي (لو كانت مستخدمة)
        if (action === 'Accept') {
            await ctx.editMessageText(
                `${oldText}\n\n👇 <b>تم القبول المبدئي. يرجى تحديد صلاحية المستخدم:</b>`,
                {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('👨‍💻 تفعيل كموظف تنفيذ', `empRoleOp_${empId}`)],
                        [Markup.button.callback('👨‍💼 تفعيل كمدير نظام (وكيل)', `empRoleMgr_${empId}`)]
                    ])
                }
            );
            return; // نتوقف هنا ولا نحدث الرسالة عند باقي المديرين حتى يتم القرار النهائي
        }
        // 📍 حالة: الحظر والرفض
        else if (action === 'Ban') {
            emp.status = 'banned';
            finalStatusText = `${oldText}\n\n⛔️ <b>الحالة:</b> تم حظر الحساب ورفض الطلب.\n👨‍💻 <b>تم الرفض بواسطة:</b> ${adminName}`;
            
            try { await execBotAPI.sendMessage(emp.telegramId, '⛔️ تم رفض طلبك وحظر حسابك من قبل الإدارة.'); } catch(e){}
        }
        // 📍 حالة: تحديد الصلاحية (التفعيل النهائي)
        else if (action === 'RoleOp' || action === 'RoleMgr') {
            emp.status = 'active';
            emp.role = action === 'RoleOp' ? 'operator' : 'manager';
            roleName = emp.role === 'operator' ? 'موظف تنفيذ' : 'مدير نظام (وكيل)';
            
            finalStatusText = `${oldText}\n\n✅ <b>الحالة النهائية:</b> تم التفعيل بنجاح كـ [ ${roleName} ].\n👨‍💻 <b>تمت الموافقة بواسطة:</b> ${adminName}`;
            
            try { 
                await execBotAPI.sendMessage(
                    emp.telegramId, 
                    `🎉 <b>تم تفعيل حسابك بنجاح!</b>\n\nصلاحياتك الحالية: <b>${roleName}</b>.\nاضغط /start لفتح لوحة التحكم الخاصة بك وتحديث القائمة.`,
                    { parse_mode: 'HTML' }
                ); 
            } catch(e){}
        }

        // حفظ التعديلات على الموظف
        await emp.save();

        // 🟢 تحديث الرسالة عند جميع المديرين ليعرفوا من اتخذ القرار وتختفي الأزرار
        if (emp.adminMessages && emp.adminMessages.length > 0) {
            for (const msg of emp.adminMessages) {
                try { 
                    await ctx.telegram.editMessageText(
                        msg.telegramId, 
                        msg.messageId, 
                        null, 
                        finalStatusText, 
                        { parse_mode: 'HTML' } // إرسال النص بدون Markup لإخفاء الأزرار
                    );
                } catch(e) {}
            }
            // تفريغ مصفوفة الرسائل بعد الانتهاء
            emp.adminMessages = []; 
            await emp.save();
        } else {
            // كود احتياطي: لو لم تكن الرسائل مسجلة في الداتا بيز لأي سبب، يتم تحديث رسالة المدير الحالي فقط
            await ctx.editMessageText(finalStatusText, { parse_mode: 'HTML' }).catch(()=>{});
        }

    } catch (error) {
        console.error(`[Manage Employee Error]:`, error);
        ctx.answerCbQuery('حدث خطأ أثناء معالجة الطلب.', { show_alert: true }).catch(()=>{});
    }
};