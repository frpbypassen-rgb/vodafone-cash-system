const mongoose = require('mongoose');

const storeCategorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true },
    icon: { type: String, default: 'fa-store' },
    color: { type: String, default: '#198754' },
    image: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('StoreCategory', storeCategorySchema);
