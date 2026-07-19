require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const cron = require('node-cron');
const https = require('https'); 
const http = require('http'); // 🟢 للإقلاع مع الـ Sockets
const { Server } = require('socket.io'); // 🟢 خادم الزمن الفعلي
const rateLimit = require('express-rate-limit'); // 🟢 جدار الحماية
const helmet = require('helmet'); // 🟢 حماية الهيدرز
const cors = require('cors');
const multer = require('multer');

// 🟢 إعداد رفع الملفات في الذاكرة مع فحص نوع الملف
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('نوع الملف غير مسموح به. يُقبل فقط: JPEG, PNG, WEBP, GIF'), false);
        }
    }
});

const connectDB = require('./config/database');
const { requireAuth, requireMaster } = require('./middlewares/auth');
const { errorHandler, notFoundHandler } = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/requestLogger');
const { metricsMiddleware, metricsEndpoint } = require('./middlewares/metrics');
const logger = require('./utils/logger');

// 🟢 استدعاء طابور المهام الجديد (Queue System)

const app = express();

// ==========================================
// 🛡️ درع حماية السيرفر من الانهيار
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [تخطي خطأ في الخلفية - Unhandled Rejection]:', reason.message || reason);
});

process.on('uncaughtException', (err) => {
    console.error('🚨 [تخطي خطأ حرج - Uncaught Exception]:', err.message);
});

app.set('trust proxy', 1); 

const server = http.createServer(app);

// ✅ إصلاح: تقييد CORS في Socket.IO بدل السماح لأي نطاق
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

const io = new Server(server, {
    cors: {
        origin: (origin, callback) => {
            // السماح للطلبات بدون origin (تطبيقات الموبايل، Postman، إلخ)
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('غير مسموح بالاتصال من هذا النطاق'));
            }
        },
        credentials: true
    }
});

// ==========================================
// 🛡️ التحديث المعماري للزمن الفعلي (Mongoose Global Plugin)
// تم إزالة تعديل Prototype الخطير لضمان سلامة الذاكرة (No Memory Leaks)
// ==========================================
mongoose.plugin((schema) => {
    const triggerUpdate = () => { io.emit('update_data'); };
    schema.post('save', triggerUpdate);
    schema.post('findOneAndUpdate', triggerUpdate);
    schema.post('updateOne', triggerUpdate);
    schema.post('updateMany', triggerUpdate);
    schema.post('findOneAndDelete', triggerUpdate);
    schema.post('deleteOne', triggerUpdate);
    schema.post('deleteMany', triggerUpdate);
});

// ==========================================
// 🛡️ جدار الحماية والأمان (Security Middlewares)
// ==========================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com"],
            fontSrc: ["'self'", "fonts.gstatic.com", "cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:", "*.telegram.org", "assets.mixkit.co"],
            connectSrc: ["'self'", "wss:", "ws:"],
            mediaSrc: ["'self'", "assets.mixkit.co"],
            frameSrc: ["'none'"],
        }
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permissionsPolicy: {
        features: { camera: ["'none'"], microphone: ["'none'"], geolocation: ["'none'"] }
    }
}));

app.use(cors({ origin: allowedOrigins, credentials: true }));

const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, 
    max: 2000, 
    message: 'معدل الطلبات مرتفع جداً، يرجى المحاولة بعد قليل.',
    standardHeaders: true, 
    legacyHeaders: false,
});
app.use(limiter);

// 📊 Request Logger + Prometheus Metrics
app.use(requestLogger);
app.use(metricsMiddleware);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.set('view engine', 'ejs');

const startAdminBot = require('./bots/admin/index');
const { startAllClientBots } = require('./bots/client/manager');
const { startAllExecutorBots } = require('./bots/executor/manager');
let sessionStore;
try {
    const { default: MongoStore } = require('connect-mongo');
    sessionStore = MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI, 
        ttl: 24 * 60 * 60,
        autoRemove: 'native'
    });
    console.log('✅ Session Store: MongoDB (connect-mongo)');
} catch (error) {
    console.warn("⚠️ تحذير: تعذر تحميل connect-mongo — استخدام MemoryStore.");
    sessionStore = new session.MemoryStore();
}

app.use(session({
    secret: process.env.SESSION_SECRET || 'ahram-super-secret-key-2026',
    resave: false, 
    saveUninitialized: false, 
    store: sessionStore, 
    cookie: { secure: process.env.SECURE_COOKIE === 'true', httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use((req, res, next) => {
    res.locals.adminName = req.session.adminName || 'مدير';
    // ✅ إصلاح: استخدام adminRole (وليس role) بما يتوافق مع auth middleware
    res.locals.role = req.session.adminRole || null;
    next();
});

const { syncBotBalance } = require('./services/balanceService');

// ==========================================
// 🔗 ربط المسارات المنفصلة
// ==========================================
app.use('/client', require('./routes/clientPortal'));
app.use('/executor-portal', require('./routes/executorPortal'));
app.use('/api/mobile', require('./routes/mobileApi'));
app.use('/api/bot', require('./routes/botApi')); // 🟢 مسار البوتات الجديد


app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/adminTransactions'));
app.use('/', require('./routes/executors'));
app.use('/', require('./routes/clients'));
app.use('/admin-reports', require('./routes/adminReports'));
app.use('/closing', requireAuth, require('./routes/adminClosing'));
app.use('/settings', require('./routes/settings'));
app.use('/', require('./routes/employees'));
app.use('/', require('./routes/broadcast'));
app.use('/', require('./routes/support'));
app.use('/audit-log', requireAuth, require('./routes/auditLog'));




app.use('/api/v1/merchant', require('./routes/merchantApi'));

// 📚 Swagger API Documentation
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Al-Ahram Pay API Docs'
}));

// 📊 Prometheus Metrics Endpoint
app.get('/metrics', metricsEndpoint);

// 🏥 Health Check Endpoints
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString(), version: '2.0.0' });
});
app.get('/health/ready', async (req, res) => {
    try {
        const dbState = require('mongoose').connection.readyState;
        const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';
        res.json({ status: dbState === 1 ? 'ok' : 'degraded', db: dbStatus, uptime: process.uptime() });
    } catch (e) {
        res.status(503).json({ status: 'error', db: 'unreachable' });
    }
});

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
    server.listen(PORT, () => {
        logger.info(`🟢 Al-Ahram Pay v2.0 running on port ${PORT}`, { port: PORT, env: process.env.NODE_ENV || 'development' });
        console.log(`🟢 السيرفر يعمل بقوة الزمن الفعلي والحماية الشاملة على البورت ${PORT}`);
        try {
            startAdminBot();
            startAllClientBots();
            startAllExecutorBots();
        } catch (e) { console.error('⚠️ خطأ أثناء تشغيل البوتات:', e.message); }

        // تسجيل بدء تشغيل النظام في Audit Log
        const { logAction } = require('./services/auditService');
        logAction({ action: 'SYSTEM_STARTUP', metadata: { port: PORT, nodeVersion: process.version } }).catch(() => {});
    });
});
