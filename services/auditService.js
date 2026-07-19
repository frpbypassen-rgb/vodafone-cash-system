// services/auditService.js
// خدمة التدقيق المركزية — تُستدعى من أي مسار لتسجيل العمليات الحساسة
'use strict';

const AuditLog = require('../models/AuditLog');

/**
 * تسجيل عملية في سجل التدقيق
 *
 * @param {Object} params
 * @param {string}  params.action           - نوع العملية (من enum AuditLog.action)
 * @param {Object}  params.req              - كائن الطلب Express (لاستخراج IP و UserAgent)
 * @param {string}  [params.performedById]  - معرّف من قام بالعملية
 * @param {string}  [params.performedByModel] - نوع الكيان (Employee / ClientEmployee / User / Admin)
 * @param {string}  [params.performedByName]  - اسم من قام بالعملية
 * @param {string}  [params.targetId]       - معرّف الجهة المستهدفة
 * @param {string}  [params.targetModel]    - نوع الكيان المستهدف
 * @param {Object}  [params.oldData]        - البيانات قبل التغيير
 * @param {Object}  [params.newData]        - البيانات بعد التغيير
 * @param {Object}  [params.metadata]       - بيانات إضافية
 * @param {boolean} [params.success=true]   - هل نجحت العملية؟
 * @param {string}  [params.errorCode]      - كود الخطأ في حالة الفشل
 * @returns {Promise<void>}
 */
const logAction = async (params) => {
    try {
        const {
            action,
            req,
            performedById,
            performedByModel,
            performedByName,
            targetId,
            targetModel,
            oldData,
            newData,
            metadata,
            success = true,
            errorCode
        } = params;

        const ipAddress = req
            ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown')
            : 'system';

        const userAgent = req ? req.headers['user-agent'] : 'system';
        const endpoint = req ? `${req.method} ${req.originalUrl}` : null;

        // التنفيذ بشكل غير متزامن لكي لا يبطئ الرد الرئيسي
        const entry = new AuditLog({
            action,
            performedBy: performedById || null,
            performedByModel: performedByModel || 'System',
            performedByName: performedByName || 'System',
            targetId: targetId || null,
            targetModel: targetModel || null,
            ipAddress,
            userAgent,
            endpoint,
            oldData: oldData ? sanitizeData(oldData) : undefined,
            newData: newData ? sanitizeData(newData) : undefined,
            metadata,
            success,
            errorCode
        });

        await entry.save();
    } catch (err) {
        // لا نرمي الخطأ — فشل التسجيل لا يجب أن يوقف العملية الأصلية
        console.error('⚠️ [AuditService] فشل في تسجيل التدقيق:', err.message);
    }
};

/**
 * إزالة الحقول الحساسة من البيانات قبل تسجيلها
 */
const sanitizeData = (data) => {
    if (!data || typeof data !== 'object') return data;
    const sensitiveFields = ['password', 'webPassword', 'refreshToken', 'token', 'secret'];
    const cleaned = { ...data };
    for (const field of sensitiveFields) {
        if (cleaned[field] !== undefined) {
            cleaned[field] = '[REDACTED]';
        }
    }
    return cleaned;
};

/**
 * استرجاع سجل التدقيق لجهة معينة
 * @param {string} entityId - معرّف الجهة
 * @param {Object} [options]
 * @param {number} [options.limit=50]
 * @param {number} [options.skip=0]
 * @param {string} [options.action] - فلتر نوع العملية
 */
const getAuditLogs = async (entityId, options = {}) => {
    const { limit = 50, skip = 0, action } = options;
    const filter = {
        $or: [{ performedBy: entityId }, { targetId: entityId }]
    };
    if (action) filter.action = action;

    return AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
};

module.exports = { logAction, getAuditLogs };
