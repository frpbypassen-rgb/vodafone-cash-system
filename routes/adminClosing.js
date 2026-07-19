// routes/adminClosing.js
const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const Transaction = require('../models/Transaction');
const DailyReport = require('../models/DailyReport');

// 🟢 صفحة التقفيل المركزي
router.get('/', async (req, res) => {
    try {
        const reports = await DailyReport.find({}).sort({ createdAt: -1 });
        res.render('closing', { reports, adminName: req.session.adminName });
    } catch (e) {
        res.status(500).send('خطأ في تحميل صفحة التقفيل');
    }
});

// 🟢 توليد تقرير التقفيل وحفظه في قاعدة البيانات
router.post('/generate', async (req, res) => {
    try {
        const targetDate = req.body.date; // YYYY-MM-DD
        if (!targetDate) return res.redirect('/closing?error=nodate');

        const start = new Date(`${targetDate}T00:00:00.000Z`);
        const end = new Date(`${targetDate}T23:59:59.999Z`);

        // جلب جميع العمليات المكتملة والإيداعات والخصومات في هذا اليوم
        const txs = await Transaction.find({
            updatedAt: { $gte: start, $lte: end },
            status: { $in: ['completed', 'deposit', 'deduction'] }
        }).sort({ updatedAt: 1 });

        if (txs.length === 0) return res.redirect('/closing?error=notxs');

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(`تقفيل ${targetDate}`);
        sheet.views = [{ rightToLeft: true }];

        // تنسيقات الخلايا
        const headerStyle = {
            font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 14 },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF001A4D' } },
            alignment: { vertical: 'middle', horizontal: 'center' },
            border: { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} }
        };

        // ترويسة الجدول
        sheet.columns = [
            { header: 'رقم العملية', key: 'id', width: 20 },
            { header: 'التوقيت', key: 'time', width: 20 },
            { header: 'المصدر (العميل/الشركة)', key: 'source', width: 25 },
            { header: 'جهة التنفيذ', key: 'executor', width: 25 },
            { header: 'الرقم/الحساب', key: 'phone', width: 20 },
            { header: 'المبلغ (EGP)', key: 'egp', width: 18 },
            { header: 'التكلفة (LYD)', key: 'lyd', width: 18 },
            { header: 'نوع الحركة', key: 'status', width: 15 },
        ];

        sheet.getRow(1).eachCell(cell => {
            cell.font = headerStyle.font; cell.fill = headerStyle.fill;
            cell.alignment = headerStyle.alignment; cell.border = headerStyle.border;
        });
        sheet.getRow(1).height = 30;

        let totalEgpIn = 0, totalEgpOut = 0, totalLyd = 0;

        txs.forEach(tx => {
            let statusAr = '';
            if (tx.status === 'completed') { statusAr = 'تحويل منفذ'; totalEgpOut += tx.amount; totalLyd += (tx.costLYD || 0); }
            else if (tx.status === 'deposit') { statusAr = 'إيداع/سداد'; totalEgpIn += tx.amount; }
            else if (tx.status === 'deduction') { statusAr = 'خصم رصيد'; totalEgpOut += tx.amount; }

            const row = sheet.addRow({
                id: tx.customId || tx._id.toString().slice(-6),
                time: tx.updatedAt.toLocaleTimeString('en-GB'),
                source: tx.companyName || tx.employeeName || 'غير مسجل',
                executor: tx.executorName || tx.executorBotName || 'غير مسجل',
                phone: tx.vodafoneNumber || '---',
                egp: tx.amount,
                lyd: tx.costLYD || 0,
                status: statusAr
            });

            row.eachCell(cell => {
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.border = headerStyle.border;
            });
        });

        // إضافة ملخص نهائي أسفل الشيت
        sheet.addRow([]);
        const summaryRow = sheet.addRow(['', '', '', 'الإجماليات النهائية:', '', totalEgpIn - totalEgpOut, totalLyd, '']);
        summaryRow.font = { bold: true, size: 15, color: { argb: 'FFDC3545' } };
        summaryRow.alignment = { vertical: 'middle', horizontal: 'center' };

        // تحويل الإكسيل إلى Buffer لحفظه
        const buffer = await workbook.xlsx.writeBuffer();

        // حفظ التقرير كـ Snapshot في قاعدة البيانات
        await DailyReport.create({
            dateString: targetDate,
            reportType: 'التقفيل الشامل للمنظومة',
            fileName: `Ahram_Master_Close_${targetDate}.xlsx`,
            fileData: buffer,
            generatedBy: req.session.adminName || 'مدير النظام'
        });

        res.redirect('/closing?success=true');
    } catch (error) {
        console.error(error);
        res.redirect('/closing?error=failed');
    }
});

// 🟢 تحميل التقرير المحفوظ سابقاً
router.get('/download/:id', async (req, res) => {
    try {
        const report = await DailyReport.findById(req.params.id);
        if (!report) return res.status(404).send('التقرير غير موجود');

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
        res.send(report.fileData);
    } catch (e) {
        res.status(500).send('خطأ في التحميل');
    }
});

// 🟢 حذف تقرير (اختياري)
router.post('/delete/:id', async (req, res) => {
    try {
        await DailyReport.findByIdAndDelete(req.params.id);
        res.redirect('/closing');
    } catch (e) { res.redirect('/closing'); }
});

module.exports = router;