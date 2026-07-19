// models/AuditLog.js
// سجل التدقيق الشامل — يسجل كل العمليات الحساسة في النظام المالي
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    // ── نوع العملية ──────────────────────────────────────────
    action: {
        type: String,
        required: true,
        enum: [
            'LOGIN_SUCCESS',
            'LOGIN_FAILED',
            'LOGOUT',
            'TOKEN_REFRESH',
            'TRANSFER_CREATED',
            'TRANSFER_CANCELLED',
            'TRANSFER_COMPLETED',
            'DEPOSIT_CREATED',
            'DEDUCTION_CREATED',
            'BALANCE_ADJUSTED',
            'TASK_ACCEPTED',
            'ADMIN_ACTION',
            'SETTINGS_CHANGED',
            'USER_CREATED',
            'USER_UPDATED',
            'USER_BANNED',
            // 🆕 أحداث أمنية جديدة
            'ROLE_CHANGED',
            'ACCOUNT_LOCKED',
            'ACCOUNT_UNLOCKED',
            'PASSWORD_CHANGED',
            'API_KEY_ROTATED',
            'SYSTEM_STARTUP',
            'SYSTEM_SHUTDOWN',
        ],
        index: true
    },

    // ── درجة الخطورة ─────────────────────────────────────────
    severity: {
        type: String,
        enum: ['info', 'warning', 'critical'],
        default: 'info'
    },

    // ── من قام بالعملية ──────────────────────────────────────
    performedBy: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'performedByModel'
    },
    performedByModel: {
        type: String,
        enum: ['Employee', 'ClientEmployee', 'User', 'Admin', 'System']
    },
    performedByName: { type: String }, // نسخة من الاسم لحماية السجل

    // ── الجهة المستهدفة بالعملية ─────────────────────────────
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'targetModel'
    },
    targetModel: { type: String },

    // ── بيانات الطلب ─────────────────────────────────────────
    ipAddress: { type: String },
    userAgent: { type: String },
    endpoint: { type: String }, // المسار الذي تم استدعاؤه

    // 🆕 بصمة الجهاز ومعرف الجلسة
    deviceFingerprint: { type: String },
    sessionId: { type: String },

    // ── البيانات القديمة والجديدة (للتدقيق التفصيلي) ──────────
    oldData: { type: mongoose.Schema.Types.Mixed },
    newData: { type: mongoose.Schema.Types.Mixed },

    // ── بيانات إضافية متعلقة بالعملية ───────────────────────
    metadata: { type: mongoose.Schema.Types.Mixed },

    // ── نتيجة العملية ────────────────────────────────────────
    success: { type: Boolean, default: true },
    errorCode: { type: String }, // في حالة الفشل

}, {
    timestamps: true,
    // لا يُحذف ولا يُعدَّل هذا السجل — للحماية القانونية والتشغيلية
    versionKey: false
});

// فهارس لتسريع الاستعلامات الشائعة
auditLogSchema.index({ performedBy: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ ipAddress: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 }); // للتقارير اليومية

module.exports = mongoose.model('AuditLog', auditLogSchema);
