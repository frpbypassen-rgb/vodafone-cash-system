const mongoose = require('mongoose');

const clientBotSchema = new mongoose.Schema({
    name: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    phone: { type: String },
    // 🟢 تم التعديل: جعل المستوى الافتراضي 3 للشركات الجديدة
    tier: { type: Number, default: 3 },
    balance: { type: Number, default: 0 },
    
    // 🟢 تم التعديل: إضافة حقل سعر الصرف المخصص للشركة
    exchangeRate: { type: Number, default: 0 },
    
    // الحد الائتماني للشركات (السماح بالنزول تحت الصفر)
    creditLimit: { type: Number, default: 0 }, 
    
    status: { type: String, default: 'active' } // active, inactive
}, { timestamps: true });

module.exports = mongoose.model('ClientBot', clientBotSchema);