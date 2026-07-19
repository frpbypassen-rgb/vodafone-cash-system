const express = require('express');
const router = express.Router();

const Transaction = require('../models/Transaction');
const User = require('../models/User');
const ClientBot = require('../models/ClientBot');
const { requireAuth } = require('../middlewares/auth');
const { escapeRegex, isValidObjectId } = require('../middlewares/sanitize');

router.use(requireAuth);

const statusLabels = {
    pending: 'معلق',
    processing: 'توجيه للمنفذ',
    accepted: 'قيد العمل',
    completed: 'مكتمل',
    rejected: 'ملغي',
    deposit_pending: 'طلب إيداع',
    deposit: 'إيداع',
    deduction: 'خصم',
    cancelled_by_admin: 'ملغي من الإدارة'
};

function parseEntityKey(entityKey) {
    if (!entityKey || !entityKey.includes(':')) return { entityType: '', entityId: '' };
    const [entityType, entityId] = entityKey.split(':');
    if (!['user', 'company'].includes(entityType)) return { entityType: '', entityId: '' };
    return { entityType, entityId };
}

function applyFilters(query, filters) {
    if (filters.status) query.status = filters.status;

    if (filters.search) {
        const safeSearch = escapeRegex(filters.search);
        query.$or = [
            { customId: { $regex: safeSearch, $options: 'i' } },
            { vodafoneNumber: { $regex: safeSearch, $options: 'i' } },
            { accountNumber: { $regex: safeSearch, $options: 'i' } },
            { companyName: { $regex: safeSearch, $options: 'i' } },
            { employeeName: { $regex: safeSearch, $options: 'i' } }
        ];
    }

    if (filters.fromDate || filters.toDate) {
        query.createdAt = {};
        if (filters.fromDate) query.createdAt.$gte = new Date(`${filters.fromDate}T00:00:00.000Z`);
        if (filters.toDate) query.createdAt.$lte = new Date(`${filters.toDate}T23:59:59.999Z`);
    }
}

async function getReportContext(queryParams) {
    const filters = {
        entityKey: queryParams.entityKey || '',
        status: queryParams.status || '',
        fromDate: queryParams.fromDate || '',
        toDate: queryParams.toDate || '',
        search: queryParams.search || ''
    };

    const { entityType, entityId } = parseEntityKey(filters.entityKey);
    const query = {};
    let selectedEntity = null;

    if (entityType === 'user' && isValidObjectId(entityId)) {
        const user = await User.findById(entityId).lean();
        if (user) {
            selectedEntity = {
                type: 'user',
                id: user._id.toString(),
                name: user.name || 'عميل فردي',
                phone: user.phone || '',
                balance: user.balance || 0,
                lookup: user.telegramId
            };
            query.userId = user.telegramId || '__missing_user_id__';
            query.clientBotId = null;
        }
    } else if (entityType === 'company' && isValidObjectId(entityId)) {
        const company = await ClientBot.findById(entityId).lean();
        if (company) {
            selectedEntity = {
                type: 'company',
                id: company._id.toString(),
                name: company.name || 'شركة',
                phone: company.phone || '',
                balance: company.balance || 0,
                lookup: company._id
            };
            query.clientBotId = company._id;
        }
    }

    applyFilters(query, filters);
    return { filters, query, selectedEntity };
}

function summarizeTransactions(transactions, selectedEntity) {
    const totals = {
        count: transactions.length,
        transfersCount: 0,
        transfersEGP: 0,
        transfersLYD: 0,
        deposits: 0,
        deductions: 0,
        pendingCount: 0,
        cancelledCount: 0,
        closingBalance: selectedEntity ? selectedEntity.balance : null
    };

    transactions.forEach((tx) => {
        if (tx.status === 'completed') {
            totals.transfersCount += 1;
            totals.transfersEGP += tx.amount || 0;
            totals.transfersLYD += tx.costLYD || 0;
        } else if (tx.status === 'deposit') {
            totals.deposits += tx.amount || 0;
        } else if (tx.status === 'deduction') {
            totals.deductions += tx.amount || 0;
        } else if (['pending', 'processing', 'accepted', 'deposit_pending'].includes(tx.status)) {
            totals.pendingCount += 1;
        } else if (['rejected', 'cancelled_by_admin'].includes(tx.status)) {
            totals.cancelledCount += 1;
        }
    });

    totals.netSettlements = totals.deposits - totals.deductions;
    return totals;
}

