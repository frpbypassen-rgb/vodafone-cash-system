// models/Transaction.js
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    // 🔑 المعرفات الأساسية لمنع التكرار
    customId: { type: String, unique: true, required: true },
    idempotencyKey: { type: String, unique: true, sparse: true }, 

    // 👤 بيانات الجهة الطالبة 
    userId: { type: String }, // تليجرام ID للعميل الفردي أو الموظف
    clientBotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientBot' }, 
    subAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubAccount' }, 
    companyName: { type: String },
    employeeName: { type: String },
    subAccountName: { type: String },
    isSubAccountTx: { type: Boolean, default: false },

    // 💸 بيانات التحويل
    transferType: { type: String, default: 'vodafone' }, // vodafone, post_account, post_card
    vodafoneNumber: { type: String },
    accountNumber: { type: String },
    accountName: { type: String }, 
    amount: { type: Number, required: true, min: 0 }, // ✅ تحقق: لا قيم سالبة

    // 📊 البيانات المالية والمحاسبية 
    costLYD: { type: Number, default: 0, min: 0 }, // ✅ تحقق: لا قيم سالبة
    subAccountCostLYD: { type: Number, default: 0 },
    commission: { type: Number, default: 0 },
    masterProfit: { type: Number, default: 0 }, 
    exchangeRate: { type: Number, default: 0 }, 
    subClientRate: { type: Number, default: 0 }, 

    // ⚙️ حالة الطلب والتنفيذ
    status: { 
        type: String, 
        enum: [
            'pending',           
            'processing',        
            'accepted',          
            'completed',         
            'rejected',          
            'deposit_pending',   
            'deposit',           
            'deduction',         
            'cancelled_by_admin' 
        ], 
        default: 'pending' 
    },

    // 👨‍💻 بيانات الموظف المنفذ
    executorBotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExecutorBot' },
    managerBotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExecutorBot' },
    executorBotName: { type: String },
    operatorId: { type: String }, 
    executorName: { type: String, default: '---' },
    executorSenderPhone: { type: String },

    // 🤖 متغيرات نظام الربط الآلي (API)
    isApiReview: { type: Boolean }, 
    apiResultData: { type: Object }, 
    originalApiBotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExecutorBot' }, 

    // 📝 الملاحظات والتنبيهات
    notes: { type: String },
    adminNotes: { type: String },
    complaintText: { type: String },
    emergencyAlert: { type: String }, 
    executorWebAlert: { type: Object }, 

    // 🖼️ الصور وإثباتات التنفيذ
    proofImage: { type: String }, 
    proofImages: [{ type: String }], 
    idCardImage: { type: String }, 
    resolutionImage: { type: String },

    // 📡 تخزين رسائل التليجرام
    clientMessageId: { type: Number }, 
    broadcastMessages: [{ telegramId: String, messageId: Number }],
    adminMessages: [{ telegramId: String, messageId: Number }],
    phoneReqAdminMessages: [{ telegramId: String, messageId: Number }] 

}, { 
    timestamps: true 
});

// ====================================================
// 📈 فهارس مركبة لتحسين الأداء — حرجة للاستعلامات المتكررة
// ====================================================
transactionSchema.index({ status: 1, createdAt: -1 });          // فلتر الحالة + الترتيب
transactionSchema.index({ userId: 1, createdAt: -1 });           // معاملات المستخدم الفردي
transactionSchema.index({ clientBotId: 1, createdAt: -1 });      // معاملات الشركة
transactionSchema.index({ executorBotId: 1, status: 1 });        // مهام المنفذ
transactionSchema.index({ status: 1, updatedAt: -1 });           // التقارير والإحصاءات
transactionSchema.index({ executorBotId: 1, createdAt: -1 });    // رصيد المنفذ
transactionSchema.index({ managerBotId: 1, status: 1 });         // مهام المدير

module.exports = mongoose.model('Transaction', transactionSchema);