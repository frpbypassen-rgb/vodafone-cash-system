const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const registrationRequestSchema = new mongoose.Schema({
    // نوع الحساب: direct (عميل مباشر)، company (شركة)، new (عميل جديد)، agent (وكيل منطقة)
    accountType: { 
        type: String, 
        required: true, 
        enum: ['direct', 'company', 'new', 'agent'] 
    },

    // رقم الطلب المرجعي
    refCode: { type: String, unique: true },

    // ======= بيانات العميل المباشر / الجديد / الوكيل =======
    fullName: { type: String },
    phone: { type: String },
    username: { type: String },
    nationality: { type: String, enum: ['libyan', 'egyptian'] },
    city: { type: String },
    storeName: { type: String },
    address: { type: String },
    password: { type: String },  // مشفّر

    // ======= بيانات حساب الشركة / الوكيل =======
    companyName: { type: String },
    companyContact: { type: String }, // اسم مدير الشركة
    companyPhone: { type: String },
    companyEmail: { type: String },
    agentCode: { type: String, sparse: true }, // رقم مخصص للوكيل (8 أرقام)

    // حالة الطلب
    status: { 
        type: String, 
        default: 'pending', 
        enum: ['pending', 'approved', 'rejected'] 
    },

    // ملاحظات الإدارة
    adminNotes: { type: String },

    // الأدمن الذي راجع الطلب
    reviewedBy: { type: String },
    reviewedAt: { type: Date },

    // تتبع مصدر الطلب
    ipAddress: { type: String },
    userAgent: { type: String }
}, { timestamps: true });

// تشفير كلمة المرور قبل الحفظ
registrationRequestSchema.pre('save', async function() {
    if (!this.isModified('password') || !this.password) return;
    if (this.password.startsWith('$2')) return;
    this.password = await bcrypt.hash(this.password, 12);
});

// توليد رقم الطلب المرجعي
registrationRequestSchema.pre('save', function() {
    if (!this.refCode) {
        const yy = new Date().getFullYear().toString().slice(-2);
        const mm = (new Date().getMonth() + 1).toString().padStart(2, '0');
        const rand = Math.floor(1000 + Math.random() * 9000);
        this.refCode = `REG-${yy}${mm}-${rand}`;
    }
});

// فهارس
registrationRequestSchema.index({ status: 1, createdAt: -1 });
registrationRequestSchema.index({ phone: 1 });
// refCode لديه unique بالفعل في الشيما — لا حاجة لتكرار الفهرس

module.exports = mongoose.model('RegistrationRequest', registrationRequestSchema);
