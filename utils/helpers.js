// utils/helpers.js
// ====================================================
// 🔧 الدوال المساعدة المركزية — لمنع تكرار الكود
// ====================================================
const ExecutorBot = require('../models/ExecutorBot');
const Transaction = require('../models/Transaction');
const bcrypt = require('bcryptjs');

// ────────────────────────────────────────────────────────────
// 1️⃣ مزامنة رصيد البوت المنفذ من العمليات المالية
// ────────────────────────────────────────────────────────────
const syncBotBalance = async (botId) => {
    const bot = await ExecutorBot.findById(botId);
    if (!bot) return 0;
    
    let queryFilter = {};
    if (bot.isManagerBot) {
        queryFilter = { 
            $or: [
                { managerBotId: bot._id, status: 'completed' }, 
                { executorBotId: bot._id, status: { $in: ['deposit', 'deduction'] } } 
            ]
        };
    } else {
        queryFilter = { 
            executorBotId: bot._id, 
            status: { $in: ['completed', 'deposit', 'deduction'] } 
        };
    }

    const txs = await Transaction.find(queryFilter);
    let computedBalance = 0;
    txs.forEach(t => {
        if (t.status === 'completed') computedBalance -= t.amount; 
        else if (t.status === 'deposit') computedBalance += t.amount; 
        else if (t.status === 'deduction') computedBalance -= Math.abs(t.amount); 
    });

    bot.balance = computedBalance;
    await bot.save();
    return computedBalance;
};

// ────────────────────────────────────────────────────────────
// 2️⃣ التحقق من كلمة المرور + ترقية تلقائية إلى bcrypt
// يُستخدم في: mobileApi, clientPortal, executorPortal, auth
// ────────────────────────────────────────────────────────────
const verifyAndUpgradePassword = async (plainPassword, storedPassword, Model, docId) => {
    if (!storedPassword) return false;

    let isMatch = false;
    if (storedPassword.startsWith('$2')) {
        // كلمة المرور مشفرة — تحقق مباشر
        isMatch = await bcrypt.compare(plainPassword, storedPassword);
    } else {
        // كلمة المرور نص عادي — تحقق ثم ترقية
        isMatch = (plainPassword === storedPassword);
        if (isMatch) {
            const hashed = await bcrypt.hash(plainPassword, 12);
            await Model.updateOne({ _id: docId }, { webPassword: hashed });
        }
    }
    return isMatch;
};

// ────────────────────────────────────────────────────────────
// 3️⃣ تنسيق التاريخ الحالي بتوقيت طرابلس
// يُستخدم في: clientPortal, executorPortal
// ────────────────────────────────────────────────────────────
const getTodayString = () => {
    return new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Tripoli' });
};

// ────────────────────────────────────────────────────────────
// 4️⃣ هروب الأحرف الخاصة في Regex
// يمنع هجمات NoSQL Injection عبر الـ RegExp
// ────────────────────────────────────────────────────────────
const escapeRegex = (str) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

module.exports = { 
    syncBotBalance, 
    verifyAndUpgradePassword, 
    getTodayString, 
    escapeRegex 
};