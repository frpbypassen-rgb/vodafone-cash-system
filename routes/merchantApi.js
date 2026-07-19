const express = require('express');
const router = express.Router();
const ClientBot = require('../models/ClientBot');
const Transaction = require('../models/Transaction');
const Settings = require('../models/Settings');

// ==========================================================
// 🌐 واجهة برمجة تطبيقات الوكلاء (Merchant API - Ahram Pay)
// ==========================================================

const merchantApiAuth = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ status: 'failed', message: 'مفتاح المصادقة (x-api-key) مفقود في الهيدر' });
    }

    const company = await ClientBot.findOne({ token: apiKey, status: 'active' }).lean();
    if (!company) {
        return res.status(401).json({ status: 'failed', message: 'مفتاح المصادقة غير صحيح أو الحساب موقوف' });
    }

    req.merchant = company;
    next();
};

router.get('/balance', merchantApiAuth, async (req, res) => {
    const settings = await Settings.findOne({}).lean();
    const globalRate = settings && settings.exchangeRate ? settings.exchangeRate : 1;
    const customRate = req.merchant.exchangeRate ? req.merchant.exchangeRate : globalRate;

    res.json({
        status: 'success',
        data: {
            merchant_name: req.merchant.name,
            balance: req.merchant.balance,
            exchange_rate: customRate 
        }
    });
});

router.post('/transfer', merchantApiAuth, async (req, res) => {
    try {
        const { target_number, amount, transfer_type } = req.body;
        
        const phoneStr = target_number ? target_number.toString().trim() : '';
        const phoneRegex = /^\d{11}$/; 
        
        if (!phoneRegex.test(phoneStr)) {
            return res.status(400).json({ status: 'failed', message: 'عفواً، رقم الهاتف غير صالح. يجب أن يتكون من 11 رقماً بالضبط.' });
        }

        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2); 
        const mm = (now.getMonth() + 1).toString().padStart(2, '0'); 
        
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const countThisMonth = await Transaction.countDocuments({ createdAt: { $gte: startOfMonth } });
        
        const sequence = (countThisMonth + 1).toString().padStart(4, '0'); 
        const customId = `ATT-${yy}${mm}-${sequence}`;

        const settings = await Settings.findOne({}).lean();
        const globalRate = settings && settings.exchangeRate ? settings.exchangeRate : 1; 
        
        const exchangeRate = req.merchant.exchangeRate ? req.merchant.exchangeRate : globalRate;
        const costLYD = parseFloat((amount / exchangeRate).toFixed(3));

        const tx = await Transaction.create({
            userId: 'api_merchant',
            clientBotId: req.merchant._id,
            amount: Math.abs(parseFloat(amount)),
            costLYD: costLYD, 
            exchangeRate: exchangeRate, 
            vodafoneNumber: phoneStr, 
            status: 'pending',
            customId: customId, 
            companyName: req.merchant.name,
            employeeName: 'ربط آلي (Merchant API)',
            transferType: transfer_type || 'vodafone_cash',
            notes: '[طلب وارد عبر API التاجر الخارجي]',
            executorBotId: (settings && settings.autoRouteEnabled && settings.autoRouteBotId) ? settings.autoRouteBotId : undefined
        });

        res.json({
            status: 'success',
            message: 'تم استلام الطلب بنجاح وهو الآن قيد المعالجة',
            data: {
                transaction_id: tx._id,
                invoice_number: tx.customId,
                status: 'pending',
                amount_egp: tx.amount,
                exchange_rate: exchangeRate, 
                cost_lyd: tx.costLYD         
            }
        });
    } catch (error) {
        res.status(500).json({ status: 'failed', message: 'حدث خطأ داخلي أثناء معالجة الطلب' });
    }
});

router.get('/status/:reference_id', merchantApiAuth, async (req, res) => {
    try {
        const tx = await Transaction.findOne({ clientBotId: req.merchant._id, customId: req.params.reference_id }).lean();
        if (!tx) {
            return res.status(404).json({ status: 'failed', message: 'لا يوجد طلب بهذا الرقم المرجعي' });
        }

        res.json({
            status: 'success',
            data: {
                transaction_id: tx._id,
                reference_id: tx.customId,
                target_number: tx.vodafoneNumber,
                amount_egp: tx.amount,
                exchange_rate: tx.exchangeRate || 1, 
                cost_lyd: tx.costLYD || tx.amount,   
                status: tx.status, 
                notes: tx.notes || 'لا يوجد ملاحظات'
            }
        });
    } catch(e) {
        res.status(500).json({ status: 'failed', message: 'خطأ داخلي' });
    }
});

module.exports = router;
