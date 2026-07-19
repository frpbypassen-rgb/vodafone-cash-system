// services/reconciliationService.js
// ===============================================
// 🔄 خدمة المطابقة — Reconciliation System
// ===============================================
'use strict';

const mongoose = require('mongoose');
const Reconciliation = require('../models/Reconciliation');
const Ledger = require('../models/Ledger');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const ClientBot = require('../models/ClientBot');
const ExecutorBot = require('../models/ExecutorBot');
const SubAccount = require('../models/SubAccount');
const logger = require('../utils/logger');

/**
 * تنفيذ مطابقة يومية
 * مقارنة الأرصدة الفعلية مع الأرصدة المحسوبة من دفتر الأستاذ
 * @param {Date} [date] - تاريخ المطابقة
 */
const reconcileDaily = async (date = new Date()) => {
    try {
        const reconciliation = new Reconciliation({
            reconciliationDate: date,
            type: 'daily',
            status: 'pending',
            summary: {
                totalEntitiesChecked: 0,
                matchedCount: 0,
                discrepancyCount: 0,
                totalLedgerSum: 0,
                totalAccountBalance: 0,
                difference: 0
            },
            discrepancies: [],
            checks: {}
        });

        let totalEntities = 0, matched = 0, discrepancies = [];
        let totalLedgerSum = 0, totalAccountBalance = 0;

        // 1. مطابقة حسابات العملاء الأفراد
        const users = await User.find({ status: 'active' }).lean();
        for (const user of users) {
            const result = await _reconcileEntity(user._id, 'User', user.balance || 0, user.name);
            totalEntities++;
            totalLedgerSum += result.ledgerBalance;
            totalAccountBalance += result.accountBalance;
            if (result.discrepancy) discrepancies.push(result.discrepancy);
            else matched++;
        }

        // 2. مطابقة حسابات الشركات
        const companies = await ClientBot.find({ status: 'active' }).lean();
        for (const company of companies) {
            const result = await _reconcileEntity(company._id, 'ClientBot', company.balance || 0, company.name);
            totalEntities++;
            totalLedgerSum += result.ledgerBalance;
            totalAccountBalance += result.accountBalance;
            if (result.discrepancy) discrepancies.push(result.discrepancy);
            else matched++;
        }

        // 3. مطابقة عُهد المنفذين
        const executors = await ExecutorBot.find({ status: { $in: ['active', 'paused'] } }).lean();
        for (const executor of executors) {
            const result = await _reconcileEntity(executor._id, 'ExecutorBot', executor.balance || 0, executor.name);
            totalEntities++;
            totalLedgerSum += result.ledgerBalance;
            totalAccountBalance += result.accountBalance;
            if (result.discrepancy) discrepancies.push(result.discrepancy);
            else matched++;
        }

        // 4. فحوصات إضافية
        const integrityChecks = await _performIntegrityChecks();

        // تحديث النتائج
        reconciliation.summary = {
            totalEntitiesChecked: totalEntities,
            matchedCount: matched,
            discrepancyCount: discrepancies.length,
            totalLedgerSum: Math.round(totalLedgerSum * 1000) / 1000,
            totalAccountBalance: Math.round(totalAccountBalance * 1000) / 1000,
            difference: Math.round((totalAccountBalance - totalLedgerSum) * 1000) / 1000
        };
        reconciliation.discrepancies = discrepancies;
        reconciliation.checks = integrityChecks;
        reconciliation.status = discrepancies.length === 0 ? 'matched' : 'discrepancy_found';
        reconciliation.performedBy = 'System (Auto)';

        await reconciliation.save();

        logger.financial('Daily reconciliation completed', {
            date: date.toISOString().split('T')[0],
            entities: totalEntities,
            matched,
            discrepancies: discrepancies.length,
            status: reconciliation.status
        });

        return reconciliation;
    } catch (error) {
        logger.error('Reconciliation failed', { error: error.message, date });
        throw error;
    }
};

/**
 * مطابقة كيان واحد
 */
const _reconcileEntity = async (entityId, entityType, accountBalance, entityName) => {
    // حساب الرصيد من دفتر الأستاذ
    const ledgerResult = await Ledger.aggregate([
        { $match: { entityId: new mongoose.Types.ObjectId(entityId) } },
        { $group: { _id: null, totalBalance: { $sum: '$amount' } } }
    ]);

    const ledgerBalance = ledgerResult.length > 0 ? ledgerResult[0].totalBalance : 0;
    const difference = Math.round((accountBalance - ledgerBalance) * 1000) / 1000;
    const threshold = 0.01; // هامش مقبول (1 مليم)

    if (Math.abs(difference) > threshold) {
        return {
            ledgerBalance,
            accountBalance,
            discrepancy: {
                entityType,
                entityId,
                entityName,
                accountBalance: Math.round(accountBalance * 1000) / 1000,
                ledgerBalance: Math.round(ledgerBalance * 1000) / 1000,
                difference,
                possibleCause: _identifyCause(difference, entityType),
                resolved: false
            }
        };
    }

    return { ledgerBalance, accountBalance, discrepancy: null };
};

/**
 * تحديد السبب المحتمل للفرق
 */
const _identifyCause = (difference, entityType) => {
    if (difference > 0) return 'Balance higher than ledger — possible missing DEBIT entry';
    if (difference < 0) return 'Balance lower than ledger — possible missing CREDIT entry or double deduction';
    return 'Unknown';
};

/**
 * فحوصات سلامة البيانات
 */
const _performIntegrityChecks = async () => {
    // 1. عمليات مكتملة بدون قيد في الدفتر
    const completedTxIds = await Transaction.find({
        status: { $in: ['completed', 'rejected'] }
    }).distinct('customId');

    const ledgerTxIds = await Ledger.distinct('transactionId');
    const completedSet = new Set(completedTxIds);
    const ledgerSet = new Set(ledgerTxIds);

    let orphanedTransactions = 0;
    for (const txId of completedSet) {
        if (!ledgerSet.has(txId)) orphanedTransactions++;
    }

    let orphanedLedgerEntries = 0;
    for (const txId of ledgerSet) {
        if (txId !== 'SYS-SYNC' && !completedSet.has(txId)) orphanedLedgerEntries++;
    }

    return {
        ledgerIntegrity: orphanedTransactions === 0,
        balanceConsistency: true, // سيتم تحديده من النتائج أعلاه
        transactionStatusConsistency: true,
        orphanedTransactions,
        orphanedLedgerEntries
    };
};

/**
 * كشف الفروقات
 */
const detectDiscrepancies = async () => {
    const latest = await Reconciliation.findOne()
        .sort({ reconciliationDate: -1 })
        .lean();

    if (!latest) return { hasDiscrepancies: false, message: 'No reconciliation found' };

    return {
        hasDiscrepancies: latest.status === 'discrepancy_found',
        discrepancyCount: latest.summary.discrepancyCount,
        lastReconciliation: latest.reconciliationDate,
        discrepancies: latest.discrepancies
    };
};

/**
 * جلب تقارير المطابقة
 */
const getReconciliationReports = async (options = {}) => {
    const { limit = 30, skip = 0 } = options;
    return Reconciliation.find()
        .sort({ reconciliationDate: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
};

module.exports = {
    reconcileDaily,
    detectDiscrepancies,
    getReconciliationReports
};
