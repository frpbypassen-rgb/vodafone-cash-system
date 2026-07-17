// middlewares/errorHandler.js

const errorHandler = (err, req, res, next) => {
    console.error(`[🔥 Global Error]: ${err.message}`);

    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode);

    // إذا كان الطلب من الموبايل أو الـ API
    if (req.xhr || req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/client') || req.originalUrl.startsWith('/executor-portal')) {
        return res.json({
            success: false,
            error: 'حدث خطأ داخلي في الخادم، يرجى المحاولة لاحقاً.'
        });
    }

    // إذا كان الطلب من لوحة تحكم الويب
    res.send(`
        <div style="text-align: center; padding: 50px; font-family: sans-serif; background-color: #f8fafc; height: 100vh;">
            <div style="background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); max-width: 500px; margin: 0 auto;">
                <h1 style="color: #ef4444; font-size: 50px; margin-bottom: 10px;">⚠️</h1>
                <h2 style="color: #1e293b;">عذراً، حدث خطأ مفاجئ!</h2>
                <p style="color: #64748b; margin-bottom: 30px;">لقد تم تسجيل الخطأ في النظام وسيقوم الدعم الفني بمراجعته.</p>
                <a href="/" style="padding: 12px 25px; background: #3b82f6; color: white; text-decoration: none; border-radius: 10px; font-weight: bold;">العودة للرئيسية</a>
            </div>
        </div>
    `);
};

// معالج الصفحات غير الموجودة (404)
const notFoundHandler = (req, res, next) => {
    if (req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(404).json({ success: false, error: 'المسار غير موجود على السيرفر. تأكد أن آخر تحديث تم سحبه وتشغيله.' });
    }
    res.status(404).send('الصفحة أو المسار غير موجود (404)');
};

module.exports = { errorHandler, notFoundHandler };
