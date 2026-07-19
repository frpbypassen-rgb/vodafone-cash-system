// bots/client/manager.js
const { Telegraf, Markup, session, Scenes, Telegram } = require('telegraf');
const ExcelJS = require('exceljs');
const cron = require('node-cron'); 

const axios = require('axios');
const API_BASE = `http://127.0.0.1:${process.env.PORT || 3000}/api/bot`;

const transferWizard = require('./scenes/transferScene');
const postTransferWizard = require('./scenes/postTransferScene'); 

const complaintWizard = require('./scenes/complaintScene');
const requestSenderPhoneWizard = require('./scenes/requestSenderPhoneScene'); 
const supportWizard = require('./scenes/supportScene'); // 🟢 تمت الإضافة

const activeClientBots = new Map();

const getArgb = (hex) => {
    return 'FF' + (hex || '#FFFFFF').replace('#', '').toUpperCase();
};

const buildInvoiceSheet = (sheet, name, phone, dateLabel, txs, deposits, currentBalance, set) => {
    sheet.views = [{ rightToLeft: true }];
    const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    const thickBorder = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } };
    const alignCenter = { vertical: 'middle', horizontal: 'center' };

    sheet.getColumn(1).width = 6.5;    
    sheet.getColumn(2).width = 28.75;  
    sheet.getColumn(3).width = 23.25;  
    sheet.getColumn(4).width = 23.5;   
    sheet.getColumn(5).width = 24.5;   
    sheet.getColumn(6).width = 25.625; 
    sheet.getColumn(7).width = 21.5;   
    sheet.getColumn(8).width = 17.5;   

    sheet.mergeCells('A1:H3');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'شــــركــــــــة الاهـــــــــــرام للاتـــصــــالات والــتــقــنــيــة';
    titleCell.font = { size: 26, bold: true, color: { argb: 'FFFFFFFF' } }; 
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002060' } }; 
    titleCell.alignment = alignCenter;
    titleCell.border = thickBorder;

    sheet.mergeCells('A4:F4');
    const nameCell = sheet.getCell('A4');
    nameCell.value = `السيد: "${name}"`;
    nameCell.font = { bold: true, size: 20, color: { argb: 'FF000000' } };
    nameCell.alignment = alignCenter;

    sheet.mergeCells('G4:H4');
    const dateCell = sheet.getCell('G4');
    dateCell.value = `التاريخ: ${dateLabel}`;
    dateCell.font = { bold: true, size: 16, color: { argb: 'FF000000' } };
    dateCell.alignment = alignCenter;

    const headers = ['ت', 'التسلسل', 'رقم المحفظة', 'القيمة بالجنيه', 'سعر الصرف', 'الإجمالي بالدينار', 'التاريخ', 'ملاحظات'];
    const headerRow = sheet.getRow(6);
    headerRow.values = headers;
    headerRow.height = 35;
    headerRow.eachCell((cell) => {
        cell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } }; 
        cell.alignment = alignCenter;
        cell.border = borderStyle;
    });

    let totalLYD = 0; 
    let totalEGP = 0; 
    let startRow = 7;

    txs.forEach((t, index) => {
        totalLYD += t.costLYD; 
        totalEGP += t.amount;
        const rateDisplay = t.exchangeRate ? t.exchangeRate.toFixed(3) : (t.costLYD ? (t.amount / t.costLYD).toFixed(3) : '0.00');
        
        const rowValues = [
            index + 1,
            t.customId || t._id.toString().slice(-6),
            t.vodafoneNumber || t.accountNumber || '-',
            t.amount,
            rateDisplay,
            t.costLYD,
            t.updatedAt.toLocaleDateString('en-GB'),
            t.notes || ''
        ];

        const row = sheet.getRow(startRow);
        row.values = rowValues;
        row.height = 28;
        row.eachCell((cell, colNumber) => {
            cell.border = borderStyle;
            cell.alignment = alignCenter;
            cell.font = { size: 14 };
            if (colNumber === 4 || colNumber === 6) cell.numFmt = '#,##0.00';
        });
        startRow++;
    });

    let totalDeposits = 0;
    deposits.forEach(d => totalDeposits += Math.abs(d.amount)); 

    const grandTotal = currentBalance || 0;
    const previousValue = grandTotal + totalLYD - totalDeposits;

    sheet.mergeCells(`A${startRow}:C${startRow}`);
    const row1 = sheet.getRow(startRow);
    row1.height = 30;
    row1.getCell(1).value = 'شغل اليومي';
    row1.getCell(1).font = { bold: true, size: 16 };
    row1.getCell(1).alignment = alignCenter;

    row1.getCell(4).value = totalEGP;
    row1.getCell(4).numFmt = '#,##0.00';
    row1.getCell(4).font = { bold: true, size: 16 };
    row1.getCell(4).alignment = alignCenter;

    row1.getCell(5).value = 'شغل اليومي';
    row1.getCell(5).font = { bold: true, size: 16 };
    row1.getCell(5).alignment = alignCenter;

    row1.getCell(6).value = totalLYD;
    row1.getCell(6).numFmt = '#,##0.00';
    row1.getCell(6).font = { bold: true, size: 18 };
    row1.getCell(6).alignment = alignCenter;

    const row2 = sheet.getRow(startRow + 1);
    row2.height = 28;
    row2.getCell(5).value = 'القيمة السابقة';
    row2.getCell(5).font = { bold: true, size: 16 };
    row2.getCell(5).alignment = alignCenter;
    
    row2.getCell(6).value = previousValue;
    row2.getCell(6).numFmt = '#,##0.00';
    row2.getCell(6).font = { bold: true, size: 16 };
    row2.getCell(6).alignment = alignCenter;

    const row3 = sheet.getRow(startRow + 2);
    row3.height = 28;
    row3.getCell(5).value = 'المدفوع';
    row3.getCell(5).font = { bold: true, size: 16 };
    row3.getCell(5).alignment = alignCenter;

    row3.getCell(6).value = totalDeposits;
    row3.getCell(6).numFmt = '#,##0.00';
    row3.getCell(6).font = { bold: true, size: 16 };
    row3.getCell(6).alignment = alignCenter;

    const row4 = sheet.getRow(startRow + 3);
    row4.height = 32;
    row4.getCell(5).value = 'المجموع المتبقي';
    row4.getCell(5).font = { bold: true, size: 16 };
    row4.getCell(5).alignment = alignCenter;

    row4.getCell(6).value = grandTotal;
    row4.getCell(6).numFmt = '#,##0.00';
    row4.getCell(6).font = { bold: true, size: 18, color: { argb: grandTotal < 0 ? 'FFFF0000' : 'FF000000' } };
    row4.getCell(6).alignment = alignCenter;
    row4.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } }; 
    row4.getCell(6).border = thickBorder;
};

