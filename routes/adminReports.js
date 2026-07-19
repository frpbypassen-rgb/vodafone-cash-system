// routes/adminReports.js
const express = require('express');
const router = express.Router();
const puppeteer = require('puppeteer');
const { Telegram } = require('telegraf');

const Transaction = require('../models/Transaction');
const ClientBot = require('../models/ClientBot');
const ExecutorBot = require('../models/ExecutorBot');
const User = require('../models/User');
const Employee = require('../models/Employee');
const ClientEmployee = require('../models/ClientEmployee');
const { requireAuth } = require('../middlewares/auth');

router.use(requireAuth);

const renderHtmlPromisified = (appInstance, view, data) => {
    return new Promise((resolve, reject) => {
        appInstance.render(view, data, (err, html) => {
            if (err) reject(err); else resolve(html);
        });
    });
};

const sendBulkReportsInBg = async (periodType, dateValue, appReq) => {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
        let start, end, dateLabel;
        if (periodType === 'daily') {
            start = new Date(`${dateValue}T00:00:00.000Z`); end = new Date(`${dateValue}T23:59:59.999Z`); dateLabel = `يوم ${dateValue}`;
        } else {
            const [year, month] = dateValue.split('-'); start = new Date(year, parseInt(month) - 1, 1); end = new Date(year, parseInt(month), 0, 23, 59, 59, 999); dateLabel = `شهر ${month}-${year}`;
        }

        const processEntity = async (type, entityId, targetObj, botToken, employees) => {
            try {
                let query = { status: { $in: ['completed', 'deposit', 'deduction'] }, updatedAt: { $gte: start, $lte: end } };
                let queryBefore = { status: { $in: ['completed', 'deposit', 'deduction'] }, updatedAt: { $lt: start } };

                if (type === 'client') { query.clientBotId = entityId; queryBefore.clientBotId = entityId; }
                else if (type === 'executor') { query.executorBotId = entityId; queryBefore.executorBotId = entityId; }
                else if (type === 'user') { query.userId = targetObj.telegramId; query.clientBotId = null; queryBefore.userId = targetObj.telegramId; queryBefore.clientBotId = null; }

                const transactions = await Transaction.find(query).sort({ updatedAt: 1 });
                if (transactions.length === 0) return;

                let totals = { transfersEGP: 0, transfersLYD: 0, depositsEGP: 0, deductionsEGP: 0 };
                transactions.forEach(tx => {
                    if (tx.status === 'completed') { totals.transfersEGP += (tx.amount || 0); totals.transfersLYD += (tx.costLYD || 0); }
                    else if (tx.status === 'deposit') { totals.depositsEGP += (tx.amount || 0); }
                    else if (tx.status === 'deduction') { totals.deductionsEGP += (tx.amount || 0); }
                });

                let openingBalance = 0;
                const txsBefore = await Transaction.find(queryBefore);
                txsBefore.forEach(tx => {
                    if (type === 'client' || type === 'user') {
                        if (tx.status === 'completed') openingBalance -= (tx.costLYD || 0); else if (tx.status === 'deposit') openingBalance += (tx.amount || 0); else if (tx.status === 'deduction') openingBalance -= Math.abs(tx.amount || 0);
                    } else if (type === 'executor') {
                        if (tx.status === 'completed') openingBalance -= (tx.amount || 0); else if (tx.status === 'deposit') openingBalance += (tx.amount || 0); else if (tx.status === 'deduction') openingBalance -= Math.abs(tx.amount || 0);
                    }
                });

                let periodNetChange = 0;
                if (type === 'client' || type === 'user') periodNetChange = totals.depositsEGP - totals.deductionsEGP - totals.transfersLYD;
                else if (type === 'executor') periodNetChange = totals.depositsEGP - totals.deductionsEGP - totals.transfersEGP;
                const closingBalance = openingBalance + periodNetChange;

                const html = await renderHtmlPromisified(appReq.app, 'admin_reports', { clientBots: [], executorBots: [], users: [], type, entityId, fromDate: '', toDate: '', transactions, totals, openingBalance, closingBalance, targetName: targetObj.name, isPdfExport: true, bulkDateLabel: dateLabel });
                const page = await browser.newPage(); await page.setContent(html, { waitUntil: 'networkidle0' });
                const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
                await page.close();

                const api = new Telegram(botToken);
                const fileName = `Report_${targetObj.name.replace(/\s+/g, '_')}_${dateLabel.replace(/\s+/g, '_')}.pdf`;
                const captionMsg = `📊 <b>تقرير تقفيل المعتمد</b>\n\n🏢 الجهة: ${targetObj.name}\n📅 الفترة: ${dateLabel}\n💰 الرصيد الختامي: ${closingBalance.toFixed(2)}`;

                for (const emp of employees) {
                    if (emp && emp.telegramId) { try { await api.sendDocument(emp.telegramId.toString(), { source: Buffer.from(pdfBuffer), filename: fileName }, { caption: captionMsg, parse_mode: 'HTML' }); } catch (e) {} }
                }
            } catch (err) {}
        };

        const users = await User.find({ status: 'active' }); for (const u of users) await processEntity('user', u._id, u, process.env.CLIENT_BOT_TOKEN, [{ telegramId: u.telegramId }]);
        const clients = await ClientBot.find({ status: 'active' }); for (const c of clients) { const emps = await ClientEmployee.find({ clientBotId: c._id, status: 'active' }); await processEntity('client', c._id, c, c.token, emps); }
        const executors = await ExecutorBot.find({ status: 'active' }); for (const e of executors) { const emps = await Employee.find({ botId: e._id, status: 'active' }); await processEntity('executor', e._id, e, e.token, emps); }

    } catch (err) { console.error(err); } finally { if (browser) await browser.close(); }
};

