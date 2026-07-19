// models/StoreCategory.js
const mongoose = require('mongoose');

const storeCategorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    icon: { type: String, default: 'fa-store' },
    color: { type: String, default: '#198754' },
    image: { type: String, default: '' },
    status: { type: String, default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('StoreCategory', storeCategorySchema);
