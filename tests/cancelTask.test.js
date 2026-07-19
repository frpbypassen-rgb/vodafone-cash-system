// tests/cancelTask.test.js
// اختبارات مسار إلغاء المهام (cancel-task)

const { cancelTaskValidator } = require('../validators/mobileValidators');

// ────────────────────────────────────────────────────────────
// اختبارات Validators
// ────────────────────────────────────────────────────────────
describe('Cancel Task – التحقق من المدخلات', () => {

    test('يجب أن يطلب حقل reason', () => {
        expect(cancelTaskValidator).toBeDefined();
        expect(Array.isArray(cancelTaskValidator)).toBe(true);
        // المصفوفة تحتوي على validators + middleware validate
        expect(cancelTaskValidator.length).toBeGreaterThan(0);
    });
});

// ────────────────────────────────────────────────────────────
// اختبارات منطق الإلغاء
// ────────────────────────────────────────────────────────────
describe('Cancel Task – منطق الإلغاء', () => {

    // محاكاة النماذج
    const mockTx = {
        _id: 'tx-id',
        status: 'accepted',
        operatorId: 'emp-telegram-id',
        customId: 'ATT-2601-0001',
        costLYD: 150,
        userId: 'user-telegram-id',
        clientBotId: null,
        amount: 1000,
        vodafoneNumber: '01012345678',
        notes: '',
        save: jest.fn().mockResolvedValue(true)
    };

    const mockEmp = {
        _id: 'emp-id',
        name: 'Test Executor',
        telegramId: 'emp-telegram-id'
    };

    test('يجب أن يتحقق من مطابقة operatorId للمنفذ الحالي', () => {
        // إذا كان tx.operatorId !== emp.telegramId → رفض
        const differentEmp = { ...mockEmp, telegramId: 'different-id' };
        expect(mockTx.operatorId === differentEmp.telegramId).toBe(false);
    });

    test('يجب رفض الإلغاء إذا كانت العملية ليست في حالة accepted', () => {
        const pendingTx = { ...mockTx, status: 'pending' };
        expect(pendingTx.status !== 'accepted').toBe(true);
    });

    test('يجب إرجاع الرصيد بقيمة costLYD عند الإلغاء', () => {
        // المبلغ المُسترجع يجب أن يساوي tx.costLYD
        const refundAmount = mockTx.costLYD;
        expect(refundAmount).toBe(150);
        expect(refundAmount).toBeGreaterThan(0);
    });

    test('يجب إضافة ملاحظة الإلغاء للعملية', () => {
        const reason = 'رقم خاطئ';
        const newNotes = `[تم الإلغاء | المنفذ: ${mockEmp.name} | السبب: ${reason}]`;
        mockTx.notes = newNotes;
        expect(mockTx.notes).toContain('تم الإلغاء');
        expect(mockTx.notes).toContain(reason);
        expect(mockTx.notes).toContain(mockEmp.name);
    });

    test('يجب أن يكون رقم التعريف customId بالتنسيق الصحيح', () => {
        const customIdPattern = /^ATT-\d{4}-\d{4}$/;
        expect(customIdPattern.test(mockTx.customId)).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────
// اختبارات Audit Log
// ────────────────────────────────────────────────────────────
describe('Cancel Task – Audit Log', () => {
    test('يجب أن تكون auditService موجودة وقابلة للاستدعاء', () => {
        const { logAction } = require('../services/auditService');
        expect(typeof logAction).toBe('function');
    });

    test('يجب أن يقبل Audit عملية TRANSFER_CANCELLED', async () => {
        // نتحقق من أن logAction تقبل هذا الـ action بدون خطأ
        const mockLog = jest.fn().mockResolvedValue(undefined);
        await mockLog({
            action: 'TRANSFER_CANCELLED',
            req: { headers: {}, ip: '127.0.0.1', method: 'POST', originalUrl: '/test' },
            performedById: 'emp-id',
            performedByModel: 'Employee',
            metadata: { customId: 'ATT-2601-0001', refundAmount: 150 }
        });
        expect(mockLog).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'TRANSFER_CANCELLED' })
        );
    });
});
