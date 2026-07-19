// tests/mobileTransferContract.test.js
// ===============================================
// 🧪 Contract Tests — عمليات التحويل (Transfer)
// ===============================================
'use strict';

const crypto = require('crypto');
const request = require('supertest');
const express = require('express');

jest.mock('express-rate-limit', () => () => (req, res, next) => next());

jest.mock('mongoose', () => {
    const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        abortTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn()
    };
    const SchemaMock = jest.fn().mockImplementation(function() { return { index: jest.fn(), pre: jest.fn(), post: jest.fn() }; });
    SchemaMock.Types = { ObjectId: String, Mixed: Object };
    return {
        startSession: jest.fn().mockResolvedValue(session),
        model: jest.fn().mockReturnValue({}),
        Schema: SchemaMock,
        _session: session
    };
});

jest.mock('../models/User', () => {
    const M = jest.fn();
    M.findById = jest.fn();
    M.findOne = jest.fn();
    M.findOneAndUpdate = jest.fn();
    M.modelName = 'User';
    return M;
});

jest.mock('../models/ClientEmployee', () => {
    const M = jest.fn();
    M.findById = jest.fn();
    M.modelName = 'ClientEmployee';
    return M;
});

jest.mock('../models/ClientBot', () => {
    const M = jest.fn();
    M.findById = jest.fn();
    M.findByIdAndUpdate = jest.fn();
    M.findOneAndUpdate = jest.fn();
    M.modelName = 'ClientBot';
    return M;
});

jest.mock('../models/Employee', () => {
    const M = jest.fn();
    M.findOne = jest.fn();
    M.findById = jest.fn();
    M.modelName = 'Employee';
    return M;
});

jest.mock('../models/ExecutorBot', () => {
    const M = jest.fn();
    M.findById = jest.fn();
    M.findByIdAndUpdate = jest.fn();
    return M;
});

jest.mock('../models/Admin', () => {
    const M = jest.fn();
    M.find = jest.fn().mockResolvedValue([]);
    return M;
});

jest.mock('../models/Settings', () => ({
    findOne: jest.fn()
}));

jest.mock('../models/Counter', () => ({
    findOneAndUpdate: jest.fn().mockResolvedValue({ value: 1001 })
}));

jest.mock('../models/Transaction', () => {
    const M = jest.fn().mockImplementation((data) => ({
        ...data,
        _id: 'new-tx-id',
        save: jest.fn().mockResolvedValue(true)
    }));
    M.findOne = jest.fn();
    M.findById = jest.fn();
    M.findByIdAndUpdate = jest.fn();
    M.findOneAndUpdate = jest.fn();
    return M;
});

jest.mock('../models/Ledger', () => {
    const M = jest.fn().mockImplementation((data) => ({
        ...data,
        save: jest.fn().mockResolvedValue(true)
    }));
    return M;
});
jest.mock('../models/JournalEvent', () => {
    const M = jest.fn().mockImplementation((data) => ({
        ...data,
        save: jest.fn().mockResolvedValue(true)
    }));
    M.findOne = jest.fn().mockImplementation(() => ({
        sort: jest.fn().mockImplementation(() => ({
            session: jest.fn().mockResolvedValue(null)
        }))
    }));
    return M;
});

jest.mock('../middlewares/jwtAuth', () => ({
    JWT_SECRET: 'test-secret-key-that-is-long-enough-32chars',
    JWT_REFRESH_SECRET: 'test-refresh-secret-key-long-enough-32chars',
    authenticateJWT: (req, res, next) => {
        req.user = { userId: 'user-id-123', accountType: 'client_user', telegramId: '99887766' };
        next();
    }
}));

jest.mock('../services/auditService', () => ({
    logAction: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../utils/logger', () => ({
    error: jest.fn(),
    financial: jest.fn(),
    security: jest.fn(),
    audit: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
}));

// jest.mock('telegraf') removed after Telegram purge

const User = require('../models/User');
const Settings = require('../models/Settings');
const Transaction = require('../models/Transaction');
const Ledger = require('../models/Ledger');
const { logAction } = require('../services/auditService');

const app = express();
app.use(express.json());
app.use(require('../routes/mobileApi'));

const uuid = '550e8400-e29b-41d4-a716-446655440000';

const chainResolve = (value) => ({
    session: jest.fn().mockResolvedValue(value)
});

const fingerprintFor = (payload, userId = 'user-id-123', accountType = 'client_user') => {
    const normalized = {
        userId,
        accountType,
        transferType: payload.transferType,
        amount: Number(Number(payload.amount).toFixed(3)),
        number: payload.number,
        name: payload.name || null,
        notes: payload.notes || null
    };
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
};

const validPayload = {
    amount: 100,
    number: '01012345678',
    transferType: 'vodafone',
    name: 'مستفيد اختبار',
    notes: 'ملاحظة اختبار'
};

