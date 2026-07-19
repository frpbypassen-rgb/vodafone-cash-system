const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const subAccountSchema = new mongoose.Schema({
    masterType: { type: String, enum: ['user', 'company'], required: true },
    masterId: { type: mongoose.Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    phone: { type: String },
    webUsername: { type: String, required: true, unique: true },
    webPassword: { type: String, required: true },
    refreshToken: { type: String }, // 🟢 مخصص لتطبيق الموبايل
    customMargin: { type: Number, default: 0 }, 
    cardMargin: { type: Number, default: 0 }, 
    balance: { type: Number, default: 0 }, 
    creditLimit: { type: Number, default: 0 }, 
    status: { type: String, default: 'active' } 
}, { timestamps: true });

subAccountSchema.pre('save', async function() {
    if (!this.isModified('webPassword') || !this.webPassword) return;
    if (this.webPassword.startsWith('$2')) return;
    this.webPassword = await bcrypt.hash(this.webPassword, 12);
});

module.exports = mongoose.model('SubAccount', subAccountSchema);