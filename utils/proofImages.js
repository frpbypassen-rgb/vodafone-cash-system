const fs = require('fs');
const path = require('path');

function getProofReference(tx, index = 0) {
    if (!tx) return null;
    if (Array.isArray(tx.proofImages) && tx.proofImages.length > index) return tx.proofImages[index];
    if (index === 0 && tx.proofImage) return tx.proofImage;
    if (index === 0 && tx.localProofImage) return tx.localProofImage;
    return null;
}

function normalizeLocalProofReference(photoRef) {
    if (typeof photoRef !== 'string') return null;
    const normalized = photoRef.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized.startsWith('uploads/')) return null;
    return normalized;
}

function getLocalProofFilePath(photoRef) {
    const normalized = normalizeLocalProofReference(photoRef);
    if (!normalized) return null;

    const uploadsRoot = path.resolve(process.cwd(), 'uploads');
    const fullPath = path.resolve(process.cwd(), normalized);
    if (fullPath !== uploadsRoot && !fullPath.startsWith(uploadsRoot + path.sep)) return null;
    return fullPath;
}

function getLocalProofPublicUrl(photoRef) {
    const normalized = normalizeLocalProofReference(photoRef);
    return normalized ? `/${normalized}` : null;
}

function trySendLocalProof(res, photoRef) {
    const fullPath = getLocalProofFilePath(photoRef);
    if (!fullPath) return false;
    if (!fs.existsSync(fullPath)) {
        res.status(404).send('ملف الإثبات غير موجود على السيرفر');
        return true;
    }
    res.sendFile(fullPath);
    return true;
}

module.exports = {
    getProofReference,
    getLocalProofFilePath,
    getLocalProofPublicUrl,
    trySendLocalProof,
};
