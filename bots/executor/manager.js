// bots/executor/manager.js
const { Telegraf, Markup, session, Scenes } = require('telegraf');
const axios = require('axios');
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api/bot';

const proofWizard = require('./scenes/proofScene');
const employeeRegisterWizard = require('./scenes/employeeRegisterScene');
const financialClosingWizard = require('./scenes/financialClosingScene');
const resolveComplaintWizard = require('./scenes/resolveComplaintScene');
const cancelExecWizard = require('./scenes/cancelExecScene'); 
const editAmountWizard = require('./scenes/editAmountScene'); 
const provideSenderPhoneWizard = require('./scenes/provideSenderPhoneScene'); 
const settleChildWizard = require('./scenes/settleChildScene'); 
const supportWizard = require('./scenes/supportScene');

const activeBots = new Map();

const launchExecutorBot = (botData) => {
    try {
        if (activeBots.has(botData.token)) return;
        const bot = new Telegraf(botData.token);
        
        const stage = new Scenes.Stage([proofWizard, employeeRegisterWizard, financialClosingWizard, resolveComplaintWizard, cancelExecWizard, editAmountWizard, provideSenderPhoneWizard, settleChildWizard, supportWizard]);
        
        bot.use(session());
        bot.use(async (ctx, next) => {
            ctx.botToken = botData.token;
            if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
            if (ctx.message && ctx.message.text === '/cancel') {
                if (ctx.scene) await ctx.scene.leave(); 
                ctx.session = {}; 
                await ctx.reply('✅ تم إنهاء العملية.');
                return; 
            }
            return next();
        });

        bot.use(stage.middleware());

        const showExecutorDashboard = async (ctx) => {
            try {
                const response = await axios.get(`${API_BASE}/executor/dashboard?telegramId=${ctx.from.id}`, { headers: { 'x-bot-token': botData.token } });
                const { success, isRegistered, employee, botData: currentBot, settings: set } = response.data;
                
                if (!success || !isRegistered) {
                    return ctx.reply('⛔️ <b>حسابك غير مسجل أو غير مربوط بالبوت.</b>\n\nيجب عليك تسجيل الدخول في الموقع (منصة التنفيذ)، ثم الضغط على زر <b>"تفعيل تليجرام"</b> ونسخ الرسالة المشفرة.\n\nإذا قمت بنسخ الرسالة المشفرة مسبقاً، فقط <b>قم بلصقها وإرسالها هنا</b> 👇.', { parse_mode: 'HTML', disable_web_page_preview: true });
                }
                
                if (employee.status === 'pending') return ctx.reply(set?.executorPendingMessage || '⏳ حسابك قيد المراجعة في انتظار موافقة الإدارة.');
                if (employee.status === 'banned') return ctx.reply(set?.executorBannedMessage || '⛔️ تم حظر حسابك.');

                let keyboard = [];
                
                if (employee.role === 'operator') {
                    keyboard = [['🟠 الطلبات المعلقة', '🟡 طلبات قيد التنفيذ'], ['🎧 الدعم الفني وتواصل معنا']];
                    await ctx.reply(`🤖 أهلاً بك يا ${employee.name}`, Markup.keyboard(keyboard).resize());
                } else if (employee.role === 'manager') {
                    const toggleBtn = currentBot.status === 'paused' ? '🔴 استئناف عمل البوت' : '🟢 إيقاف مؤقت للبوت';
                    const statusTxt = currentBot.status === 'paused' ? '🔴 موقوف مؤقتاً (مخفي من الإدارة)' : '🟢 يعمل ويستقبل طلبات';
                    
                    if (currentBot.isManagerBot) {
                        keyboard = [[toggleBtn], ['🎧 الدعم الفني وتواصل معنا']];
                        await ctx.reply(`🏢 **لوحة الوكالة - ${currentBot.name}**\nأهلاً بك يا ${employee.name}\n📊 حالة الوكالة: ${statusTxt}`, Markup.keyboard(keyboard).resize());
                    } else {
                        keyboard = [['🟠 الطلبات المعلقة', '🟡 طلبات قيد التنفيذ'], [toggleBtn], ['🎧 الدعم الفني وتواصل معنا']];
                        await ctx.reply(`👨‍💼 **لوحة المدير - ${currentBot.name}**\nأهلاً بك يا ${employee.name}\n📊 حالة البوت: ${statusTxt}`, Markup.keyboard(keyboard).resize());
                    }
                }
            } catch (e) {
                console.error(e);
            }
        };

        bot.start(async (ctx) => {
            const telegramId = ctx.from.id.toString();
            const payload = ctx.startPayload;
            if (payload && payload.startsWith('LINK-EXEC-')) {
                try {
                    const { data } = await axios.post(`${API_BASE}/executor/link-telegram`, { token: payload, telegramId }, { headers: { 'x-bot-token': botData.token } });
                    if (data.success) {
                        await ctx.reply(`✅ <b>مرحباً بك يا ${data.name}!</b>\n\nتم ربط وتفعيل حسابك كموظف تنفيذ مع الموقع بنجاح.`, { parse_mode: 'HTML' });
                    }
                } catch (e) {
                    await ctx.reply('❌ رمز التفعيل غير صالح أو أنه منتهي الصلاحية.');
                }
            }
            await showExecutorDashboard(ctx);
        });

        // 🟢 معالجة لصق الكود مباشرة في المحادثة
        bot.hears(/^LINK-EXEC-/, async (ctx) => {
            const telegramId = ctx.from.id.toString();
            const payload = ctx.message.text.trim();
            try {
                const { data } = await axios.post(`${API_BASE}/executor/link-telegram`, { token: payload, telegramId }, { headers: { 'x-bot-token': botData.token } });
                if (data.success) {
                    await ctx.reply(`✅ <b>مرحباً بك يا ${data.name}!</b>\n\nتم ربط وتفعيل حسابك كموظف تنفيذ مع الموقع بنجاح.`, { parse_mode: 'HTML' });
                    await showExecutorDashboard(ctx);
                }
            } catch (e) {
                await ctx.reply('❌ رمز التفعيل غير صالح أو أنه منتهي الصلاحية.');
            }
        });


        bot.hears('🏠 القائمة الرئيسية (تحديث)', async (ctx) => {
            if (ctx.scene) await ctx.scene.leave();
            await showExecutorDashboard(ctx);
        });

        bot.hears('🎧 الدعم الفني وتواصل معنا', (ctx) => {
            ctx.scene.enter('SUPPORT_SCENE', { botData });
        });

        bot.hears('🟢 إيقاف مؤقت للبوت', async (ctx) => {
            try {
                await axios.post(`${API_BASE}/executor/bot/status`, { status: 'paused' }, { headers: { 'x-bot-token': botData.token } });
                await ctx.reply('⏸ <b>تم إيقاف البوت مؤقتاً!</b>\nلن يظهر البوت الآن في قائمة التحويل الخاصة بالإدارة.', { parse_mode: 'HTML' });
                await showExecutorDashboard(ctx);
            } catch(e){}
        });

        bot.hears('🔴 استئناف عمل البوت', async (ctx) => {
            try {
                await axios.post(`${API_BASE}/executor/bot/status`, { status: 'active' }, { headers: { 'x-bot-token': botData.token } });
                await ctx.reply('▶️ <b>تم استئناف عمل البوت!</b>\nالبوت الآن ظاهر ومتاح للإدارة ويستقبل تحويلات جديدة.', { parse_mode: 'HTML' });
                await showExecutorDashboard(ctx);
            } catch(e){}
        });

        bot.action(/mgrApproveEmp_(.+)/, async (ctx) => {
            try {
                const empId = ctx.match[1];
                const res = await axios.post(`${API_BASE}/executor/employee/manage`, { action: 'approve', empId }, { headers: { 'x-bot-token': botData.token } });
                if (res.data.success) {
                    await ctx.editMessageText(`✅ <b>تم قبول الموظف:</b> ${res.data.emp.name} بنجاح.`, {parse_mode:'HTML'});
                    await ctx.telegram.sendMessage(res.data.emp.telegramId, `🎉 <b>مبارك!</b>\nقام المدير بالموافقة على انضمامك لفريق العمل.\n\nاضغط /start لفتح اللوحة وبدء العمل.`, {parse_mode:'HTML'}).catch(()=>{});
                }
            } catch(e){}
        });

        bot.action(/mgrRejectEmp_(.+)/, async (ctx) => {
            try {
                const empId = ctx.match[1];
                const res = await axios.post(`${API_BASE}/executor/employee/manage`, { action: 'reject', empId }, { headers: { 'x-bot-token': botData.token } });
                if (res.data.success) {
                    await ctx.editMessageText(`❌ تم رفض وحذف طلب الموظف: ${res.data.emp.name}.`);
                    await ctx.telegram.sendMessage(res.data.emp.telegramId, `❌ عذراً، تم رفض طلب انضمامك من قبل المدير.`, {parse_mode:'HTML'}).catch(()=>{});
                }
            } catch(e){}
        });

        bot.hears('🟠 الطلبات المعلقة', async (ctx) => {
            try {
                const res = await axios.get(`${API_BASE}/executor/transactions/pending`, { headers: { 'x-bot-token': botData.token } });
                if (!res.data.success) return;
                
                const pendingTxs = res.data.txs.filter(t => t.status === 'processing');
                if (pendingTxs.length === 0) return ctx.reply('✅ لا توجد أي طلبات معلقة بانتظار التنفيذ.');

                for (const tx of pendingTxs) {
                    let typeLabel = 'فودافون كاش';
                    if(tx.transferType === 'post_account') typeLabel = 'حساب بريد';
                    if(tx.transferType === 'post_card') typeLabel = 'بطاقة عميل';

                    let accDetails = `📞 <b>الرقم/الحساب:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n`;
                    if(tx.accountName) accDetails += `👤 <b>الاسم:</b> ${tx.accountName}\n`;

                    const textMsg = `🔔 <b>طلب معلق (${typeLabel}):</b>\n${accDetails}\n💵 المبلغ: ${tx.amount} EGP\n🧾 الطلب: <code>${tx.customId || tx._id}</code>`;
                    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('🤝 قبول المهمة', `accept_task_${tx._id}`)], [Markup.button.callback('❌ رفض', `reject_task_${tx._id}`)]]);

                    await ctx.reply(textMsg, { parse_mode: 'HTML', ...keyboard });
                }
            } catch(e){}
        });

        bot.hears('🟡 طلبات قيد التنفيذ', async (ctx) => {
            try {
                const res = await axios.get(`${API_BASE}/executor/transactions/pending`, { headers: { 'x-bot-token': botData.token } });
                if (!res.data.success) return;
                
                const myTxs = res.data.txs.filter(t => t.status === 'accepted' && t.executorEmployeeName === ctx.from.first_name); // simplistic mapping
                if (myTxs.length === 0) return ctx.reply('✅ لا توجد أي طلبات قيد التنفيذ في عهدتك حالياً.');

                for (const tx of myTxs) {
                    const execMsg = `⚙️ <b>طلب قيد التنفيذ!</b>\n\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>رقم المحفظة:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 <b>المبلغ المطلوب:</b> ${tx.amount} EGP\n${tx.notes ? `📝 <b>الملاحظة:</b> ${tx.notes}\n` : ''}━━━━━━━━━━━━━━`;
                    const keyboard = Markup.inlineKeyboard([
                        [Markup.button.callback('✅ تم التحويل (إرفاق الإثبات)', `done_task_${tx._id}`)],
                        [Markup.button.callback('✏️ تعديل المبلغ المحول', `editAmount_${tx._id}`)],
                        [Markup.button.callback('❌ إلغاء الحوالة (يوجد مشكلة)', `cancelExec_${tx._id}`)]
                    ]);
                    await ctx.reply(execMsg, { parse_mode: 'HTML', ...keyboard });
                }
            } catch(e){}
        });

        bot.action(/accept_task_(.+)/, async (ctx) => {
            const txId = ctx.match[1];
            try {
                const res = await axios.post(`${API_BASE}/executor/task/action`, { action: 'accept', txId, telegramId: ctx.from.id.toString() }, { headers: { 'x-bot-token': botData.token } });
                if (res.data.success) {
                    await ctx.editMessageText('✅ <b>تم قبول المهمة!</b>\nيرجى إتمام التحويل وإرفاق الإثبات.', { parse_mode: 'HTML' });
                    // Send keyboard options
                    const tx = res.data.tx;
                    const execMsg = `⚙️ <b>أنت الآن تقوم بتنفيذ هذا الطلب!</b>\n\n🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n📞 <b>رقم المحفظة:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n💵 <b>المبلغ المطلوب:</b> ${tx.amount} EGP\n${tx.notes ? `📝 <b>الملاحظة:</b> ${tx.notes}\n` : ''}━━━━━━━━━━━━━━`;
                    await ctx.reply(execMsg, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
                        [Markup.button.callback('✅ تم التحويل (إرفاق الإثبات)', `done_task_${tx._id}`)],
                        [Markup.button.callback('✏️ تعديل المبلغ المحول', `editAmount_${tx._id}`)],
                        [Markup.button.callback('❌ إلغاء الحوالة (يوجد مشكلة)', `cancelExec_${tx._id}`)]
                    ]) });
                } else {
                    await ctx.editMessageText('⚠️ ' + (res.data.message || 'هذا الطلب لم يعد متاحاً.'));
                }
            } catch(e) {}
        });

        bot.action(/reject_task_(.+)/, async (ctx) => {
            const txId = ctx.match[1];
            try {
                const res = await axios.post(`${API_BASE}/executor/task/action`, { action: 'reject', txId, telegramId: ctx.from.id.toString() }, { headers: { 'x-bot-token': botData.token } });
                if (res.data.success) {
                    await ctx.editMessageText('❌ تم رفض المهمة وإعادتها لقائمة الانتظار.');
                } else {
                    await ctx.editMessageText('⚠️ تمت معالجة هذا الطلب مسبقاً.');
                }
            } catch(e) {}
        });

        bot.action(/done_task_(.+)/, (ctx) => ctx.scene.enter('PROOF_SCENE', { txId: ctx.match[1], promptMsgId: ctx.callbackQuery.message.message_id }));
        bot.action(/editAmount_(.+)/, (ctx) => ctx.scene.enter('EDIT_AMOUNT_SCENE', { txId: ctx.match[1], promptMsgId: ctx.callbackQuery.message.message_id }));
        bot.action(/cancelExec_(.+)/, (ctx) => ctx.scene.enter('CANCEL_EXEC_SCENE', { txId: ctx.match[1], promptMsgId: ctx.callbackQuery.message.message_id }));

        bot.launch().then(() => {
            console.log(`✅ Executor Bot Started: ${botData.name}`);
            activeBots.set(botData.token, bot);
        }).catch(err => {
            console.error(`❌ Failed to start Executor Bot ${botData.name}:`, err);
        });

    } catch (e) {
        console.error('Executor Bot Launch Error:', e);
    }
};

const stopExecutorBot = (token) => {
    if (activeBots.has(token)) {
        activeBots.get(token).stop('User requested stop');
        activeBots.delete(token);
        console.log('🛑 Executor Bot Stopped.');
    }
};

const startAllExecutorBots = async () => {
    try {
        const axios = require('axios');
        const { data } = await axios.get(`${API_BASE}/system/executor-bots`);
        if (data.bots && data.bots.length > 0) {
            for (const bot of data.bots) {
                if (bot.token && bot.status !== 'inactive') {
                    launchExecutorBot(bot);
                }
            }
            console.log(`✅ تم تشغيل ${data.bots.length} بوت منفذ.`);
        } else {
            console.log('ℹ️ لا توجد بوتات منفذين لتشغيلها.');
        }
    } catch (e) {
        console.error('⚠️ تعذر تحميل بوتات المنفذين:', e.message);
    }
};

module.exports = {
    launchExecutorBot,
    stopExecutorBot,
    startAllExecutorBots
};
