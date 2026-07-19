// models/StoreProduct.js
const mongoose = require('mongoose');

const storeProductSchema = new mongoose.Schema({
    name: { type: String, required: true },
    categoryName: { type: String, required: true },
    image: { type: String, default: '' },
    price_1: { type: Number, default: 0 },
    price_2: { type: Number, default: 0 },
    price_3: { type: Number, default: 0 },
    status: { type: String, default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('StoreProduct', storeProductSchema);
