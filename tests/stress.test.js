// tests/stress.test.js
// ====================================================
// 🔥 اختبار الضغط — 500+ عملية متزامنة
// يحاكي سيناريوهات الحمل العالي على المحرك المالي
// بدون الحاجة لتشغيل السيرفر أو قاعدة بيانات فعلية
// ====================================================

const { updateBalanceWithLedger } = require('../services/walletService');
const mongoose = require('mongoose');

// ────────────────────────────────────────────────────────────
// 🔧 محاكاة MongoDB مع دعم التزامن (Thread-Safe Mock)
// ────────────────────────────────────────────────────────────
jest.mock('mongoose', () => {
    const mockSession = {
        startTransaction: jest.fn(),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        endSession: jest.fn(),
        abortTransaction: jest.fn().mockResolvedValue(undefined)
    };

    // رصيد مشترك يحاكي الحالة الفعلية في قاعدة البيانات
    let sharedBalance = 100000; // 100,000 LYD
    let totalOperations = 0;
    let totalCommitted = 0;
    let totalAborted = 0;

    const mockModel = {
        modelName: 'User',
        findOneAndUpdate: jest.fn().mockImplementation((filter, update) => {
            totalOperations++;
            const minRequired = filter.balance?.$gte;
            const increment = update.$inc?.balance || 0;

            if (minRequired !== undefined && sharedBalance < minRequired) {
                totalAborted++;
                return Promise.resolve(null); // رصيد غير كافٍ
            }

            sharedBalance += increment;
            totalCommitted++;
            return Promise.resolve({ _id: 'stress-entity', balance: sharedBalance });
        })
    };

    return {
        startSession: jest.fn().mockResolvedValue(mockSession),
        model: jest.fn().mockReturnValue(mockModel),
        _mockSession: mockSession,
        _mockModel: mockModel,
        _getBalance: () => sharedBalance,
        _getStats: () => ({ totalOperations, totalCommitted, totalAborted }),
        _reset: () => {
            sharedBalance = 100000;
            totalOperations = 0;
            totalCommitted = 0;
            totalAborted = 0;
        }
    };
});

jest.mock('../models/Ledger', () => {
    let ledgerEntries = [];
    const LedgerMock = class {
        constructor(data) { Object.assign(this, data); }
        save() { ledgerEntries.push(this); return Promise.resolve(this); }
        static create(data) { ledgerEntries.push(data); return Promise.resolve(data); }
        static _getEntries() { return ledgerEntries; }
        static _reset() { ledgerEntries = []; }
    };
    return LedgerMock;
});

