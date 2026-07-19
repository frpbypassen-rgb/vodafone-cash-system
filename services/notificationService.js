const { Telegram } = require('telegraf');
const Notification = require('../models/Notification'); // موديل الإشعارات الموجود لديك

/**
 * خدمة الإشعارات المعزولة (Decoupled Notification Service)
 * تضمن عدم توقف النظام أو انهياره إذا تعطل سيرفر تيليجرام أو تم حظر البوت
 */
class NotificationService {
    
    // إرسال رسالة نصية آمنة
    static async sendSafeMessage(token, telegramId, message, markup = { parse_mode: 'HTML' }) {
        if (!telegramId || !token) return null;
        
        try {
            const api = new Telegram(token);
            const sent = await api.sendMessage(telegramId, message, markup);
            return sent;
        } catch (error) {
            console.error(`⚠️ [Telegram Fallback] فشل إرسال رسالة لـ ${telegramId}: ${error.message}`);
            
            // 🟢 إذا فشل تيليجرام، يتم حفظ الإشعار في قاعدة البيانات ليراه المستخدم في الموقع!
            try {
                await Notification.create({
                    userId: telegramId,
                    title: 'إشعار نظام (لم يصل للتليجرام)',
                    message: message.replace(/<[^>]*>?/gm, ''), // إزالة كود الـ HTML
                    type: 'system_alert'
                });
            } catch (dbError) {}
            
            return null; // نرجع null بدلاً من أن ينهار التطبيق
        }
    }

    // إرسال صورة آمنة
    static async sendSafePhoto(token, telegramId, photoData, options = { parse_mode: 'HTML' }) {
        if (!telegramId || !token || !photoData) return null;

        try {
            const api = new Telegram(token);
            const sent = await api.sendPhoto(telegramId, photoData, options);
            return sent;
        } catch (error) {
            console.error(`⚠️ [Telegram Fallback] فشل إرسال صورة لـ ${telegramId}: ${error.message}`);
            // محاولة إرسال النص فقط إذا فشلت الصورة (مثلاً بسبب ضعف الإنترنت)
            if (options.caption) {
                return await this.sendSafeMessage(token, telegramId, `🖼️ (مرفق صورة تعذر إرسالها)\n\n${options.caption}`, { parse_mode: options.parse_mode });
            }
            return null;
        }
    }
}

module.exports = NotificationService;