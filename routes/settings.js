const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const Settings = require('../models/Settings');
const ExecutorBot = require('../models/ExecutorBot');
const ClientBot = require('../models/ClientBot');
const User = require('../models/User');
const ClientEmployee = require('../models/ClientEmployee');
const Employee = require('../models/Employee');
const Admin = require('../models/Admin');
const { requireAuth, requireMaster } = require('../middlewares/auth');
const { pickAllowed } = require('../middlewares/sanitize');
const { hashPassword } = require('../services/passwordService');

router.use(requireAuth);

// =========================================================
// الحقول المسموحة لكل نوع إعداد — حماية من Mass Assignment
// =========================================================
const ALLOWED_MAIN_SETTINGS = [
    'rateLevel1', 'rateLevel2', 'rateLevel3',
    'openingTime', 'closingTime', 'isManualClosed',
    'supportContact', 'autoRouteEnabled', 'autoRouteBotId'
];

const ALLOWED_CONTENT_SETTINGS = [
    'welcomeMessage', 'termsMessage', 'closedMessage',
    'executorWelcomeMessage', 'executorPendingMessage', 'executorBannedMessage'
];

const ALLOWED_EXCEL_SETTINGS = [
    'excelTitleBg', 'excelHeaderBg', 'excelTotalBg',
    'excelFontSize', 'excelColWidth', 'excelRowHeight',
    'excelAlignment', 'excelMainTitle', 'excelColNames',
    'excelColKeys', 'excelSummaryNames', 'excelSummaryKeys',
    'execExcelTitleBg', 'execExcelHeaderBg', 'execExcelTotalBg',
    'execExcelFontSize', 'execExcelColWidth', 'execExcelRowHeight',
    'execExcelAlignment', 'execExcelMainTitle', 'execExcelColNames',
    'execExcelColKeys', 'execExcelSummaryNames', 'execExcelSummaryKeys'
];

const ALLOWED_CLIENT_BOT_FIELDS = [
    'name', 'token', 'welcomeMessage', 'status',
    'rateLevel1', 'rateLevel2', 'rateLevel3'
];

// =========================================================
// الإعدادات الرئيسية
// =========================================================
router.get('/', async (req, res) => {
    const settings = await Settings.findOne({}) || await Settings.create({});
    const executorBots = await ExecutorBot.find({ status: 'active' });
    res.render('settings', { settings, executorBots });
});

router.post('/update', async (req, res) => {
    try {
        const data = pickAllowed(req.body, ALLOWED_MAIN_SETTINGS);
        data.isManualClosed = data.isManualClosed === 'true' || data.isManualClosed === true;
        data.autoRouteEnabled = data.autoRouteEnabled === 'true' || data.autoRouteEnabled === true;
        if (!data.autoRouteBotId || data.autoRouteBotId === '') data.autoRouteBotId = null;
        // تحقق من القيم الرقمية
        ['rateLevel1', 'rateLevel2', 'rateLevel3'].forEach(field => {
            if (data[field] !== undefined) data[field] = parseFloat(data[field]) || 0;
        });
        await Settings.updateOne({}, data, { upsert: true });
        res.redirect('/settings');
    } catch (e) {
        console.error('[settings/update] خطأ:', e.message);
        res.redirect('/settings');
    }
});

// =========================================================
// إعدادات المحتوى
// =========================================================
router.get('/content', async (req, res) => {
    const settings = await Settings.findOne({}) || await Settings.create({});
    res.render('content_settings', { settings });
});

router.post('/content/update', async (req, res) => {
    try {
        const data = pickAllowed(req.body, ALLOWED_CONTENT_SETTINGS);
        await Settings.updateOne({}, data, { upsert: true });
        res.redirect('/settings/content');
    } catch (e) {
        console.error('[settings/content/update] خطأ:', e.message);
        res.redirect('/settings/content');
    }
});

// =========================================================
// إعدادات الإكسيل
// =========================================================
router.get('/excel', async (req, res) => {
    const settings = await Settings.findOne({}) || await Settings.create({});
    res.render('excel_settings', { settings });
});

router.post('/excel/update', async (req, res) => {
    try {
        const data = pickAllowed(req.body, ALLOWED_EXCEL_SETTINGS);
        // تحقق من القيم الرقمية
        ['excelFontSize', 'excelColWidth', 'excelRowHeight',
         'execExcelFontSize', 'execExcelColWidth', 'execExcelRowHeight'].forEach(field => {
            if (data[field] !== undefined) data[field] = parseInt(data[field]) || 11;
        });
        await Settings.updateOne({}, data, { upsert: true });
        res.redirect('/settings/excel');
    } catch (e) {
        console.error('[settings/excel/update] خطأ:', e.message);
        res.redirect('/settings/excel');
    }
});