router.post('/bulk-send', async (req, res) => {
    const { bulkType, bulkDate, bulkMonth } = req.body;
    if (bulkType === 'daily' && bulkDate) sendBulkReportsInBg('daily', bulkDate, req);
    else if (bulkType === 'monthly' && bulkMonth) sendBulkReportsInBg('monthly', bulkMonth, req);
    res.redirect('/admin-reports?success=bulk_started');
});

router.get('/', async (req, res) => {
    try {
        const clientBots = await ClientBot.find({ status: 'active' }); const executorBots = await ExecutorBot.find({ status: 'active' }); const users = await User.find({ status: 'active' });
        const { type, entityId, fromDate, toDate } = req.query;
        let transactions = []; let totals = { transfersEGP: 0, transfersLYD: 0, depositsEGP: 0, deductionsEGP: 0 }; let openingBalance = 0; let closingBalance = 0; let targetName = '';

        if (type && entityId) {
            let query = { status: { $in: ['completed', 'deposit', 'deduction'] } }; let queryBefore = { status: { $in: ['completed', 'deposit', 'deduction'] } };
            if (type === 'client') { query.clientBotId = entityId; queryBefore.clientBotId = entityId; const comp = await ClientBot.findById(entityId); if (comp) targetName = comp.name; }
            else if (type === 'executor') { query.executorBotId = entityId; queryBefore.executorBotId = entityId; const exec = await ExecutorBot.findById(entityId); if (exec) targetName = exec.name; }
            else if (type === 'user') { const userObj = await User.findById(entityId); if (userObj) { query.userId = userObj.telegramId; query.clientBotId = null; queryBefore.userId = userObj.telegramId; queryBefore.clientBotId = null; targetName = userObj.name; } }

            if (fromDate || toDate) { query.updatedAt = {}; if (fromDate) query.updatedAt.$gte = new Date(`${fromDate}T00:00:00.000Z`); if (toDate) query.updatedAt.$lte = new Date(`${toDate}T23:59:59.999Z`); }

            transactions = await Transaction.find(query).sort({ updatedAt: 1 });
            transactions.forEach(tx => {
                if (tx.status === 'completed') { totals.transfersEGP += (tx.amount || 0); totals.transfersLYD += (tx.costLYD || 0); }
                else if (tx.status === 'deposit') { totals.depositsEGP += (tx.amount || 0); }
                else if (tx.status === 'deduction') { totals.deductionsEGP += (tx.amount || 0); }
            });

            if (fromDate) {
                queryBefore.updatedAt = { $lt: new Date(`${fromDate}T00:00:00.000Z`) };
                const txsBefore = await Transaction.find(queryBefore);
                txsBefore.forEach(tx => {
                    if (type === 'client' || type === 'user') {
                        if (tx.status === 'completed') openingBalance -= (tx.costLYD || 0); else if (tx.status === 'deposit') openingBalance += (tx.amount || 0); else if (tx.status === 'deduction') openingBalance -= Math.abs(tx.amount || 0);
                    } else if (type === 'executor') {
                        if (tx.status === 'completed') openingBalance -= (tx.amount || 0); else if (tx.status === 'deposit') openingBalance += (tx.amount || 0); else if (tx.status === 'deduction') openingBalance -= Math.abs(tx.amount || 0);
                    }
                });
            }

            let periodNetChange = 0;
            if (type === 'client' || type === 'user') periodNetChange = totals.depositsEGP - totals.deductionsEGP - totals.transfersLYD;
            else if (type === 'executor') periodNetChange = totals.depositsEGP - totals.deductionsEGP - totals.transfersEGP;
            closingBalance = openingBalance + periodNetChange;
        }
        res.render('admin_reports', { clientBots, executorBots, users, type, entityId, fromDate, toDate, transactions, totals, openingBalance, closingBalance, targetName, isPdfExport: false });
    } catch (e) { res.redirect('/'); }
});

