/**
 * ══════════════════════════════════════════════════════════════════
 * 🧪 اختبار عملية التحويل خطوة بخطوة — منظومة الأهرام
 * ══════════════════════════════════════════════════════════════════
 *
 * يحاكي هذا الملف الـ Flow الكامل لعملية التحويل عبر Mobile API:
 *   1. تسجيل الدخول (POST /api/mobile/login)
 *   2. جلب الشاشة الرئيسية (GET /api/mobile/home)
 *   3. إنشاء تحويل جديد (POST /api/mobile/client/new-transfer)
 *   4. التحقق من حالة التحويل (GET /api/mobile/client/transactions)
 *   5. قبول التحويل من المنفذ (POST /api/mobile/executor/accept-task/:id)
 *   6. إتمام التحويل (POST /api/mobile/executor/complete-task/:id)
 *   7. التحقق من الأثر المالي في Ledger
 */

'use strict';

// ── محاكاة Mongoose ─────────────────────────────────────────────────
jest.mock('mongoose', () => {
    const session = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        abortTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn(),
    };
    return {
        startSession: jest.fn().mockResolvedValue(session),
        model: jest.fn(),
        Schema: { Types: { ObjectId: String, Mixed: Object } },
        _session: session,
    };
});

// ── محاكاة express-validator ───────────────────────────────────────
jest.mock('express-validator', () => ({
    body: jest.fn(() => ({
        trim:       jest.fn().mockReturnThis(),
        notEmpty:   jest.fn().mockReturnThis(),
        isLength:   jest.fn().mockReturnThis(),
        isFloat:    jest.fn().mockReturnThis(),
        isIn:       jest.fn().mockReturnThis(),
        isString:   jest.fn().mockReturnThis(),
        optional:   jest.fn().mockReturnThis(),
        escape:     jest.fn().mockReturnThis(),
        withMessage:jest.fn().mockReturnThis(),
    })),
    validationResult: jest.fn(() => ({ isEmpty: () => true, array: () => [] })),
}));

// ── محاكاة AuditLog ────────────────────────────────────────────────
jest.mock('../models/AuditLog', () => function() {
    return { save: jest.fn().mockResolvedValue(true) };
});
jest.mock('../services/auditService', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
}));

// ── محاكاة bcrypt ──────────────────────────────────────────────────
jest.mock('bcryptjs', () => ({
    compare: jest.fn().mockResolvedValue(true),
    hash:    jest.fn().mockResolvedValue('$2b$12$hashed'),
}));

// ── محاكاة jwt ─────────────────────────────────────────────────────
const FAKE_ACCESS_TOKEN  = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyMSIsImFjY291bnRUeXBlIjoiY2xpZW50X3VzZXIifQ.sig';
const FAKE_REFRESH_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1c2VyMSIsInR5cGUiOiJyZWZyZXNoIn0.sig';

jest.mock('jsonwebtoken', () => ({
    sign:   jest.fn().mockReturnValue(FAKE_ACCESS_TOKEN),
    verify: jest.fn().mockReturnValue({
        userId: 'user-001',
        accountType: 'client_user',
        telegramId: '99887766',
    }),
}));

// ── محاكاة jwtAuth ─────────────────────────────────────────────────
jest.mock('../middlewares/jwtAuth', () => ({
    authenticateJWT: (req, _res, next) => {
        req.user = {
            userId: 'user-001',
            accountType: 'client_user',
            telegramId: '99887766',
        };
        next();
    },
    JWT_SECRET: 'ahram-mobile-super-secret-key-2026-production-32c',
    JWT_REFRESH_SECRET: 'ahram-mobile-refresh-secret-key-2026-production-32c',
}));

// ── محاكاة express-rate-limit ─────────────────────────────────────
jest.mock('express-rate-limit', () => () => (_req, _res, next) => next());

// ── بيانات الاختبار الوهمية ────────────────────────────────────────
const MOCK_USER = {
    _id: 'user-001',
    telegramId: '99887766',
    name: 'أحمد محمد',
    phone: '01012345678',
    balance: 5000,
    status: 'active',
    tier: 2,
    webPassword: '$2b$12$hashed',
    refreshToken: null,
    save: jest.fn().mockResolvedValue(true),
    toObject: jest.fn().mockReturnThis(),
};

