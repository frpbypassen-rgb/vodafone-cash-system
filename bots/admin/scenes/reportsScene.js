// bots/admin/scenes/reportsScene.js
const { Scenes, Markup } = require('telegraf');
const ExcelJS = require('exceljs');
const User = require('../../../models/User');
const ClientBot = require('../../../models/ClientBot');
const ExecutorBot = require('../../../models/ExecutorBot');
const Employee = require('../../../models/Employee');
const Transaction = require('../../../models/Transaction');

// 🎨 دالة تنسيق شيت التنفيذ (للبوتات) مع التقفيل المالي الدقيق
const formatExecutorSheet = (sheet, botName, dateLabel, txs, deposits, previousValue, empMap) => {
    sheet.views = [{ rightToLeft: true }];
    const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    const thickBorder = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } };

    // حسابات التقفيل (بالجنيه المصري EGP)
    let totalEGP = 0;
    txs.forEach(t => totalEGP += t.amount);
    let totalDeposits = 0;
    deposits.forEach(d => totalDeposits += d.amount);

    // 🚀 المعادلة المحاسبية الصحيحة لبوتات التنفيذ:
    // المجموع الكلي = القيمة السابقة + المجموع (تنفيذ الفترة) - المبلغ المسدد
    const grandTotal = previousValue + totalEGP - totalDeposits;

    // التنسيق العلوي
    sheet.mergeCells('A1:F2');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `تقرير تقفيل مالي - بوت: ${botName}`;
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002060' } }; 
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    titleCell.border = thickBorder;

    sheet.mergeCells('A3:F3');
    sheet.getCell('A3').value = `الجهة: بوت تنفيذ   |   اسم البوت: ${botName}   |   الفترة: ${dateLabel}`;
    sheet.getCell('A3').font = { bold: true, size: 11 };
    sheet.getCell('A3').alignment = { horizontal: 'center' };
    sheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    sheet.getCell('A3').border = borderStyle;

    sheet.addRow([]);

    // الهيدر المطلوب
    const headerRow = sheet.addRow(['رقم العملية', 'اسم الموظف', 'رقم الهاتف', 'المبلغ (EGP)', 'التاريخ', 'الوقت']);
    headerRow.eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
        c.border = borderStyle;
        c.alignment = { horizontal: 'center' };
    });

    // إضافة العمليات
    txs.forEach(t => {
        const dateObj = new Date(t.updatedAt);
        const row = sheet.addRow([
            t.customId || t._id.toString(),
            empMap[t.operatorId] || 'غير معروف',
            t.vodafoneNumber,
            t.amount,
            dateObj.toLocaleDateString('en-GB').replace(/\//g, '-'),
            dateObj.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        ]);
        row.eachCell(c => { c.border = borderStyle; c.alignment = { horizontal: 'center' }; });
    });

    // 💰 قسم التقفيل المالي المصحح
    sheet.addRow([]);
    const addSummaryRow = (label, value, color = 'FFF2F2F2', isBold = true, fontColor = 'FF000000') => {
        const row = sheet.addRow(['', '', label, value, '', '']);
        row.getCell(3).font = { bold: isBold, size: 11 };
        row.getCell(3).alignment = { horizontal: 'right' };
        row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        row.getCell(3).border = borderStyle;
        row.getCell(4).font = { bold: true, size: 11, color: { argb: fontColor } };
        row.getCell(4).alignment = { horizontal: 'center' };
        row.getCell(4).border = borderStyle;
        return row;
    };

    addSummaryRow('القيمة السابقة (EGP):', previousValue.toFixed(2));
    addSummaryRow('المجموع (تنفيذ الفترة):', totalEGP.toFixed(2), 'FFEAEAEA');
    addSummaryRow('المبلغ المسدد:', totalDeposits.toFixed(2), 'FFD9EAD3');
    
    const finalRow = addSummaryRow('المجموع الكلي:', grandTotal.toFixed(2), 'FFE2EFDA');
    const finalCell = finalRow.getCell(4);
    if (grandTotal > 0) {
        finalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
        finalCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 }; 
    } else {
        finalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
        finalCell.font = { bold: true, color: { argb: 'FF000000' }, size: 12 };
    }
    finalCell.border = thickBorder;

    sheet.columns.forEach(col => col.width = 18);
};