router.post('/send', async (req, res) => {
    try {
        const { type, entityId, fromDate, toDate } = req.body;
        if (!type || !entityId) return res.redirect('/admin-reports');

        let query = { status: { $in: ['completed', 'deposit', 'deduction'] } }; let queryBefore = { status: { $in: ['completed', 'deposit', 'deduction'] } };
        if (fromDate || toDate) { query.updatedAt = {}; if (fromDate) query.updatedAt.$gte = new Date(`${fromDate}T00:00:00.000Z`); if (toDate) query.updatedAt.$lte = new Date(`${toDate}T23:59:59.999Z`); }

        let targetObj, botToken, employees = [];
        const dateLabel = (fromDate && toDate) ? `من ${fromDate} إلى ${toDate}` : 'تقرير مخصص مفتوح';

        if (type === 'client') { query.clientBotId = entityId; queryBefore.clientBotId = entityId; targetObj = await ClientBot.findById(entityId); if (targetObj) { botToken = targetObj.token; employees = await ClientEmployee.find({ clientBotId: entityId, status: 'active' }); } }
        else if (type === 'executor') { query.executorBotId = entityId; queryBefore.executorBotId = entityId; targetObj = await ExecutorBot.findById(entityId); if (targetObj) { botToken = targetObj.token; employees = await Employee.find({ botId: entityId, status: 'active' }); } }
        else if (type === 'user') { targetObj = await User.findById(entityId); if (targetObj) { query.userId = targetObj.telegramId; query.clientBotId = null; queryBefore.userId = targetObj.telegramId; queryBefore.clientBotId = null; botToken = process.env.CLIENT_BOT_TOKEN; employees = [{ telegramId: targetObj.telegramId.toString() }]; } }

        if (!targetObj || !botToken) return res.redirect(`/admin-reports?type=${type}&entityId=${entityId}&error=notfound`);

        const transactions = await Transaction.find(query).sort({ updatedAt: 1 });
        if (transactions.length === 0) return res.redirect(`/admin-reports?type=${type}&entityId=${entityId}&error=empty`);

        let totals = { transfersEGP: 0, transfersLYD: 0, depositsEGP: 0, deductionsEGP: 0 };
        transactions.forEach(tx => {
            if (tx.status === 'completed') { totals.transfersEGP += (tx.amount || 0); totals.transfersLYD += (tx.costLYD || 0); }
            else if (tx.status === 'deposit') { totals.depositsEGP += (tx.amount || 0); }
            else if (tx.status === 'deduction') { totals.deductionsEGP += (tx.amount || 0); }
        });

        let openingBalance = 0;
        if (fromDate) {
            queryBefore.updatedAt = { $lt: new Date(`${fromDate}T00:00:00.000Z`) };
            const txsBefore = await Transaction.find(queryBefore);
            txsBefore.forEach(tx => {
                if (type === 'client' || type === 'user') { if (tx.status === 'completed') openingBalance -= (tx.costLYD || 0); else if (tx.status === 'deposit') openingBalance += (tx.amount || 0); else if (tx.status === 'deduction') openingBalance -= Math.abs(tx.amount || 0); }
                else if (type === 'executor') { if (tx.status === 'completed') openingBalance -= (tx.amount || 0); else if (tx.status === 'deposit') openingBalance += (tx.amount || 0); else if (tx.status === 'deduction') openingBalance -= Math.abs(tx.amount || 0); }
            });
        }
        let periodNetChange = 0;
        if (type === 'client' || type === 'user') periodNetChange = totals.depositsEGP - totals.deductionsEGP - totals.transfersLYD;
        else if (type === 'executor') periodNetChange = totals.depositsEGP - totals.deductionsEGP - totals.transfersEGP;
        const closingBalance = openingBalance + periodNetChange;

        req.app.render('admin_reports', { clientBots: [], executorBots: [], users: [], type, entityId, fromDate, toDate, transactions, totals, openingBalance, closingBalance, targetName: targetObj.name, isPdfExport: true }, async (err, html) => {
            if (err) return res.redirect('/admin-reports?error=failed');
            let browser;
            try {
                browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
                const page = await browser.newPage(); await page.setContent(html, { waitUntil: 'networkidle0' });
                const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
                await browser.close();

                const api = new Telegram(botToken);
                const fileName = `Report_${targetObj.name.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
                const captionMsg = `📊 <b>التقرير المحاسبي المخصص (PDF)</b>\n\n🏢 الجهة: ${targetObj.name}\n📅 الفترة: ${dateLabel}\n💰 الرصيد الختامي: ${closingBalance.toFixed(2)}`;
                let sentCount = 0;
                for (const emp of employees) {
                    if (emp && emp.telegramId) { try { await api.sendDocument(emp.telegramId, { source: Buffer.from(pdfBuffer), filename: fileName }, { caption: captionMsg, parse_mode: 'HTML' }); sentCount++; } catch (e) {} }
                }
                res.redirect(`/admin-reports?type=${type}&entityId=${entityId}&fromDate=${fromDate}&toDate=${toDate}&success=sent&count=${sentCount}`);
            } catch (pdfErr) { if (browser) await browser.close(); res.redirect('/admin-reports?error=failed'); }
        });
    } catch (e) { res.redirect('/admin-reports?error=failed'); }
});

module.exports = router;