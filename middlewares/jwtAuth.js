const jwt = require('jsonwebtoken');

// 🛡️ حماية قصوى: لا يُسمح بتشغيل السيرفر بدون مفاتيح سرية حقيقية
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('🚨 [FATAL] JWT_SECRET غير موجود أو قصير جداً (أقل من 32 حرف). يُرجى ضبطه في ملف .env');
    process.exit(1);
}
if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET.length < 32) {
    console.error('🚨 [FATAL] JWT_REFRESH_SECRET غير موجود أو قصير جداً (أقل من 32 حرف). يُرجى ضبطه في ملف .env');
    process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];

        jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
            if (err) {
                return res.status(401).json({
                    success: false,
                    code: 'TOKEN_EXPIRED',
                    message: 'جلستك الحالية انتهت، يرجى تحديث التوكن (Refresh Token)'
                });
            }
            req.user = decodedUser;
            next();
        });
    } else {
        res.status(401).json({
            success: false,
            code: 'UNAUTHORIZED',
            message: 'غير مصرح بالوصول، التوكن مفقود'
        });
    }
};

module.exports = { authenticateJWT, JWT_SECRET, JWT_REFRESH_SECRET };