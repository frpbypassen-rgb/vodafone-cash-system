const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    rateLevel1: { type: Number, default: 6.40 },
    rateLevel2: { type: Number, default: 6.45 },
    rateLevel3: { type: Number, default: 6.50 },
    
    openingTime: { type: String, default: '09:00' },
    closingTime: { type: String, default: '23:00' },
    isManualClosed: { type: Boolean, default: false },
    
    welcomeMessage: { type: String, default: 'مرحباً بك في منظومة الأهرام الرقمية للصرافة.' },
    termsMessage: { type: String, default: '⚠️ يرجى التأكد من الرقم قبل الإرسال.\nالتحويل يتم خلال دقائق.' },
    closedMessage: { type: String, default: 'نعتذر، المنظومة مغلقة حالياً. يرجى المحاولة في أوقات العمل الرسمية.' },
    supportContact: { type: String, default: '@AhramSupport' },

    autoRouteEnabled: { type: Boolean, default: false },
    autoRouteBotId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExecutorBot', default: null },

    executorWelcomeMessage: { type: String, default: 'أهلاً بك في لوحة تحكم التنفيذ الخاصة بشركة الأهرام.' },
    executorPendingMessage: { type: String, default: '⏳ حسابك لا يزال قيد المراجعة من قبل الإدارة.' },
    executorBannedMessage: { type: String, default: '⛔️ تم حظر حسابك. يرجى مراجعة الإدارة.' },

    // 🟢 إعدادات إكسيل (العملاء والشركات)
    excelTitleBg: { type: String, default: '#002060' }, 
    excelHeaderBg: { type: String, default: '#C00000' }, 
    excelTotalBg: { type: String, default: '#E2EFDA' }, 
    excelFontSize: { type: Number, default: 11 },
    excelColWidth: { type: Number, default: 16 }, 
    excelRowHeight: { type: Number, default: 25 }, 
    excelAlignment: { type: String, default: 'center' }, 
    excelMainTitle: { type: String, default: 'فـاتـورة كـشـف حـسـاب - شـركـة الأهرام للخدمات الرقمية' }, 
    excelColNames: { type: String, default: 'رقم الحوالة,الموظف,رقم الهاتف (المصري),القيمة (EGP),سعر الصرف,التكلفة (LYD),التاريخ' },
    excelColKeys: { type: String, default: 'id,employee,phone,amount,rate,cost,date' },
    excelSummaryNames: { type: String, default: 'إجمالي المحول (جنيه),القيمة السابقة (دينار),المجموع (سحوبات اليوم),القيمة المسددة (إيداعات),صافي الحساب الكلي' },
    excelSummaryKeys: { type: String, default: 'totalEGP,prevLYD,totalLYD,deposits,netBalance' },

    // 🔵 إعدادات إكسيل (الموظفين والتنفيذ)
    execExcelTitleBg: { type: String, default: '#4B0082' }, // لون افتراضي (بنفسجي غامق)
    execExcelHeaderBg: { type: String, default: '#800080' }, 
    execExcelTotalBg: { type: String, default: '#E6E6FA' }, 
    execExcelFontSize: { type: Number, default: 11 },
    execExcelColWidth: { type: Number, default: 16 }, 
    execExcelRowHeight: { type: Number, default: 25 }, 
    execExcelAlignment: { type: String, default: 'center' }, 
    execExcelMainTitle: { type: String, default: 'سـجـل الـتـنـفـيـذ والـعـمـلـيـات - شـركـة الأهرام' }, 
    execExcelColNames: { type: String, default: 'رقم الطلب,اسم المنفذ,رقم المحفظة (مصر),المبلغ (EGP),حالة الطلب,تاريخ الإنشاء' },
    execExcelColKeys: { type: String, default: 'id,employee,phone,amount,status,date' },
    execExcelSummaryNames: { type: String, default: 'إجمالي المحول (المجموع),القيمة السابقة,المسدد (إيداعات),المجموع الكلي' },
    execExcelSummaryKeys: { type: String, default: 'totalEGP,prevValue,paid,grandTotal' }
});

module.exports = mongoose.model('Settings', settingsSchema);