;

;

;

;

const generateClientExcel = async (ctx, botData, type) => {
    const telegramId = ctx.from.id.toString();
    const isMainBot = botData.name === 'البوت الرئيسي';
    let targetName = '', targetPhone = '', entityFilter = {}, currentDbBalance = 0;
    try {
        const resInfo = await axios.get(`${API_BASE}/client/dashboard?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
        if (!resInfo.data.account || resInfo.data.account.status !== 'active') return ctx.reply('⛔️ حسابك غير مفعل أو غير مصرح لك.');
        
        if (isMainBot) {
            targetName = resInfo.data.account.name; targetPhone = resInfo.data.account.phone;
            entityFilter = { userId: telegramId, clientBotId: null };
            currentDbBalance = resInfo.data.account.balance;
        } else {
            targetName = resInfo.data.company.name; targetPhone = resInfo.data.company.phone;
            entityFilter = { clientBotId: botData._id };
            currentDbBalance = resInfo.data.company.balance;
        }
        
        const now = new Date();
        let start, end, dateLabel;
        if (type === 'daily') {
            start = new Date(now); start.setHours(0, 0, 0, 0);
            end = new Date(now); end.setHours(23, 59, 59, 999);
            dateLabel = start.toLocaleDateString('en-GB');
        } else {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
            dateLabel = `شهر ${now.getMonth() + 1} - ${now.getFullYear()}`;
        }

        const resData = await axios.post(`${API_BASE}/client/report-data`, { entityFilter, start, end }, { headers: { 'x-bot-token': botData.token } });
        const txs = resData.data.txs.map(t => ({ ...t, updatedAt: new Date(t.updatedAt) }));
        const deposits = resData.data.deposits;
        
        if (txs.length === 0 && deposits.length === 0) return ctx.reply('✅ لا توجد عمليات مسجلة للتقرير في هذه الفترة.');
        
        const set = resData.data.settings;
        const workbook = new ExcelJS.Workbook();
        buildInvoiceSheet(workbook.addWorksheet('كشف حساب'), targetName, targetPhone, dateLabel, txs, deposits, currentDbBalance, set);
        const buffer = await workbook.xlsx.writeBuffer();
        
        await ctx.replyWithDocument(
            { source: Buffer.from(buffer), filename: `Account_Statement_${dateLabel.replace(/\//g, '-')}.xlsx` }, 
            { caption: `📊 <b>كشف حساب ${type === 'daily' ? 'يومي' : 'شهري'}</b>\n👤 الجهة: ${targetName}\n📅 التاريخ: ${dateLabel}`, parse_mode: 'HTML' }
        );
    } catch (error) { 
        console.error(error); 
        ctx.reply('❌ حدث خطأ فني أثناء استخراج التقرير.'); 
    }
};

const launchClientBot = (botData) => {
    try {
        if (activeClientBots.has(botData.token)) return;
        const bot = new Telegraf(botData.token);
        
        // 🟢 تمت إضافة المشهد
        const stage = new Scenes.Stage([transferWizard, postTransferWizard, complaintWizard, requestSenderPhoneWizard, supportWizard]);
        bot.use(session());
        bot.use(stage.middleware());

        // 🟢 تمت إضافة زر الدعم
        const mainKeyboard = Markup.keyboard([
            ['💸 تحويل فودافون كاش (مصر)', '📮 تحويل بريد'],
            ['👤 حسابي', '🎧 الدعم الفني وتواصل معنا']
        ]).resize();

        bot.command('web', async (ctx) => {

            const args = ctx.message.text.split(' ');
            if (args.length !== 3) {
                return ctx.reply('🌐 <b>لتفعيل حسابك على الموقع الإلكتروني:</b>\n\nأرسل الأمر متبوعاً باسم مستخدم وكلمة مرور، هكذا:\n\n<code>/web username password</code>\n\nمثال:\n<code>/web ahmed123 12345678</code>', { parse_mode: 'HTML' });
            }

            const username = args[1].toLowerCase().trim();
            const password = args[2].trim();
            const telegramId = ctx.from.id.toString();

            try {
                const response = await axios.post(`${API_BASE}/client/web-credentials`, { telegramId, username, password }, { headers: { 'x-bot-token': botData.token } });
                if (response.data.success) {
                    ctx.reply(`✅ <b>تم تفعيل حسابك على الموقع بنجاح!</b>\n\n👤 اسم المستخدم: <code>${username}</code>\n🔑 كلمة المرور: <code>${password}</code>\n\nيمكنك الآن تسجيل الدخول عبر الرابط الخاص بالموقع.`, { parse_mode: 'HTML' });
                }
            } catch (e) {
                if (e.response && e.response.status === 400) return ctx.reply('⚠️ اسم المستخدم هذا محجوز لشخص آخر، يرجى اختيار اسم مختلف.');
                if (e.response && e.response.status === 404) return ctx.reply('⛔️ حسابك غير مسجل في النظام.');
                ctx.reply('❌ حدث خطأ أثناء تفعيل الحساب.');
            }
        });

        bot.hears('📞 طلب رقم منفذ الحوالة', (ctx) => ctx.scene.enter('REQUEST_SENDER_PHONE_SCENE', { botData, isMainBot: botData.name === 'البوت الرئيسي' }));
        bot.hears('⚠️ شكاوي العمليات', (ctx) => ctx.scene.enter('COMPLAINT_SCENE', { botData, isMainBot: botData.name === 'البوت الرئيسي' }));

        bot.start(async (ctx) => {
            const args = ctx.message.text.split(' ');
            const telegramId = ctx.from.id.toString();

            // Handle deep linking for account linking
            if (args.length > 1 && args[1].startsWith('LINK-CLIENT-')) {
                try {
                    const res = await axios.post(`${API_BASE}/client/link-telegram`, { token: args[1], telegramId }, { headers: { 'x-bot-token': botData.token } });
                    if (res.data.success) {
                        return ctx.reply(`✅ تم ربط حسابك بنجاح! أهلاً بك يا ${res.data.name}.\nاضغط على /start للبدء.`, { parse_mode: 'HTML' });
                    }
                } catch (e) {
                    return ctx.reply('❌ رمز الربط غير صحيح أو منتهي الصلاحية.');
                }
            }

            try {
                const response = await axios.get(`${API_BASE}/client/dashboard?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
                const data = response.data;
                const welcomeMsg = data.settings.welcomeMessage;
                if (!data.isRegistered) {
                    return ctx.reply('⛔️ <b>حسابك غير مسجل في البوت.</b>\n\nالرجاء إنشاء حساب أو تسجيل الدخول من <b>الموقع الإلكتروني</b> الخاص بنا عبر الرابط التالي:\n🔗 https://ahram-pay.com/client/login\n\nثم الانتقال إلى لوحة التحكم الخاصة بك والنقر على زر <b>"ربط حساب التليجرام"</b> للمتابعة.', { parse_mode: 'HTML', disable_web_page_preview: true });
                }

                if (botData.name === 'البوت الرئيسي') {
                    await ctx.reply(`${welcomeMsg}\n\nأهلاً بك مجدداً يا ${data.account.name} 🚀\n💰 الرصيد الحالي: ${data.account.balance.toFixed(2)} دينار`, mainKeyboard);
                } else {
                    await ctx.reply(`🏢 بوت شركة [ ${data.company.name} ] 🚀\n\n${welcomeMsg}\n💰 الرصيد الحالي: ${data.company.balance.toFixed(2)} دينار`, mainKeyboard);
                }
            } catch (e) { console.error(e.message); }
        });

        bot.hears('🏠 القائمة الرئيسية (ابدأ)', async (ctx) => {

            if (ctx.scene) await ctx.scene.leave(); 
            const telegramId = ctx.from.id.toString();
            try {
                const response = await axios.get(`${API_BASE}/client/dashboard?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
                const data = response.data;
                const welcomeMsg = data.settings.welcomeMessage;
                if (!data.isRegistered) return;
                
                if (botData.name === 'البوت الرئيسي') {
                    await ctx.reply(`🔄 تم تحديث البوت!\n\n${welcomeMsg}\n💰 الرصيد الحالي: ${data.account.balance.toFixed(2)} دينار`, mainKeyboard);
                } else {
                    await ctx.reply(`🔄 تم تحديث البوت!\n\n🏢 بوت شركة [ ${data.company.name} ] 🚀\n\n${welcomeMsg}\n💰 الرصيد الحالي: ${data.company.balance.toFixed(2)} دينار`, mainKeyboard);
                }
            } catch (e) { console.error(e.message); }
        });

        bot.hears('⏳ العمليات المعلقة', async (ctx) => {

            const telegramId = ctx.from.id.toString();
            try {
                const response = await axios.get(`${API_BASE}/client/pending-transactions?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
                const pendingTxs = response.data.pendingTxs;

                if (pendingTxs.length === 0) {
                    return ctx.reply('✅ لا توجد لديك أي عمليات معلقة حالياً. جميع طلباتك مكتملة!');
                }

                await ctx.reply(`⏳ <b>لديك ${pendingTxs.length} عملية تحت التنفيذ:</b>`, { parse_mode: 'HTML' });

                for (const tx of pendingTxs) {
                    const statusNames = { 'pending': '⏳ بانتظار المدير', 'processing': '⚙️ قيد المعالجة', 'accepted': '✅ تم القبول (بانتظار التنفيذ)' };
                    const time = new Date(tx.createdAt).toLocaleString('ar-EG');
                    
                    let typeLabel = 'فودافون كاش';
                    if(tx.transferType === 'post_account') typeLabel = 'حساب بريد';
                    if(tx.transferType === 'post_card') typeLabel = 'بطاقة عميل';

                    const msg = `🧾 <b>رقم الطلب:</b> <code>${tx.customId || tx._id}</code>\n` +
                                `نوع التحويل: ${typeLabel}\n` +
                                `📞 <b>الرقم/الحساب:</b> <code>${tx.vodafoneNumber || tx.accountNumber || '---'}</code>\n` +
                                `💵 <b>المبلغ:</b> ${tx.amount} EGP\n` +
                                `🚦 <b>الحالة:</b> ${statusNames[tx.status]}\n` +
                                `📅 <b>الوقت:</b> ${time}`;

                    await ctx.reply(msg, {
                        parse_mode: 'HTML',
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback('🔔 تذكير الإدارة', `remindAdmin_${tx._id}`)]
                        ])
                    });
                }
            } catch (e) { ctx.reply('❌ حدث خطأ أثناء جلب العمليات.'); }
        });

        bot.action(/^remindAdmin_(.+)$/, async (ctx) => {

            const txId = ctx.match[1];
            try {
                await axios.post(`${API_BASE}/client/remind-admin`, { txId }, { headers: { 'x-bot-token': botData.token } });
                await ctx.answerCbQuery('🚀 جاري إرسال تذكير للإدارة...');
                await ctx.reply('✅ تم إرسال التذكير بنجاح لجميع مديري المنظومة.');
            } catch (e) {
                if (e.response && e.response.status === 400) return ctx.answerCbQuery('⚠️ هذه العملية لم تعد معلقة.');
                ctx.answerCbQuery('❌ حدث خطأ أثناء التذكير.');
            }
        });

        bot.hears('👤 حسابي', async (ctx) => {

            const telegramId = ctx.from.id.toString();
            try {
                const response = await axios.get(`${API_BASE}/client/dashboard?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
                const data = response.data;
                const stats = await axios.get(`${API_BASE}/client/account-info?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
                
                let settings = data.settings || {};
                let account = data.account;
                if (!account) return ctx.reply('⛔️ حساب غير مسجل.');
                
                let name = account.name;
                let phone = account.phone;
                let idDisplay = account.telegramId;
                let balance = account.balance;
                let joinDate = new Date(account.createdAt);
                
                let isCompany = !!data.company;
                let tier = isCompany ? (data.company.tier || 1) : (account.tier || 1);
                if (isCompany) balance = data.company.balance;
                
                let currentRate = settings.rateLevel1 || 6.40;
                if (tier === 2) currentRate = settings.rateLevel2 || 6.45;
                if (tier === 3) currentRate = settings.rateLevel3 || 6.50;

                const totalTransferred = stats.data.sumAmount ? stats.data.sumAmount.toFixed(2) : "0.00";
                const availableFunds = balance.toFixed(2);
                const joinDateStr = joinDate.toLocaleDateString('en-GB');

                const cardMessage = 
                    `🪪 <b>بـطـاقـة تـعـريـف عـمـيـل (VIP)</b>\n` +
                    `━━━━━━━━━━━━━━\n` +
                    `👤 <b>الاسم:</b> ${name}\n` +
                    `📱 <b>الهاتف:</b> ${phone}\n` +
                    `🆔 <b>رقم الحساب:</b> <code>${idDisplay}</code>\n` +
                    `📅 <b>تاريخ الانضمام:</b> ${joinDateStr}\n` +
                    `━━━━━━━━━━━━━━\n` +
                    `💱 <b>سعر الصرف المعتمد الأساسي:</b> ${currentRate}\n` + 
                    `💰 <b>الرصيد الحالي:</b> ${availableFunds} دينار\n` +
                    `📤 <b>إجمالي المحول:</b> ${totalTransferred} دينار\n` +
                    `━━━━━━━━━━━━━━\n` +
                    `🎧 <b>للتواصل والدعم:</b> ${settings.supportContact || '@AhramSupport'}\n` +
                    `✨ <i>شكراً لثقتكم في شركة الأهرام الرقمية</i>`;

                await ctx.reply(cardMessage, { parse_mode: 'HTML' });
            } catch (error) { ctx.reply('❌ خطأ في عرض البيانات.'); }
        });

        bot.hears('💸 تحويل فودافون كاش (مصر)', async (ctx) => {

            const telegramId = ctx.from.id.toString();
            try {
                const response = await axios.get(`${API_BASE}/client/dashboard?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
                const account = response.data.account;
                if (!account || account.status !== 'active') return ctx.reply('⛔️ حسابك غير مفعل.');
                ctx.scene.enter('TRANSFER_SCENE', { isMainBot: botData.name === 'البوت الرئيسي', botData });
            } catch (e) { ctx.reply('❌ خطأ في النظام.'); }
        });

        bot.hears('📮 تحويل بريد', async (ctx) => {

            const telegramId = ctx.from.id.toString();
            try {
                const response = await axios.get(`${API_BASE}/client/dashboard?telegramId=${telegramId}`, { headers: { 'x-bot-token': botData.token } });
                const account = response.data.account;
                if (!account || account.status !== 'active') return ctx.reply('⛔️ حسابك غير مفعل.');
                ctx.scene.enter('POST_TRANSFER_SCENE', { isMainBot: botData.name === 'البوت الرئيسي', botData });
            } catch (e) { ctx.reply('❌ خطأ في النظام.'); }
        });

        // 🟢 الاستماع لزر الدعم الفني
        bot.hears('🎧 الدعم الفني وتواصل معنا', (ctx) => {
            const isMainBot = botData.name === 'البوت الرئيسي';
            ctx.scene.enter('SUPPORT_SCENE', { botData, isMainBot });
        });

        bot.hears('📁 التقارير', (ctx) => {
            ctx.reply('📊 <b>استخراج كشف حساب (Excel)</b>\nالرجاء تحديد نوع الكشف المطلوب من القائمة:', {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('📅 كشف اليوم الحالي', 'gen_report_daily')],
                    [Markup.button.callback('📆 كشف الشهر بالكامل', 'gen_report_monthly')]
                ])
            });
        });

        bot.action(/gen_report_(daily|monthly)/, async (ctx) => {
            try {
                await ctx.answerCbQuery('⏳ جاري إعداد التقرير، لحظات...').catch(() => {});
                const type = ctx.match[1];
                await generateClientExcel(ctx, botData, type);
            } catch (error) {
                console.error(error);
            }
        });

        bot.launch().then(() => {
            console.log(`[Client Bot] ${botData.name} is running 🚀`);
            bot.telegram.setMyCommands([
                { command: 'start', description: '🏠 القائمة الرئيسية (تحديث)' },
                { command: 'web', description: '🌐 تفعيل حساب الموقع الإلكتروني' }
            ]).catch(()=>{});
        });
        
        activeClientBots.set(botData.token, bot);
    } catch (error) { console.error(error); }
};

const startAllClientBots = async () => {

    try {
        if (process.env.CLIENT_BOT_TOKEN) launchClientBot({ name: 'البوت الرئيسي', token: process.env.CLIENT_BOT_TOKEN });
        try {
            const response = await axios.get(`${API_BASE}/system/client-bots`);
            if (response.data.success) {
                response.data.bots.forEach(botData => launchClientBot(botData));
            }
        } catch (e) { console.error('Failed to fetch client bots'); }
    } catch (error) { console.error(error); }
        };

module.exports = { startAllClientBots, launchClientBot, buildInvoiceSheet };