// ────────────────────────────────────────────────────────────
// 📊 أدوات قياس الأداء
// ────────────────────────────────────────────────────────────
function formatDuration(ms) {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

function generateReport(label, durations, successCount, failCount, startTime, endTime) {
    const total = successCount + failCount;
    const totalTime = endTime - startTime;
    const opsPerSecond = (total / (totalTime / 1000)).toFixed(1);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;

    return {
        label,
        totalOperations: total,
        successCount,
        failCount,
        successRate: `${((successCount / total) * 100).toFixed(1)}%`,
        totalTimeMs: totalTime,
        totalTimeFormatted: formatDuration(totalTime),
        opsPerSecond: parseFloat(opsPerSecond),
        avgResponseMs: parseFloat(avgDuration.toFixed(2)),
        p50Ms: parseFloat(percentile(durations, 50).toFixed(2)),
        p95Ms: parseFloat(percentile(durations, 95).toFixed(2)),
        p99Ms: parseFloat(percentile(durations, 99).toFixed(2)),
        maxMs: parseFloat(Math.max(...durations).toFixed(2)),
        minMs: parseFloat(Math.min(...durations).toFixed(2))
    };
}

// ====================================================
// 🔥 مجموعة اختبارات الضغط
// ====================================================
describe('🔥 اختبار الضغط — 500+ عملية متزامنة', () => {
    const allReports = [];

    beforeEach(() => {
        jest.clearAllMocks();
        mongoose._reset();
        require('../models/Ledger')._reset();

        // إعادة تسجيل الـ mock الافتراضي (يُحل مشكلة إعادة استخدام mock الأخطاء)
        let localBal = 100000;
        mongoose.model.mockReturnValue({
            modelName: 'User',
            findOneAndUpdate: jest.fn().mockImplementation((filter, update) => {
                const minRequired = filter.balance?.$gte;
                const increment = update.$inc?.balance || 0;
                if (minRequired !== undefined && localBal < minRequired) {
                    return Promise.resolve(null);
                }
                localBal += increment;
                return Promise.resolve({ _id: 'stress-entity', balance: localBal });
            })
        });
    });

    afterAll(() => {
        // طباعة التقرير النهائي
        console.log('\n');
        console.log('╔══════════════════════════════════════════════════════════════╗');
        console.log('║           📊 تقرير اختبار الضغط — Al-Ahram Pay            ║');
        console.log('╠══════════════════════════════════════════════════════════════╣');
        allReports.forEach(r => {
            console.log(`║ 🏷️  ${r.label.padEnd(50)} ║`);
            console.log(`║   العمليات: ${String(r.totalOperations).padEnd(8)} نجاح: ${r.successCount}  فشل: ${r.failCount}  (${r.successRate})${''.padEnd(Math.max(0, 12 - r.successRate.length))}║`);
            console.log(`║   الوقت الكلي: ${r.totalTimeFormatted.padEnd(10)} العمليات/ثانية: ${String(r.opsPerSecond).padEnd(12)} ║`);
            console.log(`║   المتوسط: ${String(r.avgResponseMs + 'ms').padEnd(10)} P50: ${String(r.p50Ms + 'ms').padEnd(9)} P95: ${String(r.p95Ms + 'ms').padEnd(9)} P99: ${String(r.p99Ms + 'ms').padEnd(6)}║`);
            console.log('╠══════════════════════════════════════════════════════════════╣');
        });
        console.log('╚══════════════════════════════════════════════════════════════╝');
    });

    // ────────────────────────────────────────────────────────────
    // 🧪 اختبار 1: 500 عملية إيداع متزامنة
    // ────────────────────────────────────────────────────────────
    test('يجب معالجة 500 عملية إيداع متزامنة بنجاح', async () => {
        const BATCH_SIZE = 500;
        const durations = [];
        let successCount = 0;
        let failCount = 0;

        const startTime = performance.now();

        const promises = Array.from({ length: BATCH_SIZE }, async (_, i) => {
            const opStart = performance.now();
            try {
                const result = await updateBalanceWithLedger(
                    'User', 'stress-entity', 10, 'DEPOSIT',
                    `STRESS-DEP-${i}`, `إيداع ضغط #${i}`
                );
                if (result.success) successCount++;
                else failCount++;
            } catch (e) {
                failCount++;
            }
            durations.push(performance.now() - opStart);
        });

        await Promise.all(promises);
        const endTime = performance.now();

        const report = generateReport('500 عملية إيداع متزامنة', durations, successCount, failCount, startTime, endTime);
        allReports.push(report);

        // التحقق
        expect(successCount).toBe(BATCH_SIZE);
        expect(failCount).toBe(0);
        expect(report.opsPerSecond).toBeGreaterThan(0);
    });

    // ────────────────────────────────────────────────────────────
    // 🧪 اختبار 2: 500 عملية خصم متزامنة (مع رصيد كافٍ)
    // ────────────────────────────────────────────────────────────
    test('يجب معالجة 500 عملية خصم متزامنة بنجاح', async () => {
        const BATCH_SIZE = 500;
        const durations = [];
        let successCount = 0;
        let failCount = 0;

        const startTime = performance.now();

        const promises = Array.from({ length: BATCH_SIZE }, async (_, i) => {
            const opStart = performance.now();
            try {
                const result = await updateBalanceWithLedger(
                    'User', 'stress-entity', -5, 'TRANSFER',
                    `STRESS-DED-${i}`, `خصم ضغط #${i}`
                );
                if (result.success) successCount++;
                else failCount++;
            } catch (e) {
                failCount++;
            }
            durations.push(performance.now() - opStart);
        });

        await Promise.all(promises);
        const endTime = performance.now();

        const report = generateReport('500 عملية خصم متزامنة', durations, successCount, failCount, startTime, endTime);
        allReports.push(report);

        expect(successCount).toBe(BATCH_SIZE);
        expect(failCount).toBe(0);
    });

    // ────────────────────────────────────────────────────────────
    // 🧪 اختبار 3: 1000 عملية مختلطة (إيداع + خصم) متزامنة
    // ────────────────────────────────────────────────────────────
    test('يجب معالجة 1000 عملية مختلطة (إيداع + خصم) بنجاح', async () => {
        const BATCH_SIZE = 1000;
        const durations = [];
        let successCount = 0;
        let failCount = 0;

        const startTime = performance.now();

        const promises = Array.from({ length: BATCH_SIZE }, async (_, i) => {
            const opStart = performance.now();
            const isDeposit = i % 2 === 0;
            try {
                const result = await updateBalanceWithLedger(
                    'User', 'stress-entity',
                    isDeposit ? 10 : -5,
                    isDeposit ? 'DEPOSIT' : 'TRANSFER',
                    `STRESS-MIX-${i}`,
                    `عملية مختلطة #${i}`
                );
                if (result.success) successCount++;
                else failCount++;
            } catch (e) {
                failCount++;
            }
            durations.push(performance.now() - opStart);
        });

        await Promise.all(promises);
        const endTime = performance.now();

        const report = generateReport('1000 عملية مختلطة (إيداع+خصم)', durations, successCount, failCount, startTime, endTime);
        allReports.push(report);

        expect(successCount).toBe(BATCH_SIZE);
        expect(report.totalOperations).toBe(BATCH_SIZE);
    });

    // ────────────────────────────────────────────────────────────
    // 🧪 اختبار 4: 500 عملية خصم مع رصيد محدود (بعضها سيفشل)
    // ────────────────────────────────────────────────────────────
    test('يجب معالجة 500 عملية خصم مع رصيد محدود — بعضها يُرفض', async () => {
        // رصيد 100 فقط — كل عملية تخصم 1 — بعد 100 عملية سيرفض الباقي
        mongoose._reset();
        let localBalance = 100;
        mongoose.model.mockReturnValue({
            modelName: 'User',
            findOneAndUpdate: jest.fn().mockImplementation((filter, update) => {
                const minRequired = filter.balance?.$gte;
                const increment = update.$inc?.balance || 0;
                if (minRequired !== undefined && localBalance < minRequired) {
                    return Promise.resolve(null);
                }
                localBalance += increment;
                return Promise.resolve({ _id: 'stress-limited', balance: localBalance });
            })
        });

        const BATCH_SIZE = 500;
        const durations = [];
        let successCount = 0;
        let failCount = 0;

        const startTime = performance.now();

        // تنفيذ تسلسلي (واحدة تلو الأخرى) لمحاكاة القفل الذري
        for (let i = 0; i < BATCH_SIZE; i++) {
            const opStart = performance.now();
            try {
                const result = await updateBalanceWithLedger(
                    'User', 'stress-limited', -1, 'TRANSFER',
                    `STRESS-LIM-${i}`, `خصم محدود #${i}`,
                    { minBalance: 0 }
                );
                if (result.success) successCount++;
                else failCount++;
            } catch (e) {
                failCount++;
            }
            durations.push(performance.now() - opStart);
        }

        const endTime = performance.now();

        const report = generateReport('500 خصم برصيد محدود (100 LYD)', durations, successCount, failCount, startTime, endTime);
        allReports.push(report);

        // الرصيد 100 → يجب أن ينجح 100 ويفشل 400
        expect(successCount).toBe(100);
        expect(failCount).toBe(400);
        expect(successCount + failCount).toBe(BATCH_SIZE);
    });

    // ────────────────────────────────────────────────────────────
    // 🧪 اختبار 5: سلامة دفتر الأستاذ بعد 500 عملية
    // ────────────────────────────────────────────────────────────
    test('يجب أن يكون عدد قيود دفتر الأستاذ مساوياً لعدد العمليات الناجحة', async () => {
        const Ledger = require('../models/Ledger');
        Ledger._reset();

        const BATCH_SIZE = 500;
        let successCount = 0;

        const promises = Array.from({ length: BATCH_SIZE }, async (_, i) => {
            try {
                const result = await updateBalanceWithLedger(
                    'User', 'stress-entity', 5, 'DEPOSIT',
                    `STRESS-LEDGER-${i}`, `قيد ضغط #${i}`
                );
                if (result.success) successCount++;
            } catch (e) { /* فشل */ }
        });

        await Promise.all(promises);

        const entries = Ledger._getEntries();
        expect(entries.length).toBe(successCount);
        expect(entries.length).toBe(BATCH_SIZE);
    });

    // ────────────────────────────────────────────────────────────
    // 🧪 اختبار 6: 500 عملية مع نسبة أخطاء عشوائية (محاكاة فشل DB)
    // ────────────────────────────────────────────────────────────
    test('يجب معالجة 500 عملية مع 10% نسبة أخطاء عشوائية', async () => {
        let callCount = 0;
        mongoose.model.mockReturnValue({
            modelName: 'User',
            findOneAndUpdate: jest.fn().mockImplementation((filter, update) => {
                callCount++;
                // 10% من العمليات ستفشل عشوائياً
                if (callCount % 10 === 0) {
                    return Promise.reject(new Error('Simulated DB Error'));
                }
                return Promise.resolve({ _id: 'stress-error', balance: 99999 });
            })
        });

        const BATCH_SIZE = 500;
        const durations = [];
        let successCount = 0;
        let failCount = 0;

        const startTime = performance.now();

        const promises = Array.from({ length: BATCH_SIZE }, async (_, i) => {
            const opStart = performance.now();
            try {
                const result = await updateBalanceWithLedger(
                    'User', 'stress-error', 10, 'DEPOSIT',
                    `STRESS-ERR-${i}`, `عملية مع أخطاء #${i}`
                );
                if (result.success) successCount++;
                else failCount++;
            } catch (e) {
                failCount++;
            }
            durations.push(performance.now() - opStart);
        });

        await Promise.all(promises);
        const endTime = performance.now();

        const report = generateReport('500 عملية مع 10% أخطاء عشوائية', durations, successCount, failCount, startTime, endTime);
        allReports.push(report);

        // ~90% يجب أن تنجح و ~10% تفشل
        expect(successCount).toBeGreaterThanOrEqual(400);
        expect(failCount).toBeGreaterThanOrEqual(40);
        expect(successCount + failCount).toBe(BATCH_SIZE);
    });

    // ────────────────────────────────────────────────────────────
    // 🧪 اختبار 7: ضمان عدم تسريب Sessions بعد 500 عملية
    // ────────────────────────────────────────────────────────────
    test('يجب إغلاق جميع الجلسات (endSession) بعد 500 عملية', async () => {
        const BATCH_SIZE = 500;

        const promises = Array.from({ length: BATCH_SIZE }, async (_, i) => {
            try {
                await updateBalanceWithLedger(
                    'User', 'stress-entity', 5, 'DEPOSIT',
                    `STRESS-SESS-${i}`, `جلسة #${i}`
                );
            } catch (e) { /* ignore */ }
        });

        await Promise.all(promises);

        // يجب أن يتم فتح وإغلاق نفس عدد الجلسات
        const sessionsStarted = mongoose.startSession.mock.calls.length;
        const sessionsEnded = mongoose._mockSession.endSession.mock.calls.length;

        expect(sessionsStarted).toBe(BATCH_SIZE);
        expect(sessionsEnded).toBe(BATCH_SIZE);
    });

    // ────────────────────────────────────────────────────────────
    // 🧪 اختبار 8: أداء 2000 عملية — اختبار الحمل الأقصى
    // ────────────────────────────────────────────────────────────
    test('يجب معالجة 2000 عملية متزامنة في أقل من 10 ثوانٍ', async () => {
        const BATCH_SIZE = 2000;
        const durations = [];
        let successCount = 0;
        let failCount = 0;

        const startTime = performance.now();

        const promises = Array.from({ length: BATCH_SIZE }, async (_, i) => {
            const opStart = performance.now();
            try {
                const result = await updateBalanceWithLedger(
                    'User', 'stress-entity',
                    i % 3 === 0 ? -3 : 5,
                    i % 3 === 0 ? 'TRANSFER' : 'DEPOSIT',
                    `STRESS-MAX-${i}`,
                    `حمل أقصى #${i}`
                );
                if (result.success) successCount++;
                else failCount++;
            } catch (e) {
                failCount++;
            }
            durations.push(performance.now() - opStart);
        });

        await Promise.all(promises);
        const endTime = performance.now();

        const report = generateReport('2000 عملية — اختبار الحمل الأقصى', durations, successCount, failCount, startTime, endTime);
        allReports.push(report);

        expect(successCount).toBe(BATCH_SIZE);
        expect(endTime - startTime).toBeLessThan(10000); // أقل من 10 ثوانٍ
    });
});
