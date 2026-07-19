const fs = require('fs');
const axios = require('axios');
const { Telegram } = require('telegraf');

const ClientBot = require('../models/ClientBot');
const ClientEmployee = require('../models/ClientEmployee');
const { getLocalProofFilePath } = require('../utils/proofImages');

function normalizeId(value) {
    if (!value) return null;
    return value._id || value;
}

function normalizeTelegramId(value) {
    if (value === undefined || value === null) return null;
    const id = String(value).trim();
    return id ? id : null;
}

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function compactProofRefs(refs) {
    return refs
        .filter(Boolean)
        .map(ref => String(ref).trim())
        .filter(Boolean);
}

function getStoredProofRefs(tx) {
    if (!tx) return [];
    if (Array.isArray(tx.proofImages) && tx.proofImages.length) {
        return compactProofRefs(tx.proofImages);
    }
    const localProofImage = tx.localProofImage || (typeof tx.get === 'function' ? tx.get('localProofImage') : null);
    return compactProofRefs([tx.proofImage, localProofImage]);
}

async function getDeliveryContext(tx) {
    const clientBotId = normalizeId(tx && tx.clientBotId);
    let token = process.env.CLIENT_BOT_TOKEN;
    const recipients = new Map();

    if (clientBotId) {
        const company = await ClientBot.findById(clientBotId).select('token').lean();
        if (company && company.token) token = company.token;

        const employees = await ClientEmployee.find({
            clientBotId,
            status: 'active',
            telegramId: { $exists: true, $nin: [null, ''] }
        }).select('telegramId name').lean();

        for (const employee of employees) {
            const telegramId = normalizeTelegramId(employee.telegramId);
            if (telegramId) recipients.set(telegramId, { telegramId, name: employee.name });
        }

        const fallbackRequesterId = normalizeTelegramId(tx && tx.userId);
        if (!recipients.size && fallbackRequesterId) {
            recipients.set(fallbackRequesterId, { telegramId: fallbackRequesterId });
        }
    } else {
        const telegramId = normalizeTelegramId(tx && tx.userId);
        if (telegramId) recipients.set(telegramId, { telegramId });
    }

    return { token, recipients: Array.from(recipients.values()) };
}

function makePhotoInput(proofRef, fallbackImageBuffer) {
    if (proofRef) {
        const localPath = getLocalProofFilePath(proofRef);
        if (localPath) {
            if (fs.existsSync(localPath)) return { source: fs.createReadStream(localPath) };
            return null;
        }
        return proofRef;
    }

    if (fallbackImageBuffer) {
        return { source: Buffer.from(fallbackImageBuffer) };
    }

    return null;
}

async function downloadTelegramFile(sourceBotToken, proofRef, cache) {
    if (!sourceBotToken || !proofRef || /^https?:\/\//i.test(proofRef) || getLocalProofFilePath(proofRef)) {
        return null;
    }

    if (cache.has(proofRef)) return cache.get(proofRef);

    try {
        const sourceApi = new Telegram(sourceBotToken);
        const fileLink = await sourceApi.getFileLink(proofRef);
        const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        cache.set(proofRef, buffer);
        return buffer;
    } catch (error) {
        cache.set(proofRef, null);
        console.error(`[Proof Delivery] Failed to download source proof: ${error.message}`);
        return null;
    }
}

function defaultProofCaption(tx) {
    const displayId = escapeHtml((tx && (tx.customId || tx._id)) || '---');
    const target = escapeHtml((tx && (tx.vodafoneNumber || tx.accountNumber)) || '---');
    const amount = escapeHtml((tx && tx.amount) || 0);
    const cost = tx && tx.costLYD ? `\n<b>التكلفة:</b> ${escapeHtml(Number(tx.costLYD).toFixed(2))} LYD` : '';

    return `<b>تم تنفيذ طلبك بنجاح</b>\n\n` +
        `<b>رقم الطلب:</b> <code>${displayId}</code>\n` +
        `<b>الرقم/الحساب:</b> <code>${target}</code>\n` +
        `<b>المبلغ:</b> ${amount} EGP${cost}\n\n` +
        `<i>صورة الإثبات مرفقة.</i>`;
}

async function sendMessageToClientRecipients(tx, { text } = {}) {
    const { token, recipients } = await getDeliveryContext(tx);
    const result = { sent: 0, failed: 0, skipped: 0, recipients: recipients.length };

    if (!token || !text || !recipients.length) {
        result.skipped = recipients.length || 1;
        return result;
    }

    const api = new Telegram(token);
    for (const recipient of recipients) {
        try {
            await api.sendMessage(recipient.telegramId, text, { parse_mode: 'HTML' });
            result.sent += 1;
        } catch (error) {
            result.failed += 1;
            console.error(`[Proof Delivery] Failed to send message to ${recipient.telegramId}: ${error.message}`);
        }
    }

    return result;
}

async function sendProofToClientRecipients(tx, options = {}) {
    const { token, recipients } = await getDeliveryContext(tx);
    const caption = options.caption || defaultProofCaption(tx);
    const proofRefs = Array.isArray(options.proofRefs)
        ? compactProofRefs(options.proofRefs)
        : getStoredProofRefs(tx);
    const fallbackImageBuffer = options.imageBuffer || null;
    const downloadedProofs = new Map();
    const result = { sent: 0, failed: 0, skipped: 0, recipients: recipients.length };

    if (!token || !recipients.length || (!proofRefs.length && !fallbackImageBuffer)) {
        result.skipped = recipients.length || 1;
        return result;
    }

    const api = new Telegram(token);
    for (const recipient of recipients) {
        let sentAnyPhoto = false;

        const refsToSend = proofRefs.length ? proofRefs : [null];
        for (let index = 0; index < refsToSend.length; index += 1) {
            const proofInput = makePhotoInput(refsToSend[index], !proofRefs.length || index === 0 ? fallbackImageBuffer : null);
            if (!proofInput) continue;

            try {
                await api.sendPhoto(recipient.telegramId, proofInput, {
                    caption: index === 0 ? caption : undefined,
                    parse_mode: 'HTML'
                });
                sentAnyPhoto = true;
            } catch (error) {
                const sourceImageBuffer = fallbackImageBuffer || await downloadTelegramFile(
                    options.sourceBotToken,
                    refsToSend[index],
                    downloadedProofs
                );
                const retryInput = refsToSend[index] && sourceImageBuffer
                    ? makePhotoInput(null, sourceImageBuffer)
                    : null;
                if (retryInput) {
                    try {
                        await api.sendPhoto(recipient.telegramId, retryInput, {
                            caption: index === 0 ? caption : undefined,
                            parse_mode: 'HTML'
                        });
                        sentAnyPhoto = true;
                        continue;
                    } catch (retryError) {
                        console.error(`[Proof Delivery] Failed to send fallback proof to ${recipient.telegramId}: ${retryError.message}`);
                    }
                } else {
                    console.error(`[Proof Delivery] Failed to send proof to ${recipient.telegramId}: ${error.message}`);
                }
            }
        }

        if (sentAnyPhoto) {
            result.sent += 1;
        } else {
            result.failed += 1;
            await api.sendMessage(recipient.telegramId, caption, { parse_mode: 'HTML' }).catch(() => {});
        }
    }

    return result;
}

module.exports = {
    sendMessageToClientRecipients,
    sendProofToClientRecipients,
};
