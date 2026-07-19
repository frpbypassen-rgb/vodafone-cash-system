// bots/admin/scenes/exchangeRateScene.js
const { Scenes, Markup, Telegram } = require('telegraf');
const { createCanvas, loadImage } = require('canvas'); 
const path = require('path');
const Settings = require('../../../models/Settings');
const User = require('../../../models/User');
const ClientBot = require('../../../models/ClientBot');
const ClientEmployee = require('../../../models/ClientEmployee');

const mainClientBotAPI = new Telegram(process.env.CLIENT_BOT_TOKEN);

// 🚀 خوارزمية البث الذكي (ترسل 25 رسالة في نفس اللحظة وتنتظر ثانية لتفادي الحظر)
const broadcastForBot = async (api, chatIds, photoBuffer, caption) => {
    if (!chatIds || chatIds.length === 0) return;

    let fileId = null;
    let startIndex = 0;

    // 1. رفع الصورة لأول شخص للحصول على معرف الملف (file_id) لسرعة البرق
    if (photoBuffer) {
        try {
            const sentMsg = await api.sendPhoto(chatIds[0], { source: photoBuffer }, { caption, parse_mode: 'HTML' });
            fileId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
            startIndex = 1; // نجحنا، نبدأ من الشخص الثاني
        } catch (err) {
            console.error("فشل إرسال الصورة الأولى:", err.message);
            // إذا فشل الأول، سنرسلها كـ Buffer للكل أو كنص
        }
    }

    // 2. تقسيم باقي المستخدمين إلى حزم (25 مستخدم في كل حزمة)
    const remainingIds = chatIds.slice(startIndex);
    const chunkSize = 25; 

    for (let i = 0; i < remainingIds.length; i += chunkSize) {
        const chunk = remainingIds.slice(i, i + chunkSize);
        
        // إرسال الحزمة بالكامل في نفس اللحظة (بدون انتظار كل رسالة على حدة)
        const promises = chunk.map(chatId => {
            if (fileId) {
                return api.sendPhoto(chatId, fileId, { caption, parse_mode: 'HTML' });
            } else if (photoBuffer) {
                return api.sendPhoto(chatId, { source: photoBuffer }, { caption, parse_mode: 'HTML' });
            } else {
                return api.sendMessage(chatId, caption, { parse_mode: 'HTML' });
            }
        });

        // انتظار اكتمال إرسال الـ 25 رسالة
        await Promise.allSettled(promises);

        // انتظار ثانية واحدة فقط بين كل 25 رسالة (احتراماً لحدود تليجرام 30 رسالة/ثانية)
        if (i + chunkSize < remainingIds.length) {
            await new Promise(res => setTimeout(res, 1000));
        }
    }
};


