// services/externalApiService.js
const axios = require('axios');
const https = require('https');
const puppeteer = require('puppeteer');

// 🚀 دالة التخاطب مع شركة زين
const executeTransferViaApi = async (tx, apiBot) => {
    let processLog = [];
    const addLog = (step, detail) => {
        const timeStr = new Date().toLocaleTimeString('en-GB', { hour12: false });
        processLog.push(`[${timeStr}] ${step}: ${detail}`);
    };

    try {
        const targetNumber = tx.vodafoneNumber || tx.accountNumber;
        const amount = tx.amount;
        
        let baseUrl = apiBot.apiUrl ? apiBot.apiUrl.replace(/\/$/, '') : 'https://zaynpay.com';
        if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;

        const defaultHeaders = {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 Ahram-Server/1.0',
            'Accept': 'application/json'
        };

        const authPayload = {
            UserName: process.env.ZAYN_USERNAME, 
            Password: process.env.ZAYN_PASSWORD,
            AppType: "1",
            AppId: "app12",
            VersionID: "Samsuang-502"
        };

        if (!authPayload.UserName || !authPayload.Password) {
            addLog("AUTH_ERROR", "بيانات شركة زين مفقودة من ملف .env");
            return { success: false, message: 'خطأ إعدادات: بيانات الاتصال مفقودة', processLog: processLog.join('\n') };
        }

        addLog("AUTH", "جاري إرسال طلب تسجيل الدخول...");
        const authRes = await axios.post(`${baseUrl}/api/Account/GetToken`, authPayload, { headers: defaultHeaders, timeout: 15000 });

        if (authRes.data.Code !== 200 || !authRes.data.Data || !authRes.data.Data.Access_Token) {
            addLog("AUTH_FAIL", authRes.data.Message || "تم رفض تسجيل الدخول من الشركة");
            return { success: false, message: 'فشل تسجيل الدخول لشركة زين', processLog: processLog.join('\n') };
        }
        
        const freshToken = authRes.data.Data.Access_Token;
        addLog("AUTH_SUCCESS", `تم استلام التوكن بنجاح`);

        const headers = { ...defaultHeaders, 'Authorization': `Bearer ${freshToken}`, 'Accept-Language': 'ar-EG' };
        
        addLog("INQUIRY", `جاري الاستعلام وفحص الرقم [${targetNumber}]...`);
        const inquiryPayload = { Fields: [ { Key: "Key1", Value: targetNumber } ], ServiceId: 307, InqueryAmount: amount.toString() };
        const inquiryRes = await axios.post(`${baseUrl}/api/V1/Transactions/Inquiry`, inquiryPayload, { headers, timeout: 20000 });

        if (inquiryRes.data.Code !== 200 || !inquiryRes.data.Data || !inquiryRes.data.Data.PaymentBillInfo) {
            addLog("INQUIRY_FAIL", inquiryRes.data.Message || "رد غير متوقع من سيرفر الشركة");
            return { success: false, message: 'تم رفض الاستعلام من الشركة', processLog: processLog.join('\n') };
        }
        
        addLog("INQUIRY_SUCCESS", "الرقم سليم ومتاح للتحويل.");
        addLog("PAYMENT", `جاري إرسال الدفعة النهائية بقيمة [${amount} EGP]...`);
        
        const paymentPayload = {
            Fields: [ { Key: "Key1", Value: targetNumber } ], ServiceId: 307,
            PaymentBillInfo: inquiryRes.data.Data.PaymentBillInfo, Amount: amount, MachineSerial: "XP1"
        };
        const paymentRes = await axios.post(`${baseUrl}/api/V1/Transactions/Payment`, paymentPayload, { headers, timeout: 180000 });

        const pd = paymentRes.data.Data || {};
        const print = pd.PrintBill || {};
        const extRef = pd.TransactionNumber ? pd.TransactionNumber.toString() : '---';
        const refTxNum = pd.RefTransactionNumber || print.RefTransactionNumber || print.RefNumber || '';

        const prettyLog = `
=========================================
[ التفاصيل المالية والتشغيلية للعملية ]
- رقم الموبايل   : ${targetNumber}
- القيمة         : ${pd.Amount || amount} EGP
- الرصيد قبل     : ${pd.BalanceBefore !== undefined ? pd.BalanceBefore + ' EGP' : '---'}
- الرصيد بعد     : ${pd.BalanceAfter !== undefined ? pd.BalanceAfter + ' EGP' : '---'}
- الحالة         : ${pd.Status || paymentRes.data.Message || '---'}
- رقم العملية    : ${extRef}
- وقت العملية    : ${pd.TransactionTime || new Date().toLocaleString('ar-EG')}
- الرقم المرجعي  : ${refTxNum || 'غير متوفر'}
=========================================
[ الاستجابة البرمجية الخام - Raw JSON ]\n${JSON.stringify(paymentRes.data, null, 2)}`;

        if (paymentRes.data.Code === 200 && paymentRes.data.Data && paymentRes.data.Data.TransactionNumber) {
            if (!refTxNum || refTxNum.trim() === '') {
                addLog("PAYMENT_PENDING", `تم إرسال الدفعة ولكن لم يتم استلام المرجع من الشبكة.`);
                addLog("API_FULL_RESPONSE", prettyLog);
                return { success: 'pending', external_transaction_id: extRef, message: 'قيد الانتظار', processLog: processLog.join('\n') };
            }
            addLog("PAYMENT_SUCCESS", `اكتملت العملية بنجاح! رقم المرجع: ${extRef}`);
            addLog("API_FULL_RESPONSE", prettyLog);
            return { success: true, external_transaction_id: extRef, message: paymentRes.data.Message || 'تم التحويل الآلي', sender_number: refTxNum, processLog: processLog.join('\n') };
        } else {
            addLog("PAYMENT_FAIL", paymentRes.data.Message || "تم الرفض أثناء التنفيذ النهائي");
            addLog("API_FULL_RESPONSE", prettyLog);
            return { success: false, message: paymentRes.data.Message || 'تم الرفض', processLog: processLog.join('\n') };
        }

    } catch (error) {
        addLog("SYSTEM_ERROR", error.message);
        return { success: false, message: 'خطأ في الاتصال بسيرفر الشركة', processLog: processLog.join('\n') };
    }
};

