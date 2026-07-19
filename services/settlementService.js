// services/settlementService.js
// ===============================================
// 💰 خدمة التسويات المحاسبية — Settlement Engine
// ===============================================
'use strict';

const Settlement = require('../models/Settlement');
const Transaction = require('../models/Transaction');
const Ledger = require('../models/Ledger');
const User = require('../models/User');
const ClientBot = require('../models/ClientBot');
const ExecutorBot = require('../models/ExecutorBot');
const logger = require('../utils/logger');

/**
 * توليد تسوية يومية
 * @param {Date} date - التاريخ المطلوب
 * @returns {Promise<Object>} التسوية المنشأة
 */
const generateDailySettlement = async (date = new Date()) => {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    try {
        // التحقق من عدم وجود تسوية مكررة
        const existing = await Settlement.findOne({
            type: 'daily',
            entityType: 'system',
            'period.start': startOfDay
        });
        if (existing) return existing;

        // جمع بيانات العمليات لليوم
        const transactions = await Transaction.find({
            createdAt: { $gte: startOfDay, $lte: endOfDay },
            status: { $in: ['completed', 'rejected', 'pending', 'processing', 'accepted'] }
        }).lean();

        const completed = transactions.filter(t => t.status === 'completed');
        const cancelled = transactions.filter(t => t.status === 'rejected');
        const pending = transactions.filter(t => ['pending', 'processing', 'accepted'].includes(t.status));

        // تجميع حسب نوع التحويل
        const transferTypes = {};
        for (const tx of transactions) {
            const type = tx.transferType || 'unknown';
            if (!transferTypes[type]) transferTypes[type] = { count: 0, amount: 0 };
            transferTypes[type].count++;
            transferTypes[type].amount += tx.amount || 0;
        }

        // حساب الإجماليات
        const totalAmountEGP = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
        const totalCostLYD = transactions.reduce((sum, t) => sum + (t.costLYD || 0), 0);
        const totalRefunds = cancelled.reduce((sum, t) => sum + (t.costLYD || 0), 0);

        const settlement = new Settlement({
            period: { start: startOfDay, end: endOfDay },
            type: 'daily',
            entityType: 'system',
            entityName: 'Al-Ahram Pay System',
            summary: {
                totalTransactions: transactions.length,
                totalAmountEGP,
                totalCostLYD,
                totalCommission: 0,
                totalRefunds,
                netAmount: totalCostLYD - totalRefunds,
                completedCount: completed.length,
                cancelledCount: cancelled.length,
                pendingCount: pending.length
            },
            details: {
                transferTypes
            },
            status: 'draft'
        });

        await settlement.save();
        logger.financial('Daily settlement generated', {
            date: startOfDay.toISOString().split('T')[0],
            transactions: transactions.length,
            totalEGP: totalAmountEGP
        });

        return settlement;
    } catch (error) {
        logger.error('Failed to generate daily settlement', { error: error.message, date });
        throw error;
    }
};

/**
 * توليد تسوية لمنفذ محدد
 */
const generateExecutorSettlement = async (executorBotId, startDate, endDate) => {
    try {
        const executorBot = await ExecutorBot.findById(executorBotId);
        if (!executorBot) throw new Error('EXECUTOR_NOT_FOUND');

        const transactions = await Transaction.find({
            executorBotId,
            status: 'completed',
            createdAt: { $gte: startDate, $lte: endDate }
        }).lean();

        const totalAmountEGP = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);

        const settlement = new Settlement({
            period: { start: startDate, end: endDate },
            type: 'custom',
            entityType: 'executor',
            entityId: executorBotId,
            entityName: executorBot.name,
            summary: {
                totalTransactions: transactions.length,
                totalAmountEGP,
                completedCount: transactions.length,
                netAmount: totalAmountEGP
            },
            details: {
                openingBalance: executorBot.balance + totalAmountEGP,
                closingBalance: executorBot.balance
            },
            status: 'draft'
        });

        await settlement.save();
        return settlement;
    } catch (error) {
        logger.error('Failed to generate executor settlement', { error: error.message });
        throw error;
    }
};

/**
 * اعتماد تسوية
 */
const approveSettlement = async (settlementId, adminId, adminName) => {
    return Settlement.findByIdAndUpdate(settlementId, {
        $set: {
            status: 'approved',
            approvedBy: adminId,
            approvedByName: adminName,
            approvedAt: new Date()
        }
    }, { new: true });
};

/**
 * جلب تسويات بفلاتر
 */
const getSettlements = async (filters = {}, options = {}) => {
    const { limit = 20, skip = 0 } = options;
    return Settlement.find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
};

module.exports = {
    generateDailySettlement,
    generateExecutorSettlement,
    approveSettlement,
    getSettlements
};