// =========================================================
// إعدادات البوتات
// =========================================================
router.get('/bots', async (req, res) => {
    const executorBots = await ExecutorBot.find({});
    const clientBots = await ClientBot.find({});
    res.render('bots', { executorBots, clientBots });
});

router.post('/bots/add-executor', async (req, res) => {
    try { 
        const { name, botType, token, apiUrl, apiToken } = req.body; 

        if (!name || !name.trim()) return res.redirect('/settings/bots');

        let newBotData = {
            name: name.trim(),
            status: 'active'
        };

        if (botType === 'api') {
            newBotData.isApiBot = true;
            newBotData.apiUrl = apiUrl;
            newBotData.apiToken = apiToken;
            newBotData.token = `API_DUMMY_${Date.now()}`; 
        } else if (botType === 'manager') {
            newBotData.isManagerBot = true;
            newBotData.token = token;
        } else {
            newBotData.token = token;
        }

        await ExecutorBot.create(newBotData); 
        res.redirect('/settings/bots'); 
    } catch (e) { 
        console.error('[settings/bots/add-executor] خطأ:', e.message);
        res.redirect('/settings/bots'); 
    }
});

// ✅ إصلاح: whitelist للحقول المسموحة فقط
router.post('/bots/add-client', async (req, res) => {
    try {
        const data = pickAllowed(req.body, ALLOWED_CLIENT_BOT_FIELDS);
        if (!data.name || !data.token) return res.redirect('/settings/bots');
        data.name = data.name.trim();
        data.token = data.token.trim();
        await ClientBot.create(data);
        res.redirect('/settings/bots');
    } catch (e) {
        console.error('[settings/bots/add-client] خطأ:', e.message);
        res.redirect('/settings/bots');
    }
});

// =========================================================
// إدارة حسابات العملاء على الويب
// =========================================================
router.get('/clients-web', async (req, res) => {
    const users = await User.find({ status: 'active' });
    const companies = await ClientBot.find({ status: 'active' });
    const allClientEmployees = await ClientEmployee.find({ status: 'active' });
    const webUsers = await User.find({ webUsername: { $exists: true, $nin: [null, ""] } });
    const webEmployeesRaw = await ClientEmployee.find({ webUsername: { $exists: true, $nin: [null, ""] } }).populate('clientBotId');
    const webEmployees = webEmployeesRaw.map(e => ({
        _id: e._id, name: e.name, role: e.role, webUsername: e.webUsername,
        webPassword: '••••••', // لا نعرض كلمة المرور في الواجهة
        companyName: e.clientBotId ? e.clientBotId.name : 'شركة محذوفة', status: e.status
    }));
    res.render('settings_clients_web', { users, companies, allClientEmployees, webUsers, webEmployees, query: req.query });
});

// ✅ إصلاح: تشفير كلمة المرور قبل الحفظ
router.post('/clients-web/add', async (req, res) => {
    try {
        const { accountType, accountId, employeeId, webUsername, webPassword } = req.body;
        if (!webUsername || !webPassword) return res.redirect('/settings/clients-web?error=missing');
        
        const user = webUsername.trim().toLowerCase();
        const hashedPass = await hashPassword(webPassword);

        if (accountType === 'user') {
            await User.findByIdAndUpdate(accountId, { webUsername: user, webPassword: hashedPass });
        } else {
            if (employeeId) await ClientEmployee.findByIdAndUpdate(employeeId, { webUsername: user, webPassword: hashedPass });
        }
        res.redirect('/settings/clients-web?success=true');
    } catch (e) {
        console.error('[settings/clients-web/add] خطأ:', e.message);
        res.redirect('/settings/clients-web?error=true');
    }
});

// ✅ إصلاح: تشفير كلمة المرور عند التعديل
router.post('/clients-web/edit', async (req, res) => {
    try {
        const { accountType, accountId, webUsername, webPassword } = req.body;
        if (!webUsername || !accountId) return res.redirect('/settings/clients-web?error=missing');

        const user = webUsername.trim().toLowerCase();
        const updateData = { webUsername: user };

        // تشفير كلمة المرور فقط إذا تم إرسالها
        if (webPassword && webPassword.trim()) {
            updateData.webPassword = await hashPassword(webPassword);
        }

        if (accountType === 'user') {
            await User.findByIdAndUpdate(accountId, updateData);
        } else if (accountType === 'employee') {
            await ClientEmployee.findByIdAndUpdate(accountId, updateData);
        }
        res.redirect('/settings/clients-web?success=true');
    } catch (error) {
        console.error('[settings/clients-web/edit] خطأ:', error.message);
        res.redirect('/settings/clients-web?error=true');
    }
});