const exchangeRateWizard = new Scenes.WizardScene(
    'EXCHANGE_RATE_SCENE',
    // 1️⃣ الخطوة الأولى: عرض الأسعار الحالية
    async (ctx) => {
        const set = await Settings.findOne({}) || await Settings.create({});
        await ctx.reply(
            `📊 <b>تعديل أسعار الصرف الحالية:</b>\n` +
            `1️⃣ المستوى الأول: ${set.rateLevel1 || 6.40}\n` +
            `2️⃣ المستوى الثاني: ${set.rateLevel2 || 6.45}\n` +
            `3️⃣ المستوى الثالث: ${set.rateLevel3 || 6.50}\n\n` +
            `اختر المستوى المراد تعديله:`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('تعديل المستوى 1', 'edit_1')],
                    [Markup.button.callback('تعديل المستوى 2', 'edit_2')],
                    [Markup.button.callback('تعديل المستوى 3', 'edit_3')],
                    [Markup.button.callback('🔙 إلغاء', 'cancel')]
                ])
            }
        );
        return ctx.wizard.next();
    },
    // 2️⃣ الخطوة الثانية: طلب السعر الجديد
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'cancel') {
            await ctx.editMessageText('✅ تم الإلغاء.');
            return ctx.scene.leave();
        }
        ctx.wizard.state.level = ctx.callbackQuery.data.split('_')[1];
        await ctx.editMessageText(`📝 أرسل سعر الصرف الجديد للمستوى [ ${ctx.wizard.state.level} ]:`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'back')]])
        });
        return ctx.wizard.next();
    },
    // 3️⃣ الخطوة الثالثة: طباعة الصورة والحفظ والبث اللحظي (الصاروخي) 🚀
    async (ctx) => {
        if (ctx.callbackQuery?.data === 'back') {
            ctx.wizard.selectStep(0);
            return ctx.wizard.steps[0](ctx);
        }

        const newRate = parseFloat(ctx.message?.text);
        if (isNaN(newRate) || newRate <= 0) {
            return ctx.reply('❌ يرجى إرسال رقم صحيح (مثال: 6.42):');
        }

        const level = ctx.wizard.state.level;
        const updateField = `rateLevel${level}`;
        
        const set = await Settings.findOne({}) || await Settings.create({});
        const oldRate = set[updateField] || 0;

        await Settings.updateOne({}, { [updateField]: newRate }, { upsert: true });

        // نرد على المدير فوراً (لعدم تجميد البوت في وجهه)
        await ctx.reply(`✅ <b>تم تحديث السعر بنجاح إلى: ${newRate}</b>\n\n🖼️ جاري تجهيز التصميم وإرسال الإشعارات للعملاء والشركات بسرعة البرق 🚀...`, {parse_mode: 'HTML'});

        // 🟢 تشغيل الإرسال في الخلفية
        (async () => {
            let photoBuffer = null;
            try {
                const templatePath = path.join(process.cwd(), 'assets', 'rate_template.png');
                const image = await loadImage(templatePath);
                const canvas = createCanvas(image.width, image.height);
                const ctxCanvas = canvas.getContext('2d');
                
                ctxCanvas.drawImage(image, 0, 0, image.width, image.height);

                const h = image.height;
                const w = image.width;

                ctxCanvas.textAlign = 'left';
                const newRateStr = newRate.toFixed(2);
                const startX = w * 0.725; 
                
                ctxCanvas.font = `bold ${Math.floor(h * 0.11)}px "Arial"`;
                ctxCanvas.fillStyle = '#fce270'; 
                ctxCanvas.fillText(newRateStr, startX, h * 0.54);
                
                const newRateWidth = ctxCanvas.measureText(newRateStr).width;
                ctxCanvas.font = `bold ${Math.floor(h * 0.045)}px "Arial"`;
                ctxCanvas.fillText(' EGP', startX + newRateWidth + 5, h * 0.54);

                const oldRateStr = oldRate.toFixed(2);
                ctxCanvas.font = `bold ${Math.floor(h * 0.07)}px "Arial"`;
                ctxCanvas.fillStyle = '#83c6f4'; 
                ctxCanvas.fillText(oldRateStr, startX, h * 0.65);
                
                const oldRateWidth = ctxCanvas.measureText(oldRateStr).width;
                ctxCanvas.font = `bold ${Math.floor(h * 0.035)}px "Arial"`;
                ctxCanvas.fillText(' EGP', startX + oldRateWidth + 5, h * 0.65);

                const bottomText = `1 LYD = ${newRateStr} EGP`;
                ctxCanvas.textAlign = 'center';
                ctxCanvas.font = `bold ${Math.floor(h * 0.055)}px "Arial"`;
                ctxCanvas.fillStyle = '#55ff55'; 
                ctxCanvas.fillText(bottomText, w / 2, h * 0.77);

                photoBuffer = canvas.toBuffer('image/png');
            } catch (error) {
                console.error('Image Generation Error:', error.message);
            }

            try {
                const notifyMsg = `🔔 <b>تحديث هام: سعر الصرف الجديد</b>\n\nنود إعلامكم بأنه تم تحديث سعر الصرف ليصبح الآن:\n💰 <b>1 دينار ليبي = ${newRate.toFixed(2)} جنية مصري</b>\n\nنتمنى لكم يوماً سعيداً مع خدمات الأهرام 🚀`;

                // 🚀 1. تجهيز عملاء البوت الرئيسي
                const users = await User.find({ status: 'active', tier: parseInt(level) });
                const mainUserIds = users.map(u => u.telegramId);
                const mainPromise = broadcastForBot(mainClientBotAPI, mainUserIds, photoBuffer, notifyMsg);

                // 🚀 2. تجهيز موظفي الشركات (كل بوت يرسل لموظفيه)
                const companies = await ClientBot.find({ status: 'active', tier: parseInt(level) });
                const compPromises = companies.map(async (comp) => {
                    const compAPI = new Telegram(comp.token);
                    const emps = await ClientEmployee.find({ clientBotId: comp._id, status: 'active' });
                    const empIds = emps.map(e => e.telegramId);
                    return broadcastForBot(compAPI, empIds, photoBuffer, notifyMsg);
                });

                // 🚀 3. تشغيل جميع البوتات في نفس اللحظة (Parallel Execution)
                // لأن تليجرام يعطي 30 رسالة/ثانية (لكل بوت منفصل)، فالإرسال سيكون جنونياً في السرعة.
                await Promise.allSettled([mainPromise, ...compPromises]);
                
                // إخبار المدير بانتهاء الإرسال
                await ctx.reply(`📢 <b>اكتمل الإرسال اللحظي!</b>\nتم إيصال الصورة وإشعار السعر الجديد لجميع المشتركين والموظفين بنجاح وبسرعة فائقة.`, {parse_mode: 'HTML'});

            } catch (error) {
                console.error('Broadcast Error:', error);
            }
        })();

        return ctx.scene.leave();
    }
);

module.exports = exchangeRateWizard;