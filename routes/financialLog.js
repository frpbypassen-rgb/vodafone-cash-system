'use strict';

const express = require('express');
const mongoose = require('mongoose');

const Ledger = require('../models/Ledger');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const ClientBot = require('../models/ClientBot');
const SubAccount = require('../models/SubAccount');
const ExecutorBot = require('../models/ExecutorBot');
const { requireAuth } = require('../middlewares/auth');
const { escapeRegex } = require('../middlewares/sanitize');

const router = express.Router();

const TYPE_LABELS = {
    DEPOSIT: 'إيداع',
    DEDUCTION: 'خصم',
    TRANSFER: 'تحويل',
    COMMISSION: 'عمولة',
    REFUND: 'استرجاع'
};

const MODEL_LABELS = {
    User: 'عميل فردي',
    ClientBot: 'شركة / وكيل',
    SubAccount: 'نقطة بيع',
    ExecutorBot: 'منفذ / بوت تنفيذ'
};

const ALLOWED_MODELS = Object.keys(MODEL_LABELS);
const ALLOWED_TYPES = Object.keys(TYPE_LABELS);

function normalizeDateRange(dateFrom, dateTo) {
    const range = {};
    if (dateFrom) range.$gte = new Date(`${dateFrom}T00:00:00.000`);
    if (dateTo) range.$lte = new Date(`${dateTo}T23:59:59.999`);
    return Object.keys(range).length ? range : null;
}

function buildLedgerQuery(filters) {
    const query = {};
    const entityKey = filters.entityKey || '';

    if (entityKey.includes(':')) {
        const [model, id] = entityKey.split(':');
        if (ALLOWED_MODELS.includes(model) && mongoose.Types.ObjectId.isValid(id)) {
            query.entityModel = model;
            query.entityId = new mongoose.Types.ObjectId(id);
            filters.entityModel = model;
            filters.entityId = id;
        }
    } else if (ALLOWED_MODELS.includes(filters.entityModel)) {
        query.entityModel = filters.entityModel;
    }

    if (ALLOWED_TYPES.includes(filters.type)) query.type = filters.type;
    if (filters.direction === 'credit') query.amount = { $gt: 0 };
    if (filters.direction === 'debit') query.amount = { $lt: 0 };

    const dateRange = normalizeDateRange(filters.dateFrom, filters.dateTo);
    if (dateRange) query.createdAt = dateRange;

    if (filters.search) {
        const safeSearch = escapeRegex(filters.search.trim());
        query.$or = [
            { transactionId: { $regex: safeSearch, $options: 'i' } },
            { description: { $regex: safeSearch, $options: 'i' } }
        ];
    }

    return query;
}

function entityLabel(doc, fallback = 'حساب غير معروف') {
    if (!doc) return fallback;
    return doc.name || doc.phone || doc.telegramId || doc.webUsername || String(doc._id);
}

function makeEntityOption(model, doc, labelPrefix = '') {
    const label = `${labelPrefix}${entityLabel(doc)}`;
    const phone = doc.phone || doc.telegramId || '';
    return {
        model,
        id: String(doc._id),
        label,
        phone,
        value: `${model}:${doc._id}`
    };
}

function makeEntityMap(options) {
    const maps = {};
    for (const model of ALLOWED_MODELS) maps[model] = new Map();
    for (const option of options) {
        maps[option.model].set(option.id, option);
    }
    return maps;
}

function safeNumber(value) {
    const numeric = Number(value || 0);
    return Number.isFinite(numeric) ? numeric : 0;
}

async function getEntityOptions() {
    const [users, companies, subAccounts, executors] = await Promise.all([
        User.find({}).select('name phone telegramId').sort({ name: 1 }).lean(),
        ClientBot.find({}).select('name phone').sort({ name: 1 }).lean(),
        SubAccount.find({}).select('name phone masterType masterId').sort({ name: 1 }).lean(),
        ExecutorBot.find({}).select('name').sort({ name: 1 }).lean()
    ]);

    return {
        users: users.map(doc => makeEntityOption('User', doc)),
        companies: companies.map(doc => makeEntityOption('ClientBot', doc)),
        subAccounts: subAccounts.map(doc => makeEntityOption('SubAccount', doc)),
        executors: executors.map(doc => makeEntityOption('ExecutorBot', doc))
    };
}

router.get('/financial-log', requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(20, parseInt(req.query.limit, 10) || 50));
        const skip = (page - 1) * limit;

        const filters = {
            search: (req.query.search || '').trim(),
            type: req.query.type || '',
            direction: req.query.direction || '',
            entityModel: req.query.entityModel || '',
            entityId: req.query.entityId || '',
            entityKey: req.query.entityKey || '',
            dateFrom: req.query.dateFrom || '',
            dateTo: req.query.dateTo || ''
        };

        const query = buildLedgerQuery(filters);

        const [entries, total, statsAgg, entityOptions] = await Promise.all([
            Ledger.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            Ledger.countDocuments(query),
            Ledger.aggregate([
                { $match: query },
                {
                    $group: {
                        _id: null,
                        totalCredits: { $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] } },
                        totalDebits: { $sum: { $cond: [{ $lt: ['$amount', 0] }, { $multiply: ['$amount', -1] }, 0] } },
                        movements: { $sum: 1 }
                    }
                }
            ]),
            getEntityOptions()
        ]);

        const allEntityOptions = [
            ...entityOptions.users,
            ...entityOptions.companies,
            ...entityOptions.subAccounts,
            ...entityOptions.executors
        ];
        const entityMaps = makeEntityMap(allEntityOptions);
        const transactionIds = entries
            .map(entry => entry.transactionId)
            .filter(id => id && id !== 'SYS-SYNC');

        const transactions = transactionIds.length
            ? await Transaction.find({ customId: { $in: transactionIds } })
                .select('customId status transferType vodafoneNumber accountNumber accountName amount costLYD exchangeRate companyName employeeName subAccountName executorName executorBotName notes createdAt updatedAt')
                .lean()
            : [];
        const transactionMap = new Map(transactions.map(tx => [tx.customId, tx]));

        const ledgers = entries.map(entry => {
            const id = String(entry.entityId);
            const entity = entityMaps[entry.entityModel] && entityMaps[entry.entityModel].get(id);
            const tx = transactionMap.get(entry.transactionId) || null;
            const amount = safeNumber(entry.amount);

            return {
                ...entry,
                _id: String(entry._id),
                entityId: id,
                entityLabel: entity ? entity.label : 'حساب غير معروف',
                entityPhone: entity ? entity.phone : '',
                entityModelLabel: MODEL_LABELS[entry.entityModel] || entry.entityModel,
                typeLabel: TYPE_LABELS[entry.type] || entry.type,
                directionLabel: amount >= 0 ? 'إضافة رصيد' : 'خصم رصيد',
                amountAbs: Math.abs(amount),
                transaction: tx ? {
                    ...tx,
                    _id: String(tx._id)
                } : null
            };
        });

        const stats = statsAgg[0] || { totalCredits: 0, totalDebits: 0, movements: 0 };
        stats.net = safeNumber(stats.totalCredits) - safeNumber(stats.totalDebits);

        res.render('financial_log', {
            activePage: 'financial_log',
            adminName: req.session.adminName || 'مدير',
            ledgers,
            filters,
            typeLabels: TYPE_LABELS,
            modelLabels: MODEL_LABELS,
            entityOptions,
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
            stats
        });
    } catch (error) {
        console.error('[FinancialLog]', error.message);
        res.status(500).send('خطأ في جلب السجل المالي');
    }
});

module.exports = router;
