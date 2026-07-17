const mongoose = require('mongoose');

const storeProductSchema = new mongoose.Schema({
    categoryName: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    image: { type: String, default: '' }
}, { timestamps: true });

storeProductSchema.index({ categoryName: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('StoreProduct', storeProductSchema);
