// models/Ledger.js
const mongoose = require('mongoose');

const ledgerSchema = new mongoose.Schema({
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true }, // أيدي العميل أو الشركة
    entityModel: { type: String, required: true, enum: ['User', 'ClientBot', 'SubAccount', 'ExecutorBot'] }, // نوع الحساب
    transactionId: { type: String, required: true }, // رقم الفاتورة (مثال: ATT-2605-0001)
    type: { type: String, required: true, enum: ['DEPOSIT', 'DEDUCTION', 'TRANSFER', 'COMMISSION', 'REFUND'] }, // نوع الحركة
    amount: { type: Number, required: true }, // المبلغ المخصوم أو المضاف
    balanceBefore: { type: Number, required: true }, // الرصيد قبل الحركة
    balanceAfter: { type: Number, required: true }, // الرصيد بعد الحركة
    description: { type: String } // بيان العملية
}, { timestamps: true });

// فهارس (Indexes) لتسريع جلب كشوفات الحسابات المعقدة
ledgerSchema.index({ entityId: 1, createdAt: -1 });
ledgerSchema.index({ transactionId: 1 });
ledgerSchema.index({ entityId: 1, type: 1, createdAt: -1 }); // فلتر نوع العملية + ترتيب زمني
ledgerSchema.index({ type: 1, createdAt: -1 });               // تقارير نوع محدد

ledgerSchema.pre('save', function(next) {
    if (!this.isNew && this.isModified()) {
        return next(new Error('LEDGER_IMMUTABLE'));
    }
    return next();
});

const blockLedgerMutation = function(next) {
    return next(new Error('LEDGER_IMMUTABLE'));
};

ledgerSchema.pre('updateOne', blockLedgerMutation);
ledgerSchema.pre('updateMany', blockLedgerMutation);
ledgerSchema.pre('findOneAndUpdate', blockLedgerMutation);
ledgerSchema.pre('replaceOne', blockLedgerMutation);
ledgerSchema.pre('deleteOne', blockLedgerMutation);
ledgerSchema.pre('deleteMany', blockLedgerMutation);
ledgerSchema.pre('findOneAndDelete', blockLedgerMutation);
ledgerSchema.pre('findOneAndReplace', blockLedgerMutation);

module.exports = mongoose.model('Ledger', ledgerSchema);
