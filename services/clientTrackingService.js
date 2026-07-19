// services/clientTrackingService.js
const { Telegram } = require('telegraf');
const ClientBot = require('../models/ClientBot');
const Transaction = require('../models/Transaction');

const updateClientTracking = async (txId, statusStep, extraNote = '', imageBuffer = null) => {
    try {
        const tx = await Transaction.findById(txId);
        if (!tx || !tx.userId) return false;

        let clientAPI = new Telegram(tx.clientBotId ? (await ClientBot.findById(tx.clientBotId)).token : process.env.CLIENT_BOT_TOKEN);

        // 🟢 استرجاع الـ ID بأمان (حتى لو كانت قاعدة البيانات تخفيه)
        const clientMsgId = tx.get('clientMessageId'); 

        // 1. 🗑️ مسح الرسالة القديمة من شات العميل لكي لا يحدث إزعاج
        if (clientMsgId) {
            try {
                await clientAPI.deleteMessage(tx.userId, clientMsgId);
            } catch (e) {
                console.log('[Live Tracking] الرسالة القديمة ممسوحة مسبقاً أو غير موجودة');
            }
        }

        // 2. 📝 تجهيز النص بالحالات التي طلبتها بالحرف الواحد!
        let statusText = '';
        switch(statusStep) {
            case 'sent_to_admin':
                statusText = '🟡 <b>تم الارسال للادارة</b>'; break;
            case 'processing':
                statusText = '🟠 <b>في طابور الانتظار</b>'; break;
            case 'accepted':
                statusText = '⚙️ <b>قيد العمل عليها</b>'; break;
            case 'pending':
                statusText = '🔄 <b>الرجوع الى طابور الانتظار</b>'; break;
            case 'completed':
                statusText = '✅ <b>اكتملت العملية</b>'; break;
            case 'completed_modified':
                statusText = `✅ <b>تم التعديل علي المبلغ</b>\n⚠️ ${extraNote}`; break;
            case 'rejected':
            case 'cancelled':
                statusText = `❌ <b>تم الالغاء</b>\n⚠️ السبب: ${extraNote}`; break;
            default:
                statusText = '🟡 <b>تم الارسال للادارة</b>';
        }

        // 🟢 استخراج ملاحظة العميل الصافية
        let cleanNote = tx.notes ? tx.notes.split('\n[')[0].split('\n---')[0].trim() : '';
        const clientNoteDisplay = cleanNote ? `\n📝 <b>ملاحظة العميل:</b> ${cleanNote}` : '';
        let displayTarget = tx.vodafoneNumber || tx.accountNumber || '---';

        const trackingMsgText = `🔄 <b>سجل متابعة الحوالة</b>\n` +
                                `━━━━━━━━━━━━━━\n` +
                                `🧾 <b>الطلب:</b> <code>${tx.customId || tx._id}</code>\n` +
                                `📞 <b>المحول إليه:</b> <code>${displayTarget}</code>\n` +
                                `🇪🇬 <b>المبلغ:</b> ${tx.amount} جنيه\n` +
                                `💰 <b>التكلفة:</b> ${tx.costLYD ? tx.costLYD.toFixed(2) : 0} دينار` +
                                `${clientNoteDisplay}\n` +
                                `━━━━━━━━━━━━━━\n` +
                                `🚦 <b>الحالة الآن:</b> ${statusText}`;

        let sentMsg;
        // 3. 🚀 إرسال الرسالة الجديدة (كصورة إذا اكتملت، أو نص عادي للانتظار)
        if ((statusStep === 'completed' || statusStep === 'completed_modified') && imageBuffer) {
            sentMsg = await clientAPI.sendPhoto(tx.userId, { source: imageBuffer }, { caption: trackingMsgText, parse_mode: 'HTML' });
        } else {
            sentMsg = await clientAPI.sendMessage(tx.userId, trackingMsgText, { parse_mode: 'HTML' });
        }

        // 4. 💾 حفظ رقم الرسالة الجديدة في قاعدة البيانات بالقوة القاهرة لكي يتم مسحها في الخطوة التي تليها
        if (sentMsg) {
            tx.set('clientMessageId', sentMsg.message_id, { strict: false });
            await tx.save();
        }

        return true;
    } catch (e) {
        console.error('[Live Tracking Error]:', e.message);
        return false;
    }
};

module.exports = { updateClientTracking };