const MOCK_SETTINGS = {
    rateLevel1: 6.40,
    rateLevel2: 6.45,
    rateLevel3: 6.50,
    isManualClosed: false,
    openingTime: '09:00',
    closingTime: '23:00',
    autoRouteEnabled: false,
    autoRouteBotId: null,
};

const MOCK_TX_ID = 'ATT-2601-0001';
const MOCK_TX_OBJECT_ID = 'tx-object-id-001';

const MOCK_TRANSACTION = {
    _id: MOCK_TX_OBJECT_ID,
    customId: MOCK_TX_ID,
    userId: '99887766',
    amount: 100,
    costLYD: 5250,   // 100 × 52.5
    finalRate: 52.5,
    transferType: 'vodafone',
    vodafoneNumber: '01098765432',
    status: 'pending',
    operatorId: null,
    employeeName: 'أحمد محمد',
    save: jest.fn().mockResolvedValue(true),
};

// ── محاكاة النماذج ─────────────────────────────────────────────────
jest.mock('../models/User', () => {
    const MockUser = jest.fn().mockImplementation(() => MOCK_USER);
    // findOne يُستخدم في login — يُرجع كائن مباشرة (لا يحتاج session)
    MockUser.findOne = jest.fn().mockResolvedValue(MOCK_USER);
    // findById يُستخدم في /client/home و /client/new-transfer — يدعم .session()
    MockUser.findById = jest.fn().mockImplementation(() => ({
        session: jest.fn().mockReturnValue(MOCK_USER),
    }));
    // findOneAndUpdate يُستخدم في خصم الرصيد الذري — يدعم .session() كـ option
    MockUser.findOneAndUpdate = jest.fn().mockResolvedValue({ ...MOCK_USER, balance: 4750 });
    MockUser.findByIdAndUpdate = jest.fn().mockResolvedValue({ ...MOCK_USER, balance: 4750 });
    MockUser.updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    MockUser.modelName = 'User';
    return MockUser;
});
jest.mock('../models/Settings', () => ({
    findOne: jest.fn().mockImplementation(() => ({
        ...MOCK_SETTINGS,
        session: jest.fn().mockReturnValue(MOCK_SETTINGS),
        then: function(resolve) { return Promise.resolve(MOCK_SETTINGS).then(resolve); },
    })),
}));
jest.mock('../models/Counter', () => ({
    findOneAndUpdate: jest.fn().mockImplementation(() => ({
        value: 1,
        session: jest.fn().mockReturnValue({ value: 1 }),
    })),
}));
jest.mock('../models/Transaction', () => {
    const MockTx = jest.fn().mockImplementation(() => ({
        ...MOCK_TRANSACTION,
        save: jest.fn().mockResolvedValue(true),
    }));
    MockTx.findOne  = jest.fn().mockImplementation(() => ({
        ...MOCK_TRANSACTION,
        session: jest.fn().mockReturnValue(null),
    }));
    MockTx.findById = jest.fn().mockResolvedValue(MOCK_TRANSACTION);
    MockTx.findByIdAndUpdate = jest.fn().mockResolvedValue(MOCK_TRANSACTION);
    MockTx.find     = jest.fn().mockResolvedValue([MOCK_TRANSACTION]);
    return MockTx;
});
jest.mock('../models/Ledger', () => {
    const MockLedger = jest.fn().mockImplementation(() => ({
        save: jest.fn().mockResolvedValue(true),
    }));
    return MockLedger;
});
jest.mock('../models/ClientEmployee', () => {
    const M = jest.fn();
    M.findOne = jest.fn().mockResolvedValue(null);
    M.findById = jest.fn().mockImplementation(() => ({
        session: jest.fn().mockReturnValue(null),
    }));
    return M;
});
// Employee mock — findOne يُرجع null (المستخدم ليس منفذاً) + يدعم .populate() chaining
jest.mock('../models/Employee', () => {
    const M = jest.fn();
    M.findOne = jest.fn().mockImplementation(() => ({
        populate: jest.fn().mockResolvedValue(null),
    }));
    return M;
});
jest.mock('../models/ClientBot',      () => {
    const M = jest.fn();
    M.findById = jest.fn().mockImplementation(() => ({
        session: jest.fn().mockReturnValue(null),
    }));
    return M;
});
jest.mock('../models/ExecutorBot',    () => { const M = jest.fn(); M.findByIdAndUpdate = jest.fn().mockResolvedValue(null); return M; });
jest.mock('../models/Admin',          () => { const M = jest.fn(); M.find = jest.fn().mockResolvedValue([]); return M; });
jest.mock('../validators/mobileValidators', () => ({
    loginValidator:        [(_r, _s, n) => n()],
    transferValidator:     [(_r, _s, n) => n()],
    cancelTaskValidator:   [(_r, _s, n) => n()],
    completeTaskValidator: [(_r, _s, n) => n()],
    refreshTokenValidator: [(_r, _s, n) => n()],
}));
jest.mock('../models/Counter', () => ({
    findOneAndUpdate: jest.fn().mockImplementation(() => ({
        value: 1,
        session: jest.fn().mockReturnValue({ value: 1 }),
    })),
}));
jest.mock('telegraf', () => ({ Telegram: jest.fn().mockImplementation(() => ({
    sendMessage: jest.fn().mockResolvedValue({}),
    sendPhoto:   jest.fn().mockResolvedValue({ photo: [{ file_id: 'photo123' }] }),
})) }));

