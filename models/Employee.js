const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const employeeSchema = new mongoose.Schema({
    telegramId: { type: String }, // غير إلزامي لتسجيل الويب
    name: { type: String, required: true },
    phone: { type: String },
    role: { type: String, enum: ['operator', 'manager', 'accountant', 'api_executor'], default: 'operator' },
    status: { type: String, enum: ['pending', 'active', 'suspended', 'banned'], default: 'pending' },
    botId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExecutorBot', required: true },
    adminMessages: [{ telegramId: String, messageId: Number }],
    webUsername: { type: String },
    webPassword: { type: String },
    telegramLinkToken: { type: String },
    telegramLinkExpires: { type: Date },
    refreshToken: { type: String }, // 🟢 مخصص لتطبيق الموبايل
    otpCode: { type: String },
    otpExpires: { type: Date },
    lastOtpDate: { type: String }
}, { timestamps: true });

employeeSchema.index({ telegramId: 1 }, { unique: true, sparse: true });
employeeSchema.index({ webUsername: 1 }, { unique: true, sparse: true });

employeeSchema.pre('save', async function() {
    if (!this.isModified('webPassword') || !this.webPassword) return;
    if (this.webPassword.startsWith('$2')) return;
    this.webPassword = await bcrypt.hash(this.webPassword, 12);
});

module.exports = mongoose.model('Employee', employeeSchema);