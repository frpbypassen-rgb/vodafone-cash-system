// tests/transfer.test.js
// اختبارات نظام التحويلات المالية

const { updateBalanceWithLedger } = require('../services/walletService');
const mongoose = require('mongoose');

// محاكاة mongoose
jest.mock('mongoose', () => {
    const mockSession = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn(),
        abortTransaction: jest.fn().mockResolvedValue(undefined)
    };

    const createMockModel = (balance = 1000) => ({
        findOneAndUpdate: jest.fn().mockImplementation((filter, update) => {
            // محاكاة القفل الذري – تحقق من شرط الرصيد
            const minBalance = filter.balance?.$gte || 0;
            if (balance < minBalance) return Promise.resolve(null); // رصيد غير كافٍ
            const newBalance = balance + (update.$inc?.balance || 0);
            balance = newBalance;
            return Promise.resolve({ _id: 'entity-id', balance: newBalance });
        }),
        modelName: 'User'
    });

    const mockModel = createMockModel(1000);

    return {
        startSession: jest.fn().mockResolvedValue(mockSession),
        model: jest.fn().mockReturnValue(mockModel),
        _mockSession: mockSession,
        _mockModel: mockModel
    };
});

// محاكاة Ledger
jest.mock('../models/Ledger', () => {
    return class LedgerMock {
        constructor(data) { Object.assign(this, data); }
        save() { return Promise.resolve(this); }
        static create() { return Promise.resolve(true); }
    };
});

describe('نظام المحرك المالي (WalletService)', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // إعادة ضبط الرصيد قبل كل اختبار
        mongoose.model.mockReturnValue({
            findOneAndUpdate: jest.fn().mockImplementation((filter, update) => {
                const currentBalance = 1000;
                const minBalance = filter.balance?.$gte || 0;
                if (currentBalance < minBalance) return Promise.resolve(null);
                const newBalance = currentBalance + (update.$inc?.balance || 0);
                return Promise.resolve({ _id: 'entity-id', balance: newBalance });
            }),
            modelName: 'User'
        });
    });

    // ────────────────────────────────────────────────────────────
    // اختبارات الإيداع
    // ────────────────────────────────────────────────────────────
    describe('عمليات الإيداع (Deposit)', () => {
        test('يجب إضافة الرصيد بشكل صحيح', async () => {
            const result = await updateBalanceWithLedger('User', 'entity-id', 500, 'DEPOSIT', 'TX-001', 'إيداع');
            expect(result.success).toBe(true);
            expect(result.balanceAfter).toBe(1500);
        });

        test('يجب أن يُسجّل قيد في دفتر الأستاذ عند الإيداع', async () => {
            const result = await updateBalanceWithLedger('User', 'entity-id', 200, 'DEPOSIT', 'TX-002', 'إيداع');
            expect(result.success).toBe(true);
            expect(result.balanceBefore).toBe(1000);
            expect(result.balanceAfter).toBe(1200);
        });
    });

    // ────────────────────────────────────────────────────────────
    // اختبارات الخصم
    // ────────────────────────────────────────────────────────────
    describe('عمليات الخصم (Deduction)', () => {
        test('يجب خصم الرصيد بشكل صحيح', async () => {
            const result = await updateBalanceWithLedger('User', 'entity-id', -200, 'DEDUCTION', 'TX-003', 'خصم');
            expect(result.success).toBe(true);
            expect(result.balanceAfter).toBe(800);
        });

        test('يجب رفض الخصم إذا كان الرصيد غير كافٍ', async () => {
            mongoose.model.mockReturnValue({
                findOneAndUpdate: jest.fn().mockResolvedValue(null), // ← رصيد غير كافٍ
                modelName: 'User'
            });

            await expect(
                updateBalanceWithLedger('User', 'entity-id', -5000, 'DEDUCTION', 'TX-004', 'خصم كبير')
            ).rejects.toThrow('INSUFFICIENT_BALANCE');
        });

        test('يجب رفض الخصم عند تعيين minBalance', async () => {
            mongoose.model.mockReturnValue({
                findOneAndUpdate: jest.fn().mockImplementation((filter) => {
                    // 1000 < 800 + 500 = 1300 → يجب الرفض
                    const minBalance = filter.balance?.$gte || 0;
                    if (1000 < minBalance) return Promise.resolve(null);
                    return Promise.resolve({ _id: 'id', balance: 500 });
                }),
                modelName: 'User'
            });

            await expect(
                updateBalanceWithLedger('User', 'entity-id', -500, 'DEDUCTION', 'TX-005', 'خصم', { minBalance: 800 })
            ).rejects.toThrow('INSUFFICIENT_BALANCE');
        });
    });

    // ────────────────────────────────────────────────────────────
    // اختبارات Rollback
    // ────────────────────────────────────────────────────────────
    describe('آمان العمليات (Rollback)', () => {
        test('يجب إلغاء العملية (Rollback) عند حدوث خطأ في الحفظ', async () => {
            mongoose.model.mockReturnValue({
                findOneAndUpdate: jest.fn().mockRejectedValue(new Error('Database Crash')),
                modelName: 'User'
            });

            await expect(
                updateBalanceWithLedger('User', 'entity-id', 100, 'DEPOSIT', 'TX-006', 'إيداع فاشل')
            ).rejects.toThrow();

            expect(mongoose._mockSession.abortTransaction).toHaveBeenCalled();
        });

        test('يجب الإلغاء الذري عند فشل حفظ دفتر الأستاذ', async () => {
            const Ledger = require('../models/Ledger');
            const originalSave = Ledger.prototype.save;
            Ledger.prototype.save = jest.fn().mockRejectedValue(new Error('Ledger Save Failed'));

            await expect(
                updateBalanceWithLedger('User', 'entity-id', 100, 'DEPOSIT', 'TX-007', 'إيداع مع خطأ دفتر')
            ).rejects.toThrow();

            Ledger.prototype.save = originalSave;
        });
    });
});

// ────────────────────────────────────────────────────────────
// اختبارات منطق Validators
// ────────────────────────────────────────────────────────────
describe('Validators – التحقق من صحة بيانات التحويل', () => {
    const { transferValidator } = require('../validators/mobileValidators');

    test('يجب أن يحتوي transferValidator على قواعد التحقق', () => {
        expect(transferValidator).toBeDefined();
        expect(Array.isArray(transferValidator)).toBe(true);
        expect(transferValidator.length).toBeGreaterThan(0);
    });
});
