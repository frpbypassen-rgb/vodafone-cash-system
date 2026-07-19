// controllers/client/clientController.js
// ===============================================
// 👤 Controller — عمليات العملاء
// ===============================================
'use strict';

const User = require('../../models/User');
const ClientEmployee = require('../../models/ClientEmployee');
const ClientBot = require('../../models/ClientBot');
const Settings = require('../../models/Settings');
const { getRateForTier } = require('../../utils/rateHelper');
const transferService = require('../../services/transferService');

/**
 * GET /client/home — الشاشة الرئيسية
 */
const getHome = async (req, res) => {
    try {
        const { userId, accountType } = req.user;
        let balance = 0, tier = 1;

        if (accountType === 'client_company') {
            const emp = await ClientEmployee.findById(userId);
            if (emp) {
                const comp = await ClientBot.findById(emp.clientBotId);
                if (comp) { balance = comp.balance || 0; tier = comp.tier || 1; }
            }
        } else if (accountType === 'client_user') {
            const user = await User.findById(userId);
            if (user) { balance = user.balance || 0; tier = user.tier || 1; }
        }

        const settings = await Settings.findOne({});
        const currentRate = getRateForTier(tier, settings);
        res.json({ success: true, balance: Number(balance), rate: Number(currentRate), isOpen: !(settings && settings.isManualClosed) });
    } catch (e) {
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'خطأ داخلي' });
    }
};

/**
 * POST /client/exchange-rate — سعر الصرف
 */
const getExchangeRate = async (req, res) => {
    try {
        const { userId, accountType } = req.user;
        const settings = await Settings.findOne({});
        let finalRate = getRateForTier(1, settings);
        let balance = 0;

        if (accountType === 'client_company') {
            const emp = await ClientEmployee.findById(userId);
            if (emp) {
                const comp = await ClientBot.findById(emp.clientBotId);
                if (comp) { finalRate = getRateForTier(comp.tier || 1, settings); balance = comp.balance || 0; }
            }
        } else if (accountType === 'client_user') {
            const user = await User.findById(userId);
            if (user) { finalRate = getRateForTier(user.tier || 1, settings); balance = user.balance || 0; }
        }
        res.json({ success: true, balance: Number(balance), exchangeRate: Number(finalRate) });
    } catch (error) {
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'خطأ داخلي بالسيرفر' });
    }
};

/**
 * POST /client/new-transfer — إنشاء تحويل جديد
 */
const createTransfer = async (req, res) => {
    try {
        const { userId, accountType } = req.user;
        const result = await transferService.createTransfer({
            userId,
            accountType,
            transferData: req.body,
            req
        });
        return res.status(result.statusCode).json(result);
    } catch (error) {
        res.status(500).json({ success: false, code: 'SERVER_ERROR', message: 'حدث خطأ داخلي' });
    }
};

module.exports = { getHome, getExchangeRate, createTransfer };
