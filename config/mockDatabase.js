// config/mockDatabase.js
// ====================================================
// 🧪 قاعدة بيانات وهمية في الذاكرة (Mock In-Memory DB)
// تُستخدم عند عدم توفر MongoDB للاختبار والتجريب
// ====================================================

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;

const connectMockDB = async () => {
    try {
        mongoServer = await MongoMemoryServer.create();
        const uri = mongoServer.getUri();
        
        await mongoose.connect(uri);
        console.log(`[Database] 🧪 Mock In-Memory MongoDB Connected`);
        console.log(`[Database] ⚠️  هذا وضع تجريبي - البيانات ستُمحى عند إيقاف السيرفر`);

        // ========================================
        // 🌱 زرع البيانات التجريبية (Seed Data)
        // ========================================
        await seedDemoData();

        return true;
    } catch (error) {
        console.error(`[Mock DB Error] ${error.message}`);
        process.exit(1);
    }
};

const seedDemoData = async () => {
    // تحميل النماذج بعد الاتصال
    const Admin = require('../models/Admin');
    const User = require('../models/User');
    const ClientBot = require('../models/ClientBot');
    const ClientEmployee = require('../models/ClientEmployee');
    const ExecutorBot = require('../models/ExecutorBot');
    const Employee = require('../models/Employee');
    const Transaction = require('../models/Transaction');
    const Settings = require('../models/Settings');
    const Counter = require('../models/Counter');
    const SupportTicket = require('../models/SupportTicket');
    const Notification = require('../models/Notification');
    const StoreCategory = require('../models/StoreCategory');
    const StoreProduct = require('../models/StoreProduct');
    const Card = require('../models/Card');

    console.log('[Seed] 🌱 جاري زرع البيانات التجريبية...');

    // ── 1. الإعدادات العامة ──
    const settings = await Settings.create({
        rateLevel1: 6.40,
        rateLevel2: 6.45,
        rateLevel3: 6.50,
        openingTime: '09:00',
        closingTime: '23:00',
        isManualClosed: false,
        welcomeMessage: '🧪 مرحباً بك في الوضع التجريبي لمنظومة الأهرام الرقمية للصرافة.',
        termsMessage: '⚠️ يرجى التأكد من الرقم قبل الإرسال.\nالتحويل يتم خلال دقائق.',
        closedMessage: 'نعتذر، المنظومة مغلقة حالياً.',
        supportContact: '@AhramSupport'
    });

    // ── 2. المدير ──
    const hashedPass = await bcrypt.hash(process.env.PANEL_PASS || 'admin123', 12);
    const admin = await Admin.create({
        telegramId: process.env.ADMIN_TELEGRAM_ID || '123456789',
        name: 'المدير الرئيسي (تجريبي)',
        role: 'master',
        webUsername: process.env.PANEL_USER || 'admin',
        webPassword: hashedPass
    });

    // ── 3. عملاء أفراد ──
    const demoUsers = [];
    const userNames = ['أحمد محمود', 'سارة إبراهيم', 'محمد علي', 'فاطمة حسن', 'عمر خالد'];
    const userPhones = ['01012345678', '01123456789', '01234567890', '01098765432', '01567890123'];

    for (let i = 0; i < userNames.length; i++) {
        const userPass = await bcrypt.hash('test123', 12);
        const user = await User.create({
            telegramId: `user_tg_${1000 + i}`,
            name: userNames[i],
            phone: userPhones[i],
            balance: Math.floor(Math.random() * 5000) - 1000,
            tier: (i % 3) + 1,
            status: 'active',
            creditLimit: i < 3 ? 2000 : 0,
            webUsername: `client${i + 1}`,
            webPassword: userPass
        });
        demoUsers.push(user);
    }

    // ── 4. شركات (بوتات العملاء) ──
    const company1 = await ClientBot.create({
        name: 'شركة النور للصرافة (تجريبي)',
        token: 'DEMO_CLIENT_BOT_TOKEN_1',
        phone: '091-1234567',
        tier: 1,
        balance: 15000,
        exchangeRate: 6.35,
        creditLimit: 5000,
        status: 'active'
    });

    const company2 = await ClientBot.create({
        name: 'مكتب الأمل (تجريبي)',
        token: 'DEMO_CLIENT_BOT_TOKEN_2',
        phone: '092-7654321',
        tier: 2,
        balance: 8500,
        exchangeRate: 0,
        creditLimit: 2000,
        status: 'active'
    });

    // ── 5. موظفو الشركات ──
    const empPass = await bcrypt.hash('test123', 12);
    const compEmp1 = await ClientEmployee.create({
        telegramId: 'comp_emp_tg_001',
        clientBotId: company1._id,
        name: 'خالد المحمودي',
        phone: '091-9876543',
        status: 'active',
        webUsername: 'comp_emp1',
        webPassword: empPass
    });

    const compEmp2 = await ClientEmployee.create({
        telegramId: 'comp_emp_tg_002',
        clientBotId: company2._id,
        name: 'أميرة الزناتي',
        phone: '092-1122334',
        status: 'active',
        webUsername: 'comp_emp2',
        webPassword: empPass
    });

    // ── 6. بوتات التنفيذ ──
    const execBot1 = await ExecutorBot.create({
        name: 'بوت التنفيذ الرئيسي (تجريبي)',
        token: 'DEMO_EXEC_BOT_TOKEN_1',
        status: 'active',
        balance: 25000,
        isManagerBot: false,
        isApiBot: false
    });

    const execBot2 = await ExecutorBot.create({
        name: 'وكالة الصفا (تجريبي)',
        token: 'DEMO_EXEC_BOT_TOKEN_2',
        status: 'active',
        balance: 12000,
        isManagerBot: true,
        isApiBot: false
    });

    const execBot3 = await ExecutorBot.create({
        name: 'بوت الصفا 1 (فرعي)',
        token: 'DEMO_EXEC_BOT_TOKEN_3',
        status: 'active',
        balance: 5000,
        isManagerBot: false,
        parentBotId: execBot2._id,
        isApiBot: false
    });

    // ── 7. موظفو التنفيذ ──
    const execEmpPass = await bcrypt.hash('test123', 12);
    const execEmp1 = await Employee.create({
        telegramId: 'exec_emp_tg_001',
        name: 'يوسف منفذ',
        phone: '01011112222',
        role: 'manager',
        status: 'active',
        botId: execBot1._id,
        webUsername: 'exec_mgr1',
        webPassword: execEmpPass
    });

    const execEmp2 = await Employee.create({
        telegramId: 'exec_emp_tg_002',
        name: 'سمير عامل',
        phone: '01033334444',
        role: 'operator',
        status: 'active',
        botId: execBot1._id,
        webUsername: 'exec_op1',
        webPassword: execEmpPass
    });

    const execEmp3 = await Employee.create({
        telegramId: 'exec_emp_tg_003',
        name: 'مدير وكالة الصفا',
        phone: '01055556666',
        role: 'manager',
        status: 'active',
        botId: execBot2._id,
        webUsername: 'exec_mgr2',
        webPassword: execEmpPass
    });

    // ── 8. العداد ──
    await Counter.create({ name: 'transaction', value: 15 });

    // ── 9. المعاملات التجريبية ──
    const now = new Date();
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const txStatuses = ['pending', 'processing', 'accepted', 'completed', 'rejected', 'deposit'];
    const txTypes = ['vodafone', 'post_account', 'post_card'];

    for (let i = 1; i <= 15; i++) {
        const statusIdx = i <= 3 ? 0 : i <= 5 ? 1 : i <= 7 ? 2 : i <= 12 ? 3 : i <= 13 ? 4 : 5;
        const status = txStatuses[statusIdx];
        const user = demoUsers[i % demoUsers.length];
        const amount = Math.floor(Math.random() * 4000) + 500;
        const rate = settings[`rateLevel${user.tier}`] || 6.50;
        const costLYD = parseFloat((amount / rate).toFixed(2));

        const txDate = new Date(today);
        txDate.setHours(8 + i, Math.floor(Math.random() * 60));

        const txData = {
            customId: `ATT-DEMO-${String(i).padStart(4, '0')}`,
            userId: user.telegramId,
            transferType: txTypes[i % txTypes.length],
            vodafoneNumber: `010${Math.floor(10000000 + Math.random() * 89999999)}`,
            amount: amount,
            costLYD: costLYD,
            exchangeRate: rate,
            status: status,
            employeeName: user.name,
            notes: i % 4 === 0 ? 'ملاحظة تجريبية' : undefined,
            createdAt: txDate,
            updatedAt: txDate
        };

        if (status === 'processing' || status === 'accepted' || status === 'completed') {
            txData.executorBotId = execBot1._id;
            txData.executorBotName = execBot1.name;
        }
        if (status === 'accepted' || status === 'completed') {
            txData.executorName = execEmp2.name;
            txData.operatorId = execEmp2.telegramId;
        }
        if (status === 'completed') {
            txData.proofImage = 'demo_proof.jpg';
        }
        if (status === 'deposit') {
            txData.executorBotId = execBot1._id;
            txData.amount = Math.floor(Math.random() * 3000) + 1000;
            txData.costLYD = 0;
        }

        await Transaction.create(txData);
    }

    // بعض معاملات الشركات
    for (let i = 16; i <= 20; i++) {
        const amount = Math.floor(Math.random() * 3000) + 1000;
        await Transaction.create({
            customId: `ATT-DEMO-${String(i).padStart(4, '0')}`,
            userId: compEmp1.telegramId,
            clientBotId: company1._id,
            companyName: company1.name,
            employeeName: compEmp1.name,
            transferType: 'vodafone',
            vodafoneNumber: `010${Math.floor(10000000 + Math.random() * 89999999)}`,
            amount: amount,
            costLYD: parseFloat((amount / 6.35).toFixed(2)),
            exchangeRate: 6.35,
            status: i <= 18 ? 'completed' : 'pending',
            executorBotId: i <= 18 ? execBot1._id : undefined,
            executorBotName: i <= 18 ? execBot1.name : undefined,
            executorName: i <= 18 ? execEmp2.name : undefined,
            createdAt: now,
            updatedAt: now
        });
    }

    // ── 10. تذاكر الدعم ──
    await SupportTicket.create({
        entityType: 'client_user',
        entityId: demoUsers[0]._id,
        telegramId: demoUsers[0].telegramId,
        name: demoUsers[0].name,
        phone: demoUsers[0].phone,
        status: 'open',
        unreadAdmin: 1,
        messages: [{ sender: 'user', senderName: demoUsers[0].name, text: 'مرحباً، لدي استفسار بخصوص رصيدي.' }]
    });

    // ── 11. الإشعارات ──
    await Notification.create([
        { title: '🧪 وضع تجريبي', message: 'تم تشغيل المنظومة في الوضع التجريبي بدون قاعدة بيانات حقيقية.', isRead: false },
        { title: '✅ معاملة مكتملة', message: 'تم إتمام التحويل ATT-DEMO-0008 بنجاح.', txId: 'ATT-DEMO-0008', isRead: false },
        { title: '🔔 طلب جديد', message: 'طلب تحويل جديد من أحمد محمود بقيمة 2500 جنيه.', isRead: true }
    ]);

    // ── 12. أقسام المتجر والمنتجات ──
    await StoreCategory.create([
        { name: 'بطاقات شحن', icon: 'fa-mobile-alt', color: '#e74c3c' },
        { name: 'بطاقات ألعاب', icon: 'fa-gamepad', color: '#9b59b6' }
    ]);

    await StoreProduct.create([
        { categoryName: 'بطاقات شحن', name: 'فودافون 50 جنيه' },
        { categoryName: 'بطاقات شحن', name: 'اورنج 100 جنيه' },
        { categoryName: 'بطاقات ألعاب', name: 'PUBG 600 UC' }
    ]);

    // ── 13. بطاقات ──
    await Card.create([
        { category: 'بطاقات شحن', name: 'فودافون 50 جنيه', price_1: 50, price_2: 52, price_3: 55, code: 'VF50-DEMO-001', sold: false },
        { category: 'بطاقات شحن', name: 'فودافون 50 جنيه', price_1: 50, price_2: 52, price_3: 55, code: 'VF50-DEMO-002', sold: false },
        { category: 'بطاقات ألعاب', name: 'PUBG 600 UC', price_1: 200, price_2: 210, price_3: 220, code: 'PUBG-DEMO-001', sold: false }
    ]);

    console.log('[Seed] ✅ تم زرع البيانات التجريبية بنجاح!');
    console.log('');
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║  🧪  بيانات الدخول التجريبية (Demo Credentials)      ║');
    console.log('╠═══════════════════════════════════════════════════════╣');
    console.log(`║  🔑 لوحة الإدارة:                                    ║`);
    console.log(`║     المستخدم: ${(process.env.PANEL_USER || 'admin').padEnd(38)}║`);
    console.log(`║     كلمة المرور: ${(process.env.PANEL_PASS || 'admin123').padEnd(35)}║`);
    console.log('║                                                       ║');
    console.log('║  👤 موقع العميل (أفراد):                              ║');
    console.log('║     المستخدم: client1  |  كلمة المرور: test123        ║');
    console.log('║     (client1 حتى client5)                             ║');
    console.log('║                                                       ║');
    console.log('║  🏢 موقع العميل (شركة):                               ║');
    console.log('║     المستخدم: comp_emp1  |  كلمة المرور: test123      ║');
    console.log('║                                                       ║');
    console.log('║  ⚙️  موقع التنفيذ:                                    ║');
    console.log('║     المستخدم: exec_mgr1  |  كلمة المرور: test123     ║');
    console.log('║     المستخدم: exec_op1   |  كلمة المرور: test123     ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log('');
};

const stopMockDB = async () => {
    if (mongoServer) {
        await mongoose.disconnect();
        await mongoServer.stop();
        console.log('[Database] 🛑 Mock MongoDB Stopped');
    }
};

module.exports = { connectMockDB, stopMockDB };