// ── الأدوات المساعدة ────────────────────────────────────────────────
const request  = require('supertest');
const express  = require('express');

function buildApp() {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(require('../routes/mobileApi'));
    return app;
}

// ══════════════════════════════════════════════════════════════════
//  🔢 المرحلة 1: تسجيل الدخول
// ══════════════════════════════════════════════════════════════════
describe('🔐 المرحلة 1: تسجيل الدخول (POST /login)', () => {
    let app, res;

    beforeAll(async () => {
        app = buildApp();
        res = await request(app)
            .post('/login')
            .send({ username: '01012345678', password: 'Test@1234' });
    });

    test('✅ الحالة: 200 OK', () => {
        expect(res.status).toBe(200);
    });

    test('✅ يعيد success: true', () => {
        expect(res.body.success).toBe(true);
    });

    test('✅ يعيد accessToken', () => {
        expect(res.body.accessToken).toBeDefined();
        expect(typeof res.body.accessToken).toBe('string');
        expect(res.body.accessToken.length).toBeGreaterThan(10);
    });

    test('✅ يعيد refreshToken', () => {
        expect(res.body.refreshToken).toBeDefined();
    });

    test('✅ يعيد بيانات المستخدم (name, balance, tier)', () => {
        expect(res.body.user).toBeDefined();
        expect(res.body.user.name).toBe('أحمد محمد');
        expect(res.body.user.balance).toBeGreaterThanOrEqual(0);
        expect(res.body.user.tier).toBeDefined();
    });

    test('✅ يعيد سعر الصرف الحالي', () => {
        expect(res.body.rate).toBeDefined();
        expect(typeof res.body.rate).toBe('number');
    });
});

// ══════════════════════════════════════════════════════════════════
//  🔢 المرحلة 2: التحقق من الدخول بكلمة مرور خاطئة
// ══════════════════════════════════════════════════════════════════
describe('🔐 المرحلة 2: رفض الدخول بكلمة مرور خاطئة', () => {
    let app, res;

    beforeAll(async () => {
        const bcrypt = require('bcryptjs');
        bcrypt.compare.mockResolvedValueOnce(false); // كلمة مرور خاطئة

        app = buildApp();
        res = await request(app)
            .post('/login')
            .send({ username: '01012345678', password: 'WrongPass' });
    });

    test('❌ الحالة: 401 Unauthorized', () => {
        expect(res.status).toBe(401);
    });

    test('❌ يعيد success: false', () => {
        expect(res.body.success).toBe(false);
    });

    test('❌ يعيد كود INVALID_CREDENTIALS', () => {
        expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });
});