function csvEscape(value) {
    const text = value === null || typeof value === 'undefined' ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

function formatDate(value) {
    return value ? new Date(value).toLocaleString('en-GB') : '';
}

function buildCsv({ transactions, totals, selectedEntity, filters }) {
    const lines = [];
    lines.push(['كشف حساب', selectedEntity ? selectedEntity.name : 'كل العملاء'].map(csvEscape).join(','));
    lines.push(['من تاريخ', filters.fromDate || '---', 'إلى تاريخ', filters.toDate || '---'].map(csvEscape).join(','));
    lines.push(['الرصيد الحالي', totals.closingBalance === null ? '---' : totals.closingBalance.toFixed(2), 'صافي التسويات', totals.netSettlements.toFixed(2)].map(csvEscape).join(','));
    lines.push(['إجمالي التحويلات EGP', totals.transfersEGP.toFixed(2), 'إجمالي التكلفة LYD', totals.transfersLYD.toFixed(2)].map(csvEscape).join(','));
    lines.push('');
    lines.push(['رقم العملية', 'التاريخ', 'العميل/الشركة', 'الموظف', 'الحالة', 'المبلغ EGP', 'التكلفة LYD', 'الرقم/الحساب', 'الملاحظة'].map(csvEscape).join(','));

    transactions.forEach((tx) => {
        lines.push([
            tx.customId || tx._id,
            formatDate(tx.createdAt),
            tx.companyName || 'عميل فردي',
            tx.employeeName || '',
            statusLabels[tx.status] || tx.status,
            Number(tx.amount || 0).toFixed(2),
            tx.costLYD ? Number(tx.costLYD).toFixed(2) : '',
            tx.vodafoneNumber || tx.accountNumber || '',
            tx.notes || ''
        ].map(csvEscape).join(','));
    });

    return `\uFEFF${lines.join('\n')}`;
}

router.get('/reports', async (req, res) => {
    try {
        const [users, companies, context] = await Promise.all([
            User.find({}).sort({ createdAt: -1 }).lean(),
            ClientBot.find({}).sort({ createdAt: -1 }).lean(),
            getReportContext(req.query)
        ]);

        const transactions = await Transaction.find(context.query)
            .sort({ createdAt: -1 })
            .limit(500)
            .lean();

        res.render('reports', {
            users,
            companies,
            transactions,
            selectedEntity: context.selectedEntity,
            filters: context.filters,
            totals: summarizeTransactions(transactions, context.selectedEntity),
            statusLabels
        });
    } catch (error) {
        console.error('[reports] error:', error.message);
        res.status(500).send('حدث خطأ أثناء تجهيز الكشوفات');
    }
});

router.get('/reports/export', async (req, res) => {
    try {
        const context = await getReportContext(req.query);
        const transactions = await Transaction.find(context.query)
            .sort({ createdAt: -1 })
            .limit(10000)
            .lean();

        const totals = summarizeTransactions(transactions, context.selectedEntity);
        const csv = buildCsv({ transactions, totals, selectedEntity: context.selectedEntity, filters: context.filters });
        const fileName = `account-closing-${new Date().toISOString().slice(0, 10)}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(csv);
    } catch (error) {
        console.error('[reports/export] error:', error.message);
        res.status(500).send('تعذر تحميل ملف التقفيل');
    }
});

module.exports = router;