// 🎨 دالة تنسيق شيت التحويل (للعملاء والشركات)
const formatEntitySheet = (sheet, name, phone, dateLabel, txs, deposits, currentBalance) => {
    sheet.views = [{ rightToLeft: true }];
    const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    const thickBorder = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } };

    let totalLYD = 0;
    let totalEGP = 0; // 🚀 متغير الجنيه المصري
    
    txs.forEach(t => {
        totalLYD += t.costLYD;
        totalEGP += t.amount;
    });
    
    let totalDeposits = 0;
    deposits.forEach(d => totalDeposits += d.amount);

    const grandTotal = currentBalance || 0;
    const previousValue = grandTotal - (totalDeposits - totalLYD);

    sheet.mergeCells('A1:G2');
    const titleCell = sheet.getCell('A1');
    titleCell.value = `فـاتـورة كـشـف حـسـاب - شـركـة الأهرام للخدمات الرقمية`;
    titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF002060' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    titleCell.border = thickBorder;

    sheet.mergeCells('A3:G3');
    sheet.getCell('A3').value = `الجهة: ${name}   |   الهاتف: ${phone}   |   الفترة: ${dateLabel}`;
    sheet.getCell('A3').font = { bold: true, size: 11 };
    sheet.getCell('A3').alignment = { horizontal: 'center' };
    sheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    sheet.getCell('A3').border = borderStyle;

    sheet.addRow([]);

    const headerRow = sheet.addRow(['رقم الطلب', 'الموظف', 'رقم المحفظة', 'القيمة (EGP)', 'سعر الصرف', 'التكلفة (LYD)', 'التاريخ']);
    headerRow.eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
        c.border = borderStyle;
        c.alignment = { horizontal: 'center' };
    });

    txs.forEach(t => {
        // 🚀 تعديل قراءة سعر الصرف (مثل 6.40 وليس 0.150)
        const rateDisplay = t.exchangeRate ? t.exchangeRate.toFixed(2) : (t.amount / t.costLYD).toFixed(2);
        
        sheet.addRow([
            t.customId || t._id.toString(),
            t.employeeName || name,
            t.vodafoneNumber,
            t.amount,
            rateDisplay,
            t.costLYD,
            t.updatedAt.toLocaleDateString('en-GB')
        ]).eachCell(c => { c.border = borderStyle; c.alignment = { horizontal: 'center' }; });
    });

    sheet.addRow([]);
    const addSummaryRow = (label, value, color = 'FFF2F2F2', isBold = true, fontColor = 'FF000000') => {
        const row = sheet.addRow(['', '', '', '', label, value, '']);
        row.getCell(5).font = { bold: isBold, size: 11 };
        row.getCell(5).alignment = { horizontal: 'right' };
        row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        row.getCell(5).border = borderStyle;
        row.getCell(6).font = { bold: true, size: 11, color: { argb: fontColor } };
        row.getCell(6).alignment = { horizontal: 'center' };
        row.getCell(6).border = borderStyle;
        return row;
    };

    // 🚀 إضافة ملخص خاص بالجنيه المصري بلون مميز
    addSummaryRow('إجمالي المحول (جنيه مصري):', totalEGP.toFixed(2), 'FFFFE699'); 
    
    addSummaryRow('القيمة السابقة (دينار):', previousValue.toFixed(2));
    addSummaryRow('المجموع (سحوبات الفترة):', totalLYD.toFixed(2), 'FFEAEAEA');
    addSummaryRow('المبلغ المسدد:', totalDeposits.toFixed(2), 'FFD9EAD3');
    
    const finalRow = addSummaryRow('صافي الحساب الكلي:', grandTotal.toFixed(2), 'FFE2EFDA');
    const finalCell = finalRow.getCell(6);
    if (grandTotal < 0) {
        finalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
        finalCell.font = { bold: true, color: { argb: 'FF000000' }, size: 12 };
    } else if (grandTotal > 0) {
        finalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
        finalCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 }; 
    } else {
        finalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    }
    finalCell.border = thickBorder;

    sheet.columns.forEach(col => col.width = 16);
};

