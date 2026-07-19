const puppeteer = require('puppeteer');
const { Telegram } = require('telegraf');
const User = require('../models/User');
const ClientBot = require('../models/ClientBot');
const ExecutorBot = require('../models/ExecutorBot');
const Transaction = require('../models/Transaction');
const Employee = require('../models/Employee');
const ClientEmployee = require('../models/ClientEmployee');

const renderHtmlPromisified = (appInstance, view, data) => {
    return new Promise((resolve, reject) => {
        appInstance.render(view, data, (err, html) => { if (err) reject(err); else resolve(html); });
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
                const captionMsg = `📊 <b>تقرير تقفيل (${periodType === 'daily' ? 'اليوم' : 'الشهر'}) المعتمد</b>\n\n🏢 الجهة: ${targetObj.name}\n📅 الفترة: ${dateLabel}\n💰 الرصيد الختامي للفترة: ${closingBalance.toFixed(2)}`;

                for (const emp of employees) {
                    if (emp && emp.telegramId) { try { await api.sendDocument(emp.telegramId.toString(), { source: Buffer.from(pdfBuffer), filename: fileName }, { caption: captionMsg, parse_mode: 'HTML' }); } catch (e) {} }
                }
            } catch (err) {}
        };

        const users = await User.find({ status: 'active' }); for (const u of users) await processEntity('user', u._id, u, process.env.CLIENT_BOT_TOKEN, [{ telegramId: u.telegramId }]);
        const clients = await ClientBot.find({ status: 'active' }); for (const c of clients) { const emps = await ClientEmployee.find({ clientBotId: c._id, status: 'active' }); await processEntity('client', c._id, c, c.token, emps); }
        const executors = await ExecutorBot.find({ status: 'active' }); for (const e of executors) { const emps = await Employee.find({ botId: e._id, status: 'active' }); await processEntity('executor', e._id, e, e.token, emps); }

    } catch (err) {
    } finally {
        if (browser) await browser.close(); 
    }
};

module.exports = { renderHtmlPromisified, sendBulkReportsInBg };
