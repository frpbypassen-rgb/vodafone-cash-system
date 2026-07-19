// repositories/userRepository.js
// ===============================================
// 📦 طبقة الوصول للبيانات — إدارة المستخدمين
// ===============================================
'use strict';

const User = require('../models/User');
const ClientEmployee = require('../models/ClientEmployee');
const Employee = require('../models/Employee');
const ClientBot = require('../models/ClientBot');
const bcrypt = require('bcryptjs');

/**
 * البحث عن حساب بالـ credentials (الأولوية: Employee → ClientEmployee → User)
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{account, accountType, balance, telegramId, executorBotId}|null>}
 */
const findByCredentials = async (username, password) => {
    const searchUser = username.trim().toLowerCase();
    const searchPass = password.trim();

    // 1. فحص المنفذ (Employee)
    const execDoc = await Employee.findOne({
        $or: [{ webUsername: searchUser }, { phone: username }]
    }).populate('botId');

    if (execDoc) {
        const isMatch = await _comparePassword(searchPass, execDoc.webPassword, Employee, execDoc._id);
        if (isMatch) {
            if (execDoc.status !== 'active') return { error: 'ACCOUNT_BANNED', accountType: 'executor' };
            return {
                account: execDoc,
                accountType: 'executor',
                telegramId: execDoc.telegramId,
                executorBotId: execDoc.botId ? execDoc.botId._id : null,
                balance: execDoc.botId ? execDoc.botId.balance : 0
            };
        }
    }

    // 2. فحص موظف الشركة (ClientEmployee)
    const empDoc = await ClientEmployee.findOne({
        $or: [{ webUsername: searchUser }, { phone: username }]
    });

    if (empDoc) {
        const isMatch = await _comparePassword(searchPass, empDoc.webPassword, ClientEmployee, empDoc._id);
        if (isMatch) {
            if (empDoc.status !== 'active') return { error: 'ACCOUNT_BANNED', accountType: 'client_company' };
            const company = await ClientBot.findById(empDoc.clientBotId);
            return {
                account: empDoc,
                accountType: 'client_company',
                telegramId: empDoc.telegramId,
                executorBotId: null,
                balance: company ? company.balance : 0
            };
        }
    }

    // 3. فحص العميل الفردي (User)
    const userDoc = await User.findOne({
        $or: [{ webUsername: searchUser }, { phone: username }]
    });

    if (userDoc) {
        const isMatch = await _comparePassword(searchPass, userDoc.webPassword, User, userDoc._id);
        if (isMatch) {
            if (userDoc.status !== 'active') return { error: 'ACCOUNT_BANNED', accountType: 'client_user' };
            return {
                account: userDoc,
                accountType: 'client_user',
                telegramId: userDoc.telegramId,
                executorBotId: null,
                balance: userDoc.balance
            };
        }
    }

    return null;
};

/**
 * مقارنة كلمة المرور مع دعم الـ migration التلقائي
 */
const _comparePassword = async (inputPass, storedPass, Model, docId) => {
    if (!storedPass) return false;

    if (storedPass.startsWith('$2')) {
        return bcrypt.compare(inputPass, storedPass);
    }

    // Legacy plaintext → auto-migrate
    if (inputPass === storedPass) {
        await Model.updateOne({ _id: docId }, { webPassword: await bcrypt.hash(inputPass, 12) });
        return true;
    }
    return false;
};

/**
 * جلب حساب بالمعرف والنوع
 */
const findById = async (userId, accountType) => {
    const Model = _getModel(accountType);
    const account = await Model.findById(userId);
    if (accountType === 'executor' && account) {
        return Model.findById(userId).populate('botId');
    }
    return account;
};

/**
 * تحديث refresh token
 */
const updateRefreshToken = async (userId, accountType, token) => {
    const Model = _getModel(accountType);
    return Model.updateOne({ _id: userId }, { $set: { refreshToken: token } }, { strict: false });
};

/**
 * حذف refresh token (logout)
 */
const clearRefreshToken = async (userId, accountType) => {
    const Model = _getModel(accountType);
    return Model.updateOne({ _id: userId }, { $unset: { refreshToken: 1 } }, { strict: false });
};

/**
 * الحصول على الـ Model المناسب
 */
const _getModel = (accountType) => {
    switch (accountType) {
        case 'executor': return Employee;
        case 'client_company': return ClientEmployee;
        default: return User;
    }
};

/**
 * الحصول على اسم الـ Model
 */
const getModelName = (accountType) => {
    switch (accountType) {
        case 'executor': return 'Employee';
        case 'client_company': return 'ClientEmployee';
        default: return 'User';
    }
};

module.exports = {
    findByCredentials,
    findById,
    updateRefreshToken,
    clearRefreshToken,
    getModelName
};