const reportsWizard = new Scenes.WizardScene(
    'REPORTS_SCENE',
    // 1️⃣ اختيار نوع التقرير
    async (ctx) => {
        await ctx.reply('📊 <b>مركز التقارير والتقفيل المجمع</b>\n\nاختر نوع التقارير المطلوبة:', {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('💸 تقارير تحويل (عملاء وشركات)', 'rep_transfer')],
                [Markup.button.callback('🛠 تقارير تنفيذ (بوتات)', 'rep_exec')],
                [Markup.button.callback('🔙 خروج', 'cancel')]
            ])
        });
        return ctx.wizard.next();
    },
    // 2️⃣ اختيار الدورية
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel') { await ctx.editMessageText('✅ تم الخروج.'); return ctx.scene.leave(); }
        ctx.wizard.state.type = ctx.callbackQuery.data;
        
        await ctx.editMessageText('📅 اختر دورية التقرير:', {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('🗓 يوم محدد', 'period_day')],
                [Markup.button.callback('📅 شهر محدد', 'period_month')],
                [Markup.button.callback('🔙 رجوع', 'back_to_type')]
            ])
        });
        return ctx.wizard.next();
    },
    // 3️⃣ طلب التاريخ
    async (ctx) => {
        const action = ctx.callbackQuery?.data;
        if (action === 'back_to_type') { ctx.wizard.selectStep(0); return ctx.wizard.steps[0](ctx); }
        
        ctx.wizard.state.period = action;
        const prompt = action === 'period_day' ? '📝 أرسل التاريخ (يوم/شهر/سنة):' : '📝 أرسل الشهر (شهر/سنة):';

        await ctx.editMessageText(prompt, { 
            parse_mode: 'HTML', 
            ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'back_to_period')]]) 
        });
        return ctx.wizard.next();
    },
    // 4️⃣ التوليد
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'back_to_period') { ctx.wizard.selectStep(1); return ctx.wizard.steps[1](ctx); }

        const input = ctx.message?.text?.trim();
        if (!input) return;

        await ctx.reply('⏳ جاري حساب التقفيل المالي المجمع بدقة...');

        try {
            let start, end, dateLabel;
            const parts = input.split('/');
            if (ctx.wizard.state.period === 'period_day') {
                start = new Date(parts[2], parts[1] - 1, parts[0], 0, 0, 0);
                end = new Date(parts[2], parts[1] - 1, parts[0], 23, 59, 59);
                dateLabel = input;
            } else {
                start = new Date(parts[1], parts[0] - 1, 1);
                end = new Date(parts[1], parts[0], 0, 23, 59, 59);
                dateLabel = input;
            }

            const workbook = new ExcelJS.Workbook();
            let hasData = false;

            if (ctx.wizard.state.type === 'rep_transfer') {
                const users = await User.find({});
                const companies = await ClientBot.find({});
                for (const u of users) {
                    const txs = await Transaction.find({ userId: u.telegramId, clientBotId: null, status: 'completed', updatedAt: { $gte: start, $lte: end } });
                    const deps = await Transaction.find({ userId: u.telegramId, clientBotId: null, status: 'deposit', updatedAt: { $gte: start, $lte: end } });
                    if (txs.length > 0 || deps.length > 0) { hasData = true; formatEntitySheet(workbook.addWorksheet(u.name.substring(0, 30)), u.name, u.phone, dateLabel, txs, deps, u.balance); }
                }
                for (const c of companies) {
                    const txs = await Transaction.find({ clientBotId: c._id, status: 'completed', updatedAt: { $gte: start, $lte: end } });
                    const deps = await Transaction.find({ clientBotId: c._id, status: 'deposit', updatedAt: { $gte: start, $lte: end } });
                    if (txs.length > 0 || deps.length > 0) { hasData = true; formatEntitySheet(workbook.addWorksheet(`🏢 ${c.name}`.substring(0, 30)), c.name, c.phone, dateLabel, txs, deps, c.balance); }
                }
            } else {
                const execBots = await ExecutorBot.find({});
                const allEmps = await Employee.find({});
                const empMap = {}; allEmps.forEach(e => empMap[e.telegramId] = e.name);
                
                for (const b of execBots) {
                    const txs = await Transaction.find({ executorBotId: b._id, status: 'completed', updatedAt: { $gte: start, $lte: end } });
                    const deps = await Transaction.find({ executorBotId: b._id, status: 'deposit', updatedAt: { $gte: start, $lte: end } });
                    
                    if (txs.length > 0 || deps.length > 0) { 
                        hasData = true; 
                        
                        // 🚀 حساب القيمة السابقة تاريخياً
                        const pastTxs = await Transaction.aggregate([
                            { $match: { executorBotId: b._id, status: 'completed', updatedAt: { $lt: start } } },
                            { $group: { _id: null, sum: { $sum: "$amount" } } }
                        ]);
                        const pastDeps = await Transaction.aggregate([
                            { $match: { executorBotId: b._id, status: 'deposit', updatedAt: { $lt: start } } },
                            { $group: { _id: null, sum: { $sum: "$amount" } } }
                        ]);

                        const totalPastEGP = pastTxs.length > 0 ? pastTxs[0].sum : 0;
                        const totalPastDeposits = pastDeps.length > 0 ? pastDeps[0].sum : 0;
                        
                        // القيمة السابقة = كل ما نفذه البوت قديماً - كل ما سددته الإدارة قديماً
                        const previousValue = totalPastEGP - totalPastDeposits;

                        formatExecutorSheet(workbook.addWorksheet(b.name.substring(0, 30)), b.name, dateLabel, txs, deps, previousValue, empMap); 
                    }
                }
            }

            if (!hasData) return ctx.reply('❌ لا توجد بيانات للفترة المحددة.');
            const buffer = await workbook.xlsx.writeBuffer();
            const fileName = ctx.wizard.state.type === 'rep_transfer' ? 'Financial_Closing' : 'Execution_Report';
            await ctx.replyWithDocument({ source: buffer, filename: `${fileName}_${dateLabel.replace(/\//g, '-')}.xlsx` });
        } catch (err) { await ctx.reply('❌ خطأ في التاريخ أو المعالجة.'); }
        return ctx.scene.leave();
    }
);

module.exports = reportsWizard;