describe('💸 Contract Tests: Transfer (Mobile API)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Settings.findOne.mockReturnValue(chainResolve({
            rateLevel1: 6.40,
            rateLevel2: 6.45,
            rateLevel3: 6.50,
            isManualClosed: false
        }));
        User.findById.mockReturnValue(chainResolve({
            _id: 'user-id-123',
            telegramId: '99887766',
            balance: 5000,
            balances: { EGP: 5000, LYD: 5000, USD: 5000, EUR: 5000, SAR: 5000 },
            tier: 2,
            creditLimit: 0,
            name: 'Client User'
        }));
        User.findOneAndUpdate.mockResolvedValue({ balance: 4984.496, balances: { EGP: 4984.496, LYD: 4984.496, USD: 4984.496, EUR: 4984.496, SAR: 4984.496 } });
        Transaction.findOne.mockReturnValue(chainResolve(null));
    });

    test('T022: rejects POST /client/new-transfer without Idempotency-Key', async () => {
        const res = await request(app)
            .post('/client/new-transfer')
            .send(validPayload);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
        expect(res.body.correlationId).toBeDefined();
    });

    test('T076: rejects malformed Idempotency-Key before touching financial data', async () => {
        const res = await request(app)
            .post('/client/new-transfer')
            .set('Idempotency-Key', 'not-a-uuid')
            .send(validPayload);

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(Transaction).not.toHaveBeenCalled();
    });

    test('T023 & T025: accepts transferType=vodafone and returns complete transfer DTO', async () => {
        const res = await request(app)
            .post('/client/new-transfer')
            .set('Idempotency-Key', uuid)
            .send(validPayload);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            code: 'SUCCESS',
            txId: 'ATT-2606-1001',
            status: 'pending',
            exchangeRate: 6.45,
            newBalance: 4984.496
        });
        expect(res.body.costLYD).toBeCloseTo(15.504, 3);
        expect(res.body.serverTime).toBeDefined();
        expect(Transaction).toHaveBeenCalledTimes(1);
        expect(Transaction.mock.calls[0][0]).toMatchObject({
            idempotencyKey: uuid,
            idempotencyFingerprint: fingerprintFor(validPayload),
            transferType: 'vodafone',
            vodafoneNumber: '01012345678',
            amount: 100,
            exchangeRate: 6.45,
            costLYD: 15.504,
            status: 'pending'
        });
        expect(Ledger).toHaveBeenCalledTimes(1);
        expect(Ledger.mock.calls[0][0].description).toContain('ATT-2606-1001');
        expect(Ledger.mock.calls[0][0].description).not.toContain(validPayload.number);
        expect(logAction).toHaveBeenCalledTimes(1);
        const auditPayload = logAction.mock.calls[0][0];
        expect(auditPayload.newData.number).toBeUndefined();
        expect(auditPayload.newData.notes).toBeUndefined();
        expect(auditPayload.newData.idempotencyKey).toBeUndefined();
    });

    test('T024: rejects Arabic legacy transferType values', async () => {
        const res = await request(app)
            .post('/client/new-transfer')
            .set('Idempotency-Key', '550e8400-e29b-41d4-a716-446655440001')
            .send({
                amount: 100,
                number: '01012345678',
                transferType: 'كاش'
            });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(Transaction).not.toHaveBeenCalled();
    });

    test('T026: same Idempotency-Key and same payload returns replay without creating a new transaction', async () => {
        Transaction.findOne.mockReturnValue(chainResolve({
            customId: 'ATT-2606-1001',
            status: 'pending',
            costLYD: 15.504,
            exchangeRate: 6.45,
            idempotencyFingerprint: fingerprintFor(validPayload),
            idempotencyResponse: {
                code: 'SUCCESS',
                message: 'تم إرسال طلبك بنجاح',
                txId: 'ATT-2606-1001',
                status: 'pending',
                costLYD: 15.504,
                exchangeRate: 6.45,
                newBalance: 4984.496,
                serverTime: '2026-06-04T00:00:00.000Z'
            }
        }));

        const res = await request(app)
            .post('/client/new-transfer')
            .set('Idempotency-Key', uuid)
            .send(validPayload);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.code).toBe('DUPLICATE_REPLAYED');
        expect(res.body.txId).toBe('ATT-2606-1001');
        expect(res.body.newBalance).toBe(4984.496);
        expect(Transaction).not.toHaveBeenCalled();
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(Ledger).not.toHaveBeenCalled();
    });

    test('T027: same Idempotency-Key with different payload returns IDEMPOTENCY_CONFLICT', async () => {
        Transaction.findOne.mockReturnValue(chainResolve({
            customId: 'ATT-2606-1001',
            idempotencyFingerprint: fingerprintFor({ ...validPayload, amount: 200 })
        }));

        const res = await request(app)
            .post('/client/new-transfer')
            .set('Idempotency-Key', uuid)
            .send(validPayload);

        expect(res.status).toBe(409);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
        expect(Transaction).not.toHaveBeenCalled();
        expect(User.findOneAndUpdate).not.toHaveBeenCalled();
        expect(Ledger).not.toHaveBeenCalled();
    });
});