// 🧾 صانع إيصالات الـ API الذكي
const generateCustomReceipt = async (tx, apiResult) => {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process'] });
        const page = await browser.newPage();
        await page.setViewport({ width: 450, height: 800 }); 
        
        const now = new Date(); const dateStr = now.toLocaleDateString('en-GB').replace(/\//g, '-'); const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        const htmlContent = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap');body { margin: 0; padding: 0; background: #fff; }#receipt-container { width: 450px; padding: 40px; background: white; color: black; font-family: 'Tajawal', sans-serif; text-align: center; box-sizing: border-box; display: inline-block; }.dashed-line { border-top: 2px dashed #000; margin: 20px 0; }h1 { font-size: 40px; font-weight: 500; margin: 0; }h2 { font-size: 32px; font-weight: 500; margin: 10px 0; }h3 { font-size: 44px; font-weight: 500; margin: 15px 0; }p { font-size: 24px; margin: 8px 0; font-weight: 400; }.success { font-size: 44px; font-weight: 500; margin: 25px 0; }.time-row { display: flex; justify-content: center; gap: 5px; font-size: 24px; direction: ltr; }</style></head><body><div id="receipt-container"><h1>المحافظ الذكية</h1><div class="dashed-line"></div><p>رقم العميل</p><h3>${tx.vodafoneNumber || tx.accountNumber}</h3><div class="dashed-line"></div><p>القيمة: ${tx.amount} جنية</p><div class="success">عملية ناجحة</div><p>الرقم المرجعي: ${apiResult.sender_number || apiResult.external_transaction_id || '---'}</p><p>الرقم المرجعي للاستدلال فقط</p><p>لا يجوز التحويل له نهائيا</p><div class="time-row"><span>التاريخ:</span><span>${dateStr}</span><span>${timeStr}</span></div><div class="dashed-line"></div><p>التاجر: Zone Tech - 01108172258</p><div class="dashed-line"></div><p>في حالة بطئ الشبكات قد تستغرق العملية حتي 60 دقيقة</p><div class="dashed-line"></div></div></body></html>`;
        
        await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 15000 });
        await page.evaluateHandle('document.fonts.ready');
        await new Promise(resolve => setTimeout(resolve, 500)); 
        const element = await page.$('#receipt-container');
        return await element.screenshot({ type: 'jpeg', quality: 100 });
    } catch (error) { return null; } finally { if (browser) await browser.close(); }
};

module.exports = { executeTransferViaApi, generateCustomReceipt };
