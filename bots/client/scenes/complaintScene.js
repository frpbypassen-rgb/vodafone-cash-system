// bots/client/scenes/complaintScene.js
const { Scenes, Markup } = require('telegraf');
const axios = require('axios');
const API_BASE = `http://127.0.0.1:${process.env.PORT || 3000}/api/bot`;

const complaintWizard = new Scenes.WizardScene(
    'COMPLAINT_SCENE',
    // 1️⃣ الخطوة الأولى: عرض آخر 10 عمليات
    async (ctx) => {
        ctx.wizard.state.searchAttempts = 0;
        ctx.wizard.state.reasonAttempts = 0;

        const telegramId = ctx.from.id.toString();
        const botData = ctx.wizard.state.botData;

        try {
            const res = await axios.get(`${API_BASE}/client/transactions/completed?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
            const txs = res.data.txs;

            if (!txs || txs.length === 0) {
                await ctx.reply('❌ لا توجد عمليات مكتملة لتقديم شكوى عليها حالياً.');
                return ctx.scene.leave();
            }

            let msg = '📑 <b>آخر عمليات تحويل خاصة بك:</b>\n\nاختر العملية التي تريد تقديم شكوى بخصوصها:';
            const buttons = txs.map(t => [Markup.button.callback(`📞 ${t.vodafoneNumber} | 💵 ${t.amount} EGP`, `selectTx_${t._id}`)]);
            
            buttons.push([Markup.button.callback('🔍 البحث برقم الحوالة', 'search_tx')]);
            buttons.push([Markup.button.callback('🔙 رجوع', 'cancel_complaint')]);

            await ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
            return ctx.wizard.next();
        } catch (e) {
            ctx.reply('❌ حدث خطأ، يرجى المحاولة لاحقاً.');
            return ctx.scene.leave();
        }
    },
    // 2️⃣ الخطوة الثانية: معالجة الاختيار أو طلب رقم الحوالة
    async (ctx) => {
        const action = ctx.callbackQuery?.data;
        if (action === 'cancel_complaint') { await ctx.editMessageText('✅ تم الإلغاء.'); return ctx.scene.leave(); }
        
        if (action === 'search_tx') {
            await ctx.editMessageText('🔎 من فضلك أرسل رقم الحوالة (رقم الطلب) المطلوب البحث عنه:');
            return ctx.wizard.next();
        }

        if (action && action.startsWith('selectTx_')) {
            ctx.wizard.state.txId = action.split('_')[1];
            return proceedToReason(ctx);
        }
    },
    // 3️⃣ الخطوة الثالثة: البحث عن الحوالة بالرقم مع عداد المحاولات 🟢
    async (ctx) => {
        try {
            ctx.wizard.state.searchAttempts = ctx.wizard.state.searchAttempts || 0;
            const searchId = ctx.message?.text?.trim();
            const botData = ctx.wizard.state.botData;
            const telegramId = ctx.from.id.toString();

            if (!searchId) {
                ctx.wizard.state.searchAttempts += 1;
                if (ctx.wizard.state.searchAttempts >= 2) {
                    await ctx.reply('❌ لقد قمت بإدخال بيانات غير صالحة مرتين متتاليتين.\nتم إلغاء العملية لحماية النظام.');
                    return ctx.scene.leave();
                }
                await ctx.reply('⚠️ <b>يرجى إرسال رقم الحوالة كنص صحيح (تتبقى لك محاولة واحدة):</b>', { parse_mode: 'HTML' });
                return;
            }

            const res = await axios.get(`${API_BASE}/client/transactions/search?telegramId=${telegramId}&searchId=${searchId}`, { headers: { 'x-bot-token': botData.token } });
            
            if (!res.data.success || !res.data.tx) {
                ctx.wizard.state.searchAttempts += 1;
                if (ctx.wizard.state.searchAttempts >= 2) {
                    await ctx.reply('❌ فشل العثور على الحوالة للمرة الثانية.\nتم إلغاء العملية، يرجى مراجعة رقم الطلب والمحاولة لاحقاً من القائمة الرئيسية.');
                    return ctx.scene.leave();
                }
                await ctx.reply('❌ <b>لم يتم العثور على حوالة بهذا الرقم!</b>\nتأكد من الرقم وأعد المحاولة <b>(تتبقى لك محاولة واحدة)</b>:', { parse_mode: 'HTML' });
                return;
            }
            
            ctx.wizard.state.searchAttempts = 0; 
            ctx.wizard.state.txId = res.data.tx._id;
            return proceedToReason(ctx);
        } catch (error) {
            ctx.reply('❌ حدث خطأ داخلي، يرجى المحاولة لاحقاً.');
            return ctx.scene.leave();
        }
    },
    // 4️⃣ الخطوة الرابعة: اختيار سبب الشكوى
    async (ctx) => {
        const action = ctx.callbackQuery?.data;
        if (action === 'reason_3') {
            await ctx.editMessageText('📝 من فضلك اكتب تفاصيل الشكوى بوضوح في رسالة واحدة:');
            return ctx.wizard.next();
        }
        
        const reasons = { 'reason_1': 'صورة التحويل غير مطابقة', 'reason_2': 'القيمة لم تصل كاملة' };
        ctx.wizard.state.complaintReason = reasons[action];
        return sendComplaintToAdmin(ctx);
    },
    // 5️⃣ الخطوة الخامسة: استقبال السبب اليدوي مع عداد المحاولات 🟢
    async (ctx) => {
        ctx.wizard.state.reasonAttempts = ctx.wizard.state.reasonAttempts || 0;

        if (!ctx.message?.text) {
            ctx.wizard.state.reasonAttempts += 1;
            if (ctx.wizard.state.reasonAttempts >= 2) {
                await ctx.reply('❌ لقد قمت بإدخال بيانات غير صالحة مرتين متتاليتين.\nتم إلغاء العملية لحماية النظام.');
                return ctx.scene.leave();
            }
            await ctx.reply('❌ <b>يرجى كتابة الشكوى في رسالة نصية (تتبقى لك محاولة واحدة):</b>', { parse_mode: 'HTML' });
            return;
        }

        ctx.wizard.state.reasonAttempts = 0;
        ctx.wizard.state.complaintReason = ctx.message.text;
        return sendComplaintToAdmin(ctx);
    }
);

const proceedToReason = async (ctx) => {
    await ctx.reply('❓ <b>ما هو سبب الشكوى؟</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('1️⃣ صورة التحويل غير مطابقة', 'reason_1')],
            [Markup.button.callback('2️⃣ القيمة لم تصل كاملة', 'reason_2')],
            [Markup.button.callback('3️⃣ سبب آخر (كتابة يدوية)', 'reason_3')]
        ])
    });
    ctx.wizard.selectStep(3);
};

const sendComplaintToAdmin = async (ctx) => {
    try {
        await ctx.reply('⏳ جاري إرسال الشكوى للإدارة، يرجى الانتظار ثوانٍ...');

        const txId = ctx.wizard.state.txId;
        const complaintText = ctx.wizard.state.complaintReason;
        const botData = ctx.wizard.state.botData;
        const telegramId = ctx.from.id.toString();

        await axios.post(`${API_BASE}/client/complaint`, { txId, telegramId, complaintText }, { headers: { 'x-bot-token': botData.token } });

        await ctx.reply('✅ تم إرسال شكواك للإدارة بنجاح.\nسيتم مراجعتها واتخاذ الإجراء اللازم فوراً.');
    } catch (error) {
        console.error('Complaint Error:', error);
        await ctx.reply('❌ حدث خطأ داخلي أثناء معالجة الشكوى.');
    }
    return ctx.scene.leave();
};

module.exports = complaintWizard;