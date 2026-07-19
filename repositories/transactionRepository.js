// repositories/transactionRepository.js
// ===============================================
// 📦 طبقة الوصول للبيانات — العمليات المالية
// ===============================================
'use strict';

const Transaction = require('../models/Transaction');
const Counter = require('../models/Counter');

/**
 * إنشاء عملية جديدة مع توليد customId
 * @param {Object} data - بيانات العملية
 * @param {Object} [session] - جلسة MongoDB
 * @returns {Promise<Object>} العملية المنشأة
 */
const create = async (data, session = null) => {
    const customId = await _generateCustomId(session);
    const tx = new Transaction({ ...data, customId });
    await tx.save(session ? { session } : {});
    return tx;
};

/**
 * توليد رقم تسلسلي فريد للفاتورة
 * @private
 */
const _generateCustomId = async (session = null) => {
    const options = { upsert: true, new: true };
    if (session) options.session = session;

    const counter = await Counter.findOneAndUpdate(
        { name: 'transaction' },
        { $inc: { value: 1 } },
        options
    );

    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    return `ATT-${yy}${mm}-${counter.value.toString().padStart(4, '0')}`;
};

/**
 * البحث عن عملية بواسطة idempotency key
 */
const findByIdempotencyKey = async (key, session = null) => {
    const query = Transaction.findOne({ idempotencyKey: key });
    if (session) query.session(session);
    return query;
};

/**
 * جلب عمليات بالحالة مع فلاتر
 */
const findByStatus = async (status, filters = {}, options = {}) => {
    const { limit = 50, skip = 0, sort = { createdAt: -1 } } = options;
    const query = { status, ...filters };

    return Transaction.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();
};

/**
 * تحديث حالة عملية بشكل ذري
 */
const updateStatus = async (id, status, additionalData = {}, session = null) => {
    const options = { new: true };
    if (session) options.session = session;

    return Transaction.findOneAndUpdate(
        { _id: id },
        { $set: { status, ...additionalData } },
        options
    );
};

/**
 * قبول مهمة (atomic — يضمن أن شخص واحد فقط يقبل)
 */
const acceptTask = async (taskId, operatorId, executorName) => {
    return Transaction.findOneAndUpdate(
        { _id: taskId, status: 'processing' },
        {
            $set: {
                status: 'accepted',
                operatorId,
                executorName,
                emergencyAlert: undefined
            }
        },
        { new: true }
    );
};

/**
 * جلب المهام المتاحة لمنفذ محدد
 */
const getLiveTasksForExecutor = async (executorBotId) => {
    const tasks = await Transaction.find({
        executorBotId,
        status: { $in: ['processing', 'accepted'] }
    }).sort({ createdAt: 1 }).lean();

    const alerts = await Transaction.find({
        executorBotId,
        emergencyAlert: { $exists: true, $ne: null },
        status: { $in: ['processing', 'accepted'] }
    }).lean();

    return { tasks, alerts };
};

/**
 * جلب سجل عمليات العميل
 */
const getClientTransactions = async (clientId, clientType, options = {}) => {
    const { limit = 50, skip = 0 } = options;
    const filter = clientType === 'client_company'
        ? { clientBotId: clientId }
        : { userId: clientId };

    return Transaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
};

module.exports = {
    create,
    findByIdempotencyKey,
    findByStatus,
    updateStatus,
    acceptTask,
    getLiveTasksForExecutor,
    getClientTransactions
};
