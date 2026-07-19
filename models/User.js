const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    telegramId: { type: String, required: true, unique: true },
    name: { type: String },
    phone: { type: String },
    balance: { type: Number, default: 0 },
    tier: { type: Number, default: 3 },
    status: { type: String, default: 'active' }, 
    creditLimit: { type: Number, default: 0 },
    webUsername: { type: String, sparse: true },
    webPassword: { type: String },
    role: { type: String, default: 'user' }, // user | accountant
    telegramLinkToken: { type: String },
    telegramLinkExpires: { type: Date },
    refreshToken: { type: String }, // 🟢 مخصص لتطبيق الموبايل
    otpCode: { type: String },
    otpExpires: { type: Date },
    lastOtpDate: { type: String }
}, { timestamps: true });

userSchema.pre('save', async function() {
    if (!this.isModified('webPassword') || !this.webPassword) return;
    if (this.webPassword.startsWith('$2')) return;
    this.webPassword = await bcrypt.hash(this.webPassword, 12);
});

// ====================================================
// 📈 فهارس لتحسين أداء الاستعلامات المتكررة
// ====================================================
userSchema.index({ phone: 1 });                        // بحث بالهاتف
// telegramId لديه unique بالفعل في الشيما
// webUsername لديه sparse بالفعل في الشيما — لا حاجة لتكرار الفهرس
userSchema.index({ status: 1 });                        // فلتر الحسابات النشيطة

module.exports = mongoose.model('User', userSchema);