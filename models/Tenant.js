// models/Tenant.js
// ===============================================
// 🏢 نموذج المستأجر — Multi-Tenant Support
// ===============================================
const mongoose = require('mongoose');

const tenantSchema = new mongoose.Schema({
    // معلومات أساسية
    name: { type: String, required: true },         // "Al-Ahram Pay", "Zone Tech"
    slug: { type: String, required: true, unique: true }, // "ahram", "zone"
    status: {
        type: String,
        default: 'active',
        enum: ['active', 'suspended', 'trial', 'inactive']
    },

    // التخصيص البصري
    branding: {
        logo: { type: String },
        primaryColor: { type: String, default: '#1a73e8' },
        secondaryColor: { type: String, default: '#0d47a1' },
        displayName: { type: String }
    },

    // إعدادات الأسعار
    rates: {
        level1: { type: Number, default: 6.40 },
        level2: { type: Number, default: 6.45 },
        level3: { type: Number, default: 6.50 }
    },

    // الميزات المتاحة
    features: {
        enableMobileAPI: { type: Boolean, default: true },
        enableTelegramBots: { type: Boolean, default: true },
        enableExternalAPI: { type: Boolean, default: false },
        enableSubAccounts: { type: Boolean, default: false },
        enableWebPortal: { type: Boolean, default: true }
    },

    // حدود الاستخدام
    limits: {
        maxTransferAmount: { type: Number, default: 100000 },   // EGP
        dailyTransferLimit: { type: Number, default: 500000 },  // EGP
        maxUsers: { type: Number, default: 100 },
        maxExecutors: { type: Number, default: 20 },
        maxConcurrentTransfers: { type: Number, default: 50 }
    },

    // معلومات الاتصال
    contact: {
        email: { type: String },
        phone: { type: String },
        address: { type: String }
    },

    // معلومات الاشتراك
    subscription: {
        plan: { type: String, default: 'standard', enum: ['trial', 'standard', 'premium', 'enterprise'] },
        startDate: { type: Date },
        endDate: { type: Date },
        commissionRate: { type: Number, default: 0 } // نسبة العمولة للمنصة
    },

    // API Keys
    apiKey: { type: String, unique: true, sparse: true },
    apiSecret: { type: String },

    // المنشئ
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' }

}, { timestamps: true });

// فهارس
tenantSchema.index({ slug: 1 }, { unique: true });
tenantSchema.index({ status: 1 });
tenantSchema.index({ apiKey: 1 }, { sparse: true });

module.exports = mongoose.model('Tenant', tenantSchema);
