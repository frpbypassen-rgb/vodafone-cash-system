// tests/wallet.test.js
const { updateBalanceWithLedger } = require('../services/walletService');
const mongoose = require('mongoose');

// محاكاة قاعدة بيانات MongoDB — تدعم findOneAndUpdate الذري
jest.mock('mongoose', () => {
    const mockSession = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn(),
        abortTransaction: jest.fn().mockResolvedValue(undefined)
    };

    let currentBalance = 1000;

    const mockModel = {
        modelName: 'User',
        findOneAndUpdate: jest.fn().mockImplementation((filter, update) => {
            const minRequired = filter.balance?.$gte;
            if (minRequired !== undefined && currentBalance < minRequired) {
                return Promise.resolve(null); // رصيد غير كافٍ
            }
            const increment = update.$inc?.balance || 0;
            currentBalance += increment;
            return Promise.resolve({ _id: '12345', balance: currentBalance });
        })
    };

    return {
        startSession: jest.fn().mockResolvedValue(mockSession),
        model: jest.fn().mockReturnValue(mockModel),
        _mockSession: mockSession,
        _mockModel: mockModel,
        _resetBalance: () => { currentBalance = 1000; }
    };
});

// محاكاة نموذج دفتر الأستاذ
jest.mock('../models/Ledger', () => {
    return class LedgerMock {
        constructor(data) { Object.assign(this, data); }
        save() { return Promise.resolve(this); }
        static create() { return Promise.resolve(true); }
    };
});

describe('Financial Engine (Double Entry Ledger) Tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // إعادة الرصيد إلى 1000 قبل كل اختبار
        mongoose._resetBalance();

        // إعادة ضبط mock model لكل اختبار
        let bal = 1000;
        mongoose.model.mockReturnValue({
            modelName: 'User',
            findOneAndUpdate: jest.fn().mockImplementation((filter, update) => {
                const minReq = filter.balance?.$gte;
                if (minReq !== undefined && bal < minReq) return Promise.resolve(null);
                bal += (update.$inc?.balance || 0);
                return Promise.resolve({ _id: '12345', balance: bal });
            })
        });
    });

    test('يجب أن يقوم بإضافة الرصيد بشكل صحيح (Deposit)', async () => {
        const result = await updateBalanceWithLedger('User', '12345', 500, 'DEPOSIT', 'TX-001', 'إيداع تجريبي');
        expect(result.success).toBe(true);
        expect(result.balanceAfter).toBe(1500);
        expect(mongoose._mockSession.commitTransaction).toHaveBeenCalled();
    });

    test('يجب أن يقوم بخصم الرصيد بشكل صحيح (Deduction)', async () => {
        const result = await updateBalanceWithLedger('User', '12345', -200, 'DEDUCTION', 'TX-002', 'خصم تجريبي');
        expect(result.success).toBe(true);
        expect(result.balanceAfter).toBe(800);
    });

    test('يجب أن يلغي العملية (Rollback) إذا حدث خطأ أثناء الحفظ', async () => {
        mongoose.model.mockReturnValue({
            modelName: 'User',
            findOneAndUpdate: jest.fn().mockRejectedValue(new Error('Database Crash'))
        });

        await expect(
            updateBalanceWithLedger('User', '12345', 100, 'DEPOSIT', 'TX-003', 'إيداع سيفشل')
        ).rejects.toThrow('Database Crash');

        expect(mongoose._mockSession.abortTransaction).toHaveBeenCalled();
    });
});