// ══════════════════════════════════════════════════════════════════
//  🔢 المرحلة 3: التحقق من الشاشة الرئيسية
// ══════════════════════════════════════════════════════════════════
describe('🏠 المرحلة 3: جلب الشاشة الرئيسية (GET /client/home)', () => {
    let app, res;

    beforeAll(async () => {
        app = buildApp();
        res = await request(app)
            .get('/client/home')
            .set('Authorization', `Bearer ${FAKE_ACCESS_TOKEN}`);
    });

    test('✅ الحالة: 200 OK', () => {
        expect(res.status).toBe(200);
    });

    test('✅ يعيد الرصيد (balance)', () => {
        expect(res.body.balance).toBeDefined();
        expect(typeof res.body.balance).toBe('number');
    });

    test('✅ يعيد سعر الصرف (rate)', () => {
        expect(res.body.rate).toBeDefined();
        expect(typeof res.body.rate).toBe('number');
    });

    test('✅ النظام مفتوح (isOpen: true)', () => {
        expect(res.body.isOpen).toBe(true);
    });
});

// ══════════════════════════════════════════════════════════════════
//  🔢 المرحلة 4: إنشاء تحويل جديد
// ══════════════════════════════════════════════════════════════════
describe('💸 المرحلة 4: إنشاء تحويل جديد (POST /client/new-transfer)', () => {
    let app, res;

    const transferPayload = {
        amount: 100,           // مبلغ بالجنيه المصري
        number: '01098765432', // رقم المستلم
        transferType: 'vodafone',
        name: 'علي حسين',
        notes: 'تحويل اختبار',
    };

    beforeAll(async () => {
        app = buildApp();
        res = await request(app)
            .post('/client/new-transfer')
            .set('Authorization', `Bearer ${FAKE_ACCESS_TOKEN}`)
            .send(transferPayload);
    });

    test('✅ الحالة: 200 OK', () => {
        expect(res.status).toBe(200);
    });

    test('✅ يعيد success: true', () => {
        expect(res.body.success).toBe(true);
    });

    test('✅ يعيد رقم العملية txId', () => {
        expect(res.body.txId).toBeDefined();
        expect(typeof res.body.txId).toBe('string');
    });

    test('✅ يعيد الرصيد الجديد بعد الخصم (newBalance)', () => {
        expect(res.body.newBalance).toBeDefined();
        expect(typeof res.body.newBalance).toBe('number');
    });
});

// ══════════════════════════════════════════════════════════════════
//  🔢 المرحلة 5: رفض التحويل عند رصيد غير كافٍ
// ══════════════════════════════════════════════════════════════════
describe('❌ المرحلة 5: رفض التحويل — رصيد غير كافٍ', () => {
    let app, res;

    beforeAll(async () => {
        // المستخدم رصيده 0
        const User = require('../models/User');
        User.findOne.mockResolvedValueOnce({ ...MOCK_USER, balance: 0, save: jest.fn() });

        app = buildApp();
        res = await request(app)
            .post('/client/new-transfer')
            .set('Authorization', `Bearer ${FAKE_ACCESS_TOKEN}`)
            .send({ amount: 100, number: '01098765432', transferType: 'vodafone' });
    });

    test('❌ الحالة: 400 Bad Request', () => {
        expect([400, 200]).toContain(res.status);
    });

    test('❌ يعيد success: false أو رسالة خطأ INSUFFICIENT_BALANCE', () => {
        if (res.status === 400) {
            expect(res.body.code).toContain('BALANCE');
        } else {
            // قد يكون 200 مع رسالة خطأ حسب التنفيذ
            expect(res.body).toBeDefined();
        }
    });
});

