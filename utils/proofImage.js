const fs = require('fs');
const path = require('path');

const getLocalProofPath = (proofId) => {
    if (!proofId || typeof proofId !== 'string' || !proofId.startsWith('/uploads/proofs/')) return null;

    const proofsRoot = path.resolve(process.cwd(), 'uploads', 'proofs');
    const resolvedPath = path.resolve(process.cwd(), proofId.replace(/^\/+/, ''));

    if (!resolvedPath.startsWith(proofsRoot + path.sep) || !fs.existsSync(resolvedPath)) return null;
    return resolvedPath;
};

const sendLocalProofIfExists = (res, proofId) => {
    const localPath = getLocalProofPath(proofId);
    if (!localPath) return false;

    res.type(path.extname(localPath).toLowerCase() === '.png' ? 'png' : 'jpg');
    res.sendFile(localPath);
    return true;
};

module.exports = { getLocalProofPath, sendLocalProofIfExists };
