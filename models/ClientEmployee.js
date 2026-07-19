// models/ClientEmployee.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const clientEmployeeSchema = new mongoose.Schema({
    telegramId: { type: String, required: true },
    clientBotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientBot', required: true },
    name: { type: String, required: true },
    phone: { type: String },
    status: { type: String, default: 'active' }, // active, banned
    
    // بيانات موقع العملاء
    webUsername: { type: String, sparse: true }, 
    webPassword: { type: String },
    otpCode: { type: String },
    otpExpires: { type: Date }
}, { timestamps: true });

// 🔐 تشفير كلمة المرور قبل الحفظ
clientEmployeeSchema.pre('save', async function() {
    if (!this.isModified('webPassword') || !this.webPassword) return;
    if (this.webPassword.startsWith('$2')) return; // مشفرة مسبقاً
    this.webPassword = await bcrypt.hash(this.webPassword, 12);
});

module.exports = mongoose.model('ClientEmployee', clientEmployeeSchema);