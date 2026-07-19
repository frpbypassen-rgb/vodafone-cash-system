// validators/mobileValidators.js
// طبقة التحقق من المدخلات لمسارات Mobile API
'use strict';

const { body, validationResult } = require('express-validator');

/**
 * Middleware للتحقق من نتائج الـ validation وإرجاع خطأ موحد
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const first = errors.array()[0];
        return res.status(400).json({
            success: false,
            code: 'VALIDATION_ERROR',
            message: first.msg,
            field: first.path
        });
    }
    next();
};

// ── تسجيل الدخول ──────────────────────────────────────────────────
const loginValidator = [
    body('username')
        .trim()
        .notEmpty().withMessage('اسم المستخدم مطلوب')
        .isLength({ min: 3, max: 50 }).withMessage('اسم المستخدم يجب أن يكون بين 3 و50 حرف')
        .escape(),
    body('password')
        .trim()
        .notEmpty().withMessage('كلمة المرور مطلوبة')
        .isLength({ min: 4, max: 100 }).withMessage('كلمة المرور يجب أن تكون 4 أحرف على الأقل'),
    validate
];

// ── إنشاء تحويل جديد ──────────────────────────────────────────────
const transferValidator = [
    body('amount')
        .notEmpty().withMessage('المبلغ مطلوب')
        .isFloat({ min: 1, max: 500000 }).withMessage('المبلغ يجب أن يكون بين 1 و500,000'),
    body('number')
        .trim()
        .notEmpty().withMessage('رقم الهاتف أو الحساب مطلوب')
        .isLength({ min: 5, max: 30 }).withMessage('الرقم يجب أن يكون بين 5 و30 خانة'),
    body('transferType')
        .trim()
        .notEmpty().withMessage('نوع التحويل مطلوب')
        .isIn(['vodafone', 'post_account', 'post_card', 'بريد حساب', 'بريد بطاقة'])
        .withMessage('نوع التحويل غير صالح'),
    body('name')
        .optional()
        .trim()
        .isLength({ max: 100 }).withMessage('الاسم لا يتجاوز 100 حرف')
        .escape(),
    body('notes')
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage('الملاحظات لا تتجاوز 500 حرف')
        .escape(),
    validate
];

// ── إلغاء مهمة ────────────────────────────────────────────────────
const cancelTaskValidator = [
    body('reason')
        .trim()
        .notEmpty().withMessage('سبب الإلغاء مطلوب')
        .isLength({ min: 5, max: 300 }).withMessage('سبب الإلغاء يجب أن يكون بين 5 و300 حرف')
        .escape(),
    validate
];

// ── إتمام مهمة ────────────────────────────────────────────────────
const completeTaskValidator = [
    body('imageBase64')
        .notEmpty().withMessage('صورة الإثبات مطلوبة')
        .isString().withMessage('صورة الإثبات يجب أن تكون نص Base64'),
    body('senderPhone')
        .optional()
        .trim()
        .isLength({ min: 7, max: 20 }).withMessage('رقم المرسل غير صالح'),
    validate
];

// ── تجديد التوكن ──────────────────────────────────────────────────
const refreshTokenValidator = [
    body('refreshToken')
        .trim()
        .notEmpty().withMessage('Refresh Token مطلوب'),
    validate
];

module.exports = {
    loginValidator,
    transferValidator,
    cancelTaskValidator,
    completeTaskValidator,
    refreshTokenValidator
};