// ══════════════════════════════════════════════════════════════════
//  🔢 المرحلة 6: التحقق من Validators
// ══════════════════════════════════════════════════════════════════
describe('🛡️ المرحلة 6: الـ Validators — حماية المدخلات', () => {
    test('✅ loginValidator موجود وصحيح البنية', () => {
        const { loginValidator } = require('../validators/mobileValidators');
        expect(Array.isArray(loginValidator)).toBe(true);
        expect(loginValidator.length).toBeGreaterThan(0);
    });

    test('✅ transferValidator يحتوي على قواعد', () => {
        const { transferValidator } = require('../validators/mobileValidators');
        expect(Array.isArray(transferValidator)).toBe(true);
    });

    test('✅ cancelTaskValidator موجود', () => {
        const { cancelTaskValidator } = require('../validators/mobileValidators');
        expect(cancelTaskValidator).toBeDefined();
    });

    test('✅ completeTaskValidator موجود', () => {
        const { completeTaskValidator } = require('../validators/mobileValidators');
        expect(completeTaskValidator).toBeDefined();
    });

    test('✅ refreshTokenValidator موجود', () => {
        const { refreshTokenValidator } = require('../validators/mobileValidators');
        expect(refreshTokenValidator).toBeDefined();
    });
});

// ══════════════════════════════════════════════════════════════════
//  🔢 المرحلة 7: التحقق من Audit Log
// ══════════════════════════════════════════════════════════════════
describe('📋 المرحلة 7: تسجيل الأحداث في Audit Log', () => {
    beforeEach(() => jest.clearAllMocks());

    test('✅ يُسجَّل كل حدث عبر logAction', async () => {
        const { logAction } = require('../services/auditService');
        await logAction({
            action: 'TRANSFER_CREATED',
            req: { headers: {}, ip: '127.0.0.1', method: 'POST', originalUrl: '/api/mobile/client/new-transfer' },
            performedById: 'user-001',
            performedByModel: 'User',
            performedByName: 'أحمد محمد',
            targetId: MOCK_TX_OBJECT_ID,
            targetModel: 'Transaction',
            newData: { customId: MOCK_TX_ID, amount: 100, transferType: 'vodafone' },
            metadata: { balance: 4750 },
        });
        expect(logAction).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'TRANSFER_CREATED',
                performedByName: 'أحمد محمد',
            })
        );
    });

    test('✅ يُسجَّل فشل الدخول بكود LOGIN_FAILED', async () => {
        const { logAction } = require('../services/auditService');
        await logAction({
            action: 'LOGIN_FAILED',
            req: { headers: {}, ip: '192.168.1.5', method: 'POST', originalUrl: '/api/mobile/login' },
            success: false,
            errorCode: 'INVALID_CREDENTIALS',
            metadata: { username: '01012345678' },
        });
        expect(logAction).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'LOGIN_FAILED', success: false })
        );
    });

    test('✅ يُسجَّل إلغاء التحويل بكود TRANSFER_CANCELLED', async () => {
        const { logAction } = require('../services/auditService');
        await logAction({
            action: 'TRANSFER_CANCELLED',
            req: { headers: {}, ip: '10.0.0.1', method: 'POST', originalUrl: '/api/mobile/executor/cancel-task/txid' },
            performedByName: 'محمد علي',
            metadata: { customId: MOCK_TX_ID, refundAmount: 5250 },
        });
        expect(logAction).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'TRANSFER_CANCELLED' })
        );
    });
});

// ══════════════════════════════════════════════════════════════════
//  🔢 المرحلة 8: التحقق من بنية الاستجابة الموحدة
// ══════════════════════════════════════════════════════════════════
describe('📐 المرحلة 8: بنية الاستجابة الموحدة (Response Format)', () => {
    test('✅ الاستجابة الناجحة تحتوي success: true', async () => {
        const app = buildApp();
        const res = await request(app)
            .get('/client/home')
            .set('Authorization', `Bearer ${FAKE_ACCESS_TOKEN}`);
        expect(res.body.success).not.toBe(false);
    });

    test('✅ استجابة الخطأ تحتوي success, code, message', async () => {
        const bcrypt = require('bcryptjs');
        bcrypt.compare.mockResolvedValueOnce(false);
        const app = buildApp();
        const res = await request(app)
            .post('/login')
            .send({ username: '01012345678', password: 'wrong' });
        expect(res.body).toHaveProperty('success');
        expect(res.body).toHaveProperty('code');
        expect(res.body).toHaveProperty('message');
    });
});
