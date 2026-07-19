// utils/masterReports.js
const ExcelJS = require('exceljs');
const User = require('../models/User');
const ClientBot = require('../models/ClientBot');
const ExecutorBot = require('../models/ExecutorBot');
const Transaction = require('../models/Transaction');

/**
 * 📊 توليد تقرير العملاء والشركات الشامل (شيت لكل عميل/شركة)
 */
const generateMasterClientReport = async () => {
    const workbook = new ExcelJS.Workbook();
    const now = new Date();
    // تقفيل اليوم يبدأ من الساعة 00:00
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    
    // جلب العملاء والشركات النشطة
    const users = await User.find({ status: 'active' });
    const companies = await ClientBot.find({ status: 'active' });

    // 1. حسابات العملاء الأفراد
    for (const user of users) {
        const txs = await Transaction.find({ userId: user.telegramId, clientBotId: null, status: 'completed', updatedAt: { $gte: startOfDay } });
        const deposits = await Transaction.find({ userId: user.telegramId, clientBotId: null, status: 'deposit', updatedAt: { $gte: startOfDay } });
        
        if (txs.length > 0 || deposits.length > 0) {
            let sheetName = user.name ? user.name.replace(/[\\/*?:[\]]/g, '').substring(0, 30) : 'عميل';
            const sheet = workbook.addWorksheet(sheetName);
            setupClientSheet(sheet, user, txs, deposits);
        }
    }

    // 2. حسابات الشركات
    for (const comp of companies) {
        const txs = await Transaction.find({ clientBotId: comp._id, status: 'completed', updatedAt: { $gte: startOfDay } });
        const deposits = await Transaction.find({ clientBotId: comp._id, status: 'deposit', updatedAt: { $gte: startOfDay } });
        
        if (txs.length > 0 || deposits.length > 0) {
            let sheetName = comp.name ? comp.name.replace(/[\\/*?:[\]]/g, '').substring(0, 30) : 'شركة';
            const sheet = workbook.addWorksheet(sheetName);
            setupClientSheet(sheet, comp, txs, deposits);
        }
    }

    // في حال عدم وجود أي عمليات في النظام اليوم
    if (workbook.worksheets.length === 0) {
        workbook.addWorksheet('لا توجد عمليات اليوم');
    }

    return await workbook.xlsx.writeBuffer();
};

/**
 * 🤖 توليد تقرير المنفذين الشامل (شيت لكل بوت تنفيذ)
 */
const generateMasterExecutorReport = async () => {
    const workbook = new ExcelJS.Workbook();
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    
    const executorBots = await ExecutorBot.find({ status: 'active' });

    for (const execBot of executorBots) {
        const txs = await Transaction.find({ executorBotId: execBot._id, status: 'completed', updatedAt: { $gte: startOfDay } });
        const deposits = await Transaction.find({ executorBotId: execBot._id, status: 'deposit', updatedAt: { $gte: startOfDay } });

        let sheetName = execBot.name ? execBot.name.replace(/[\\/*?:[\]]/g, '').substring(0, 30) : 'بوت تنفيذ';
        const sheet = workbook.addWorksheet(sheetName);
        setupExecutorSheet(sheet, execBot, txs, deposits);
    }

    if (workbook.worksheets.length === 0) {
        workbook.addWorksheet('لا توجد عمليات اليوم');
    }

    return await workbook.xlsx.writeBuffer();
};

// ==========================================
// --- دوال تنسيق الشيتات (Full Detailed Layout) ---
// ==========================================

function setupClientSheet(sheet, entity, txs, deposits) {
    sheet.views = [{ rightToLeft: true }];
    sheet.columns = [
        { header: 'رقم العملية', key: 'id', width: 22 },
        { header: 'المحفظة (مصر)', key: 'phone', width: 16 },
        { header: 'القيمة (EGP)', key: 'amount', width: 15 },
        { header: 'سعر الصرف', key: 'rate', width: 12 }, // 🚀 عمود سعر الصرف اللحظي
        { header: 'التكلفة (LYD)', key: 'cost', width: 15 },
        { header: 'التاريخ والوقت', key: 'date', width: 22 }
    ];

    // تلوين العناوين
    sheet.getRow(1).eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } }; // أحمر
        c.alignment = { horizontal: 'center' };
    });

    // إدراج صفوف العمليات
    txs.forEach(t => {
        sheet.addRow([
            t.customId || t._id.toString(),
            t.vodafoneNumber,
            t.amount,
            t.exchangeRate || (t.costLYD / t.amount).toFixed(3), // الأولوية للسعر المحفوظ بالعملية
            t.costLYD,
            t.updatedAt.toLocaleString('en-GB')
        ]).eachCell(c => c.alignment = { horizontal: 'center' });
    });

    // الحسابات الختامية
    let totalLYD = txs.reduce((sum, t) => sum + t.costLYD, 0);
    let totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);
    let currentBalance = entity.balance || 0;
    
    // الرصيد السابق = الرصيد الحالي + المسحوب - المودع
    let previousValue = currentBalance + totalLYD - totalDeposits;

    sheet.addRow([]); // سطر فاصل

    const addSumRow = (label, value, color = 'FFFFFFFF') => {
        const row = sheet.addRow(['', '', '', label, value, '']);
        row.getCell(4).font = { bold: true };
        row.getCell(5).font = { bold: true };
        row.getCell(5).alignment = { horizontal: 'center' };
        row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        return row;
    };

    addSumRow('القيمة السابقة (دينار):', previousValue.toFixed(2));
    addSumRow('المجموع (سحوبات اليوم):', totalLYD.toFixed(2));
    addSumRow('القيمة المسددة (إيداعات):', totalDeposits.toFixed(2));
    // تمييز رصيد الحساب الحالي باللون الأصفر
    addSumRow('رصيد الحساب الحالي:', currentBalance.toFixed(2), 'FFFFFF00');
}

function setupExecutorSheet(sheet, bot, txs, deposits) {
    sheet.views = [{ rightToLeft: true }];
    sheet.columns = [
        { header: 'رقم الطلب', key: 'id', width: 22 },
        { header: 'المحفظة', key: 'phone', width: 16 },
        { header: 'المبلغ (EGP)', key: 'amount', width: 15 },
        { header: 'الموظف', key: 'op', width: 18 },
        { header: 'الوقت', key: 'time', width: 20 }
    ];

    // تلوين العناوين
    sheet.getRow(1).eachCell(c => {
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0070C0' } }; // أزرق
        c.alignment = { horizontal: 'center' };
    });

    // إدراج صفوف العمليات
    txs.forEach(t => {
        sheet.addRow([
            t.customId || t._id.toString(),
            t.vodafoneNumber,
            t.amount,
            t.operatorId || 'غير محدد',
            t.updatedAt.toLocaleTimeString('en-GB')
        ]).eachCell(c => c.alignment = { horizontal: 'center' });
    });

    // الحسابات الختامية
    let totalEGP = txs.reduce((sum, t) => sum + t.amount, 0);
    let addedCustody = deposits.reduce((sum, d) => sum + d.amount, 0);
    let currentCustody = bot.balance || 0;
    
    // العهدة السابقة = العهدة الحالية + المنصرف - المودع
    let previousBalance = currentCustody + totalEGP - addedCustody;

    sheet.addRow([]); // سطر فاصل

    const addSumRow = (label, value, color = 'FFFFFFFF') => {
        const row = sheet.addRow(['', '', label, value, '']);
        row.getCell(3).font = { bold: true };
        row.getCell(4).font = { bold: true };
        row.getCell(4).alignment = { horizontal: 'center' };
        row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        return row;
    };

    addSumRow('القيمة السابقة (العهدة):', previousBalance.toFixed(2));
    addSumRow('المجموع اليومي (EGP):', totalEGP.toFixed(2));
    addSumRow('القيمة المسددة (إيداع عهدة):', addedCustody.toFixed(2));
    // تمييز إجمالي مبلغ العهدة باللون الأخضر
    addSumRow('إجمالي مبلغ العهدة الحالي:', currentCustody.toFixed(2), 'FF92D050');
}

module.exports = { generateMasterClientReport, generateMasterExecutorReport };