router.post('/clients-web/delete', async (req, res) => {
    try {
        const { accountType, accountId } = req.body;
        if (accountType === 'user') {
            await User.findByIdAndUpdate(accountId, { $unset: { webUsername: "", webPassword: "" } });
        } else if (accountType === 'employee') {
            await ClientEmployee.findByIdAndUpdate(accountId, { $unset: { webUsername: "", webPassword: "" } });
        }
        res.redirect('/settings/clients-web?success=true');
    } catch (error) {
        console.error('[settings/clients-web/delete] خطأ:', error.message);
        res.redirect('/settings/clients-web?error=true');
    }
});

router.post('/clients-web/toggle', async (req, res) => {
    try {
        const { accountType, accountId } = req.body;
        if (accountType === 'user') {
            const account = await User.findById(accountId);
            if(account) { account.status = account.status === 'active' ? 'banned' : 'active'; await account.save(); }
        } else if (accountType === 'employee') {
            const account = await ClientEmployee.findById(accountId);
            if(account) { account.status = account.status === 'active' ? 'banned' : 'active'; await account.save(); }
        }
        res.redirect('/settings/clients-web?success=true');
    } catch (error) {
        console.error('[settings/clients-web/toggle] خطأ:', error.message);
        res.redirect('/settings/clients-web?error=true');
    }
});

// =========================================================
// إدارة حسابات المنفذين على الويب
// =========================================================
router.get('/executors-web', async (req, res) => {
    try {
        const employees = await Employee.find({ status: 'active' }).populate('botId');
        const webExecutors = await Employee.find({ webUsername: { $exists: true, $nin: [null, ""] } }).populate('botId');
        res.render('settings_executors_web', { employees, webExecutors, query: req.query });
    } catch (e) {
        console.error('[settings/executors-web] خطأ:', e.message);
        res.redirect('/');
    }
});

// ✅ إصلاح: تشفير كلمة المرور
router.post('/executors-web/add', async (req, res) => {
    try {
        const { employeeId, webUsername, webPassword } = req.body;
        if (!employeeId || !webUsername || !webPassword) return res.redirect('/settings/executors-web?error=missing');
        
        const user = webUsername.trim().toLowerCase();
        const hashedPass = await hashPassword(webPassword);
        await Employee.findByIdAndUpdate(employeeId, { webUsername: user, webPassword: hashedPass });
        res.redirect('/settings/executors-web?success=true');
    } catch (e) {
        console.error('[settings/executors-web/add] خطأ:', e.message);
        res.redirect('/settings/executors-web?error=true');
    }
});

router.post('/executors-web/delete', async (req, res) => {
    try {
        const { employeeId } = req.body;
        await Employee.findByIdAndUpdate(employeeId, { $unset: { webUsername: "", webPassword: "" } });
        res.redirect('/settings/executors-web?success=true');
    } catch (e) {
        console.error('[settings/executors-web/delete] خطأ:', e.message);
        res.redirect('/settings/executors-web?error=true');
    }
});

// =========================================================
// إدارة مستخدمي لوحة التحكم — Master فقط
// =========================================================
router.get('/users', requireMaster, async (req, res) => {
    const webAdmins = await Admin.find({ webUsername: { $exists: true, $ne: null } }).sort({ createdAt: -1 });
    res.render('settings_users', { webAdmins });
});

// ✅ إصلاح: bcrypt عند إنشاء مستخدم جديد (pre('save') hook موجود في Admin model)
router.post('/users/add', requireMaster, async (req, res) => {
    try {
        const { name, webUsername, webPassword } = req.body;
        if (!name || !webUsername || !webPassword) return res.redirect('/settings/users');
        
        const dummyId = `WEB_${Date.now()}`; 
        await Admin.create({ 
            telegramId: dummyId, 
            name: name.trim(), 
            webUsername: webUsername.trim().toLowerCase(), 
            webPassword: webPassword.trim(), // سيتم تشفيره في pre('save') hook
            role: 'admin' 
        });
        res.redirect('/settings/users');
    } catch (e) {
        console.error('[settings/users/add] خطأ:', e.message);
        res.redirect('/settings/users');
    }
});

router.post('/users/delete/:id', requireMaster, async (req, res) => {
    try {
        await Admin.findByIdAndDelete(req.params.id);
        res.redirect('/settings/users');
    } catch(e) {
        console.error('[settings/users/delete] خطأ:', e.message);
        res.redirect('/settings/users');
    }
});

module.exports = router;