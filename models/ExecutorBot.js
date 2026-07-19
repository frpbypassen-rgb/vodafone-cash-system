const mongoose = require('mongoose');

const executorBotSchema = new mongoose.Schema({
    name: { type: String, required: true },
    token: { type: String }, // توكن التيليجرام للبوتات البشرية
    status: { type: String, default: 'active' }, // active, inactive, paused
    balance: { type: Number, default: 0 }, // العهدة المتاحة
    
    // نظام الوكلاء (البشريين)
    isManagerBot: { type: Boolean, default: false }, 
    parentBotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExecutorBot', default: null },

    // 🚀 الحقول الجديدة الخاصة بالربط الآلي (API Integration)
    isApiBot: { type: Boolean, default: false }, // هل هذا بوت آلي يربط بـ API شركة أخرى؟
    apiUrl: { type: String, default: '' }, // رابط الـ API للشركة
    apiToken: { type: String, default: '' } // مفتاح المصادقة (API Key/Secret) للشركة
    
}, { timestamps: true });

module.exports = mongoose.model('ExecutorBot', executorBotSchema);