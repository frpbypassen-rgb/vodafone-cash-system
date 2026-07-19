const { Scenes, Markup } = require('telegraf');
const { createBotApi } = require('../../apiHelper');

const editPrompt = async (ctx, text, markup) => {
    try {
        if (ctx.wizard.state.promptMsgId) {
            await ctx.telegram.editMessageText(ctx.chat.id, ctx.wizard.state.promptMsgId, null, text, { parse_mode: 'HTML', ...markup });
        } else {
            const sent = await ctx.reply(text, { parse_mode: 'HTML', ...markup });
            ctx.wizard.state.promptMsgId = sent.message_id;
        }
    } catch (e) {
        const sent = await ctx.reply(text, { parse_mode: 'HTML', ...markup });
        ctx.wizard.state.promptMsgId = sent.message_id;
    }
};

const transferWizard = new Scenes.WizardScene(
    'TRANSFER_SCENE',
    
    // 1️⃣ الخطوة الأولى: التحقق من الشروط وطلب رقم الهاتف
    async (ctx) => {
        ctx.wizard.state.botData = ctx.scene.state.botData;
        ctx.wizard.state.isMainBot = ctx.scene.state.isMainBot;
        
        ctx.wizard.state.phoneAttempts = 0;
        ctx.wizard.state.amountAttempts = 0;

        const token = ctx.scene.state.isMainBot ? process.env.CLIENT_BOT_TOKEN : ctx.scene.state.botData.token;
        ctx.wizard.state.api = createBotApi(token);

        try {
            const { data } = await ctx.wizard.state.api.get('/settings');
            const set = data.settings || {};
            const now = new Date();
            const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            
            if (set.isManualClosed || currentTime < set.openingTime || currentTime > set.closingTime) {
                await ctx.reply(`⚠️ <b>نعتذر منك:</b>\n\n${set.closedMessage}`, { parse_mode: 'HTML' });
                return ctx.scene.leave();
            }

            const termsMsg = set.termsMessage || '1. يرجى التأكد من الرقم قبل الإرسال.\n2. التحويل يتم خلال دقائق.';
            await ctx.reply(`⚠️ <b>شروط وقواعد التحويل:</b>\n\n${termsMsg}`, { parse_mode: 'HTML' });
        } catch (error) {}

        const text = '📞 <b>تحويل إلى مصر</b>\n\nالرجاء إرسال رقم المحفظة في مصر (11 رقم):';
        const markup = Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء العملية', 'cancel_transfer')]]);
        
        const sent = await ctx.reply(text, { parse_mode: 'HTML', ...markup });
        ctx.wizard.state.promptMsgId = sent.message_id;

        return ctx.wizard.next();
    },

    // 2️⃣ الخطوة الثانية: استقبال رقم الهاتف والتحقق منه
    async (ctx) => {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery().catch(() => {});
            if (ctx.callbackQuery.data === 'cancel_transfer') {
                await editPrompt(ctx, '❌ تم إلغاء العملية والعودة للقائمة الرئيسية.', {});
                return ctx.scene.leave();
            }
        }

        if (ctx.message) {
            await ctx.deleteMessage().catch(()=>{}); 
            
            const number = ctx.message.text?.trim();
            const isValidPhone = number && /^01[0125]\d{8}$/.test(number);

            if (!isValidPhone) {
                ctx.wizard.state.phoneAttempts += 1; 
                
                if (ctx.wizard.state.phoneAttempts >= 2) {
                    await editPrompt(ctx, '❌ لقد قمت بإدخال رقم هاتف غير صحيح مرتين متتاليتين.\nتم إلغاء العملية لحماية النظام، يمكنك المحاولة من جديد لاحقاً من القائمة الرئيسية.', Markup.inlineKeyboard([]));
                    return ctx.scene.leave(); 
                } else {
                    await editPrompt(ctx, '⚠️ <b>رقم الهاتف المدخل غير صحيح!</b>\nيرجى التأكد من كتابة 11 رقماً ويبدأ بـ 01 <b>(تتبقى لك محاولة واحدة)</b>:', Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء العملية', 'cancel_transfer')]]));
                    return; 
                }
            }

            ctx.wizard.state.phoneAttempts = 0; 
            ctx.wizard.state.vodafoneNumber = number;
            
            await editPrompt(ctx, `✅ تم حفظ الرقم: <code>${number}</code>\n\n💸 الرجاء إرسال المبلغ المراد تحويله (بالجنيه المصري):`, Markup.inlineKeyboard([
                [Markup.button.callback('🔙 تعديل الرقم', 'back_to_step_1')],
                [Markup.button.callback('❌ إلغاء العملية', 'cancel_transfer')]
            ]));
            return ctx.wizard.next();
        }
    },

    // 3️⃣ الخطوة الثالثة: استقبال المبلغ والتحقق المبدئي منه
    async (ctx) => {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery().catch(() => {});
            if (ctx.callbackQuery.data === 'cancel_transfer') {
                await editPrompt(ctx, '❌ تم إلغاء العملية.', {});
                return ctx.scene.leave();
            }
            if (ctx.callbackQuery.data === 'back_to_step_1') {
                ctx.wizard.state.phoneAttempts = 0; 
                await editPrompt(ctx, '📞 <b>تحويل إلى مصر</b>\n\nالرجاء إرسال رقم المحفظة في مصر (11 رقم):', Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء العملية', 'cancel_transfer')]]));
                ctx.wizard.selectStep(1);
                return;
            }
        }

        if (ctx.message) {
            await ctx.deleteMessage().catch(()=>{}); 
            
            const amountEGP = parseFloat(ctx.message.text?.trim());
            
            if (isNaN(amountEGP) || amountEGP <= 0) {
                ctx.wizard.state.amountAttempts += 1; 
                
                if (ctx.wizard.state.amountAttempts >= 2) {
                    await editPrompt(ctx, '❌ لقد قمت بإدخال مبلغ غير صالح مرتين متتاليتين.\nتم إلغاء العملية لحماية النظام.', Markup.inlineKeyboard([]));
                    return ctx.scene.leave(); 
                } else {
                    await editPrompt(ctx, '⚠️ <b>مبلغ غير صالح!</b>\nأدخل رقماً صحيحاً أكبر من الصفر <b>(تتبقى لك محاولة واحدة)</b>:', Markup.inlineKeyboard([[Markup.button.callback('🔙 عودة', 'back_to_step_1')]]));
                    return; 
                }
            }

            ctx.wizard.state.amountAttempts = 0; 

            try {
                const { data } = await ctx.wizard.state.api.post('/client/user', {
                    telegramId: ctx.from.id.toString(),
                    name: ctx.from.first_name,
                    phone: ''
                });
                
                if (!data.success) {
                    await editPrompt(ctx, '❌ حدث خطأ في جلب بيانات الحساب.', {});
                    return ctx.scene.leave();
                }
                
                const userObj = data.user;
                const companyObj = data.company;
                
                let clientTier = 1;
                let safeBalance = 0;
                let safeCreditLimit = 0;

                if (ctx.wizard.state.isMainBot) {
                    clientTier = userObj.tier || 1;
                    safeBalance = parseFloat(userObj.balance) || 0;
                    safeCreditLimit = Math.abs(parseFloat(userObj.creditLimit) || 0);
                } else {
                    clientTier = companyObj.tier || 1;
                    safeBalance = parseFloat(companyObj.balance) || 0;
                    safeCreditLimit = Math.abs(parseFloat(companyObj.creditLimit) || 0);
                }

                const availableFunds = safeBalance + safeCreditLimit;

                const { data: setData } = await ctx.wizard.state.api.get('/settings');
                const set = setData.settings || {};
                
                let currentExchangeRate = set.rateLevel1 || 6.40;
                if (clientTier === 2) currentExchangeRate = set.rateLevel2 || 6.45;
                if (clientTier === 3) currentExchangeRate = set.rateLevel3 || 6.50;
                
                const amountLYD = parseFloat((amountEGP / currentExchangeRate).toFixed(3));
                
                if (amountLYD > availableFunds) {
                    await editPrompt(ctx, 
                        `❌ <b>عذراً، لا يمكن تنفيذ العملية لتجاوز الحد الأقصى للمديونية!</b>\n\n` +
                        `💰 <b>المتاح كلياً:</b> ${availableFunds.toFixed(2)} دينار\n` +
                        `📉 <b>تكلفة الحوالة:</b> ${amountLYD.toFixed(2)} دينار\n\n` +
                        `يرجى تسديد المديونية للمتابعة.`,
                        Markup.inlineKeyboard([[Markup.button.callback('🔙 تعديل المبلغ', 'back_to_step_1')]])
                    );
                    return; 
                }

                ctx.wizard.state.amountEGP = amountEGP;
                ctx.wizard.state.amountLYD = amountLYD;
                ctx.wizard.state.exchangeRate = currentExchangeRate;

                await editPrompt(ctx, 
                    `📝 <b>إضافة ملاحظة (اختياري):</b>\n\n` +
                    `هل تود إضافة ملاحظة مع هذه الحوالة؟ (مثال: اسم صاحب المحفظة أو سبب التحويل)\n` +
                    `👉 <b>أرسل الملاحظة الآن في رسالة، أو اضغط "تخطي".</b>`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('⏭️ تخطي (بدون ملاحظة)', 'skip_note')],
                        [Markup.button.callback('🔙 تعديل المبلغ', 'back_to_step_2')],
                        [Markup.button.callback('❌ إلغاء العملية', 'cancel_transfer')]
                    ])
                );
                return ctx.wizard.next();

            } catch (error) {
                await editPrompt(ctx, '❌ تعذر الاتصال بالسيرفر. حاول لاحقاً.', {});
                return ctx.scene.leave();
            }
        }
    },

    // 4️⃣ الخطوة الرابعة: استقبال الملاحظة ومراجعة الطلب
    async (ctx) => {
        let action = ctx.callbackQuery?.data;
        let note = null;

        if (ctx.callbackQuery) {
            await ctx.answerCbQuery().catch(()=>{});
            if (action === 'cancel_transfer') {
                await editPrompt(ctx, '❌ تم إلغاء العملية بنجاح.', {});
                return ctx.scene.leave();
            }
            if (action === 'back_to_step_2') {
                ctx.wizard.state.amountAttempts = 0; 
                await editPrompt(ctx, `✅ تم حفظ الرقم: <code>${ctx.wizard.state.vodafoneNumber}</code>\n\n💸 الرجاء إرسال المبلغ المراد تحويله (بالجنيه المصري):`, Markup.inlineKeyboard([
                    [Markup.button.callback('🔙 تعديل الرقم', 'back_to_step_1')],
                    [Markup.button.callback('❌ إلغاء العملية', 'cancel_transfer')]
                ]));
                ctx.wizard.selectStep(2);
                return;
            }
            if (action === 'skip_note') {
                note = null;
            }
        } else if (ctx.message) {
            await ctx.deleteMessage().catch(()=>{});
            note = ctx.message.text?.trim();
        }

        if (note === undefined) return; 

        ctx.wizard.state.transferNote = note;
        const { vodafoneNumber, amountEGP, amountLYD, exchangeRate } = ctx.wizard.state;
        
        const noteDisplay = note ? `\n📝 <b>الملاحظة:</b> ${note}` : '\n📝 <b>الملاحظة:</b> <i>لا توجد</i>';

        await editPrompt(ctx, 
            `📊 <b>مراجعة وتأكيد الطلب:</b>\n\n` +
            `📞 <b>الرقم المحول إليه:</b> <code>${vodafoneNumber}</code>\n` +
            `🇪🇬 <b>المبلغ المطلوب:</b> ${amountEGP} جنيه\n` +
            `🇱🇾 <b>التكلفة:</b> ${amountLYD.toFixed(2)} دينار\n` +
            `💱 <b>سعر الصرف:</b> 1 دينار = ${exchangeRate} جنيه` +
            `${noteDisplay}\n\n` +
            `هل تريد تأكيد العملية وإرسال التحويل؟`,
            Markup.inlineKeyboard([
                [Markup.button.callback('✅ إرسال التحويل', 'confirm_transfer')],
                [Markup.button.callback('🔙 تعديل الملاحظة', 'back_to_note')],
                [Markup.button.callback('❌ إلغاء العملية', 'cancel_transfer')]
            ])
        );
        return ctx.wizard.next();
    },

    // 5️⃣ الخطوة الخامسة: تأكيد الإرسال 
    async (ctx) => {
        if (!ctx.callbackQuery) {
            if (ctx.message) await ctx.deleteMessage().catch(()=>{});
            return;
        }
        
        const action = ctx.callbackQuery.data;

        if (action === 'cancel_transfer') {
            await ctx.answerCbQuery().catch(()=>{});
            await editPrompt(ctx, '❌ تم إلغاء عملية التحويل بنجاح.', {});
            return ctx.scene.leave();
        }

        if (action === 'back_to_note') {
            await ctx.answerCbQuery().catch(()=>{});
            await editPrompt(ctx, 
                `📝 <b>إضافة ملاحظة (اختياري):</b>\n\nأرسل الملاحظة الآن في رسالة، أو اضغط "تخطي".`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('⏭️ تخطي', 'skip_note')],
                    [Markup.button.callback('🔙 تعديل المبلغ', 'back_to_step_2')]
                ])
            );
            ctx.wizard.selectStep(3); 
            return;
        }

        if (action === 'confirm_transfer') {
            await ctx.answerCbQuery('⏳ جاري إرسال الطلب...').catch(()=>{});

            const telegramId = ctx.from.id.toString();
            const { amountEGP, vodafoneNumber, transferNote, amountLYD } = ctx.wizard.state;
            
            try {
                const { data } = await ctx.wizard.state.api.post('/client/transfer', {
                    telegramId: telegramId,
                    amountEGP: amountEGP,
                    transferType: 'vodafone_cash',
                    vodafoneNumber: vodafoneNumber,
                    notes: transferNote
                });

                if (data.success) {
                    const tx = data.transaction;
                    const clientNoteDisplay = transferNote ? `📝 <b>الملاحظة:</b> ${transferNote}\n` : '';
                    await editPrompt(ctx, 
                        `✅ <b>تم إرسال طلبك بنجاح!</b>\n\n` +
                        `🧾 <b>رقم الطلب:</b> <code>${tx.customId}</code>\n` +
                        `📞 <b>الرقم:</b> <code>${vodafoneNumber}</code>\n` +
                        `🇪🇬 <b>المبلغ:</b> ${amountEGP} جنيه\n` +
                        `💰 <b>تم خصم:</b> ${amountLYD.toFixed(2)} دينار\n` +
                        `${clientNoteDisplay}\n` +
                        `⏳ الطلب الآن "قيد التنفيذ".`,
                        {} 
                    );
                }

            } catch (error) {
                if (error.response && error.response.status === 429) {
                    const waitTime = error.response.data.waitTime || 60;
                    await editPrompt(ctx, `⚠️ <b>تحذير أمني (سبام):</b>\nالرجاء الانتظار <b>${waitTime} ثانية</b> قبل إرسال حوالة أخرى.`, Markup.inlineKeyboard([[Markup.button.callback('🔙 رجوع', 'back_to_step_1')]]));
                    ctx.wizard.selectStep(2); 
                    return; 
                } else if (error.response && error.response.status === 400 && error.response.data.message === 'INSUFFICIENT_BALANCE') {
                    await editPrompt(ctx, '❌ <b>فشلت العملية!</b> الرصيد غير كافٍ أو هناك عملية أخرى قيد التنفيذ استهلكت رصيدك.', {});
                } else {
                    await editPrompt(ctx, '❌ حدث خطأ أثناء إرسال المعاملة للسيرفر. حاول مرة أخرى.', {});
                }
            }
            return ctx.scene.leave();
        }
    }
);

module.exports = transferWizard;