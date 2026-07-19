// models/DailyReport.js
const mongoose = require('mongoose');

const dailyReportSchema = new mongoose.Schema({
    dateString: { type: String, required: true }, // تاريخ التقفيل (مثال: 2026-05-12)
    reportType: { type: String, required: true, default: 'Master' }, // نوع التقرير
    fileName: { type: String, required: true }, // اسم الملف
    fileData: { type: Buffer, required: true }, // بيانات ملف الـ Excel الفعلي
    generatedBy: { type: String, required: true }, // اسم الإداري الذي قام بالتقفيل
    createdAt: { type: Date, default: Date.now } // وقت إنشاء التقفيل الفعلي
});

module.exports = mongoose.model('DailyReport', dailyReportSchema);