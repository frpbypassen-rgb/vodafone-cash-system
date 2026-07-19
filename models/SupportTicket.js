// models/SupportTicket.js
const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema({
    sender: { type: String, enum: ['user', 'admin'], required: true },
    senderName: { type: String, default: 'الإدارة' },
    text: { type: String },
    imageUrl: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const supportTicketSchema = new mongoose.Schema({
    ticketId: { 
        type: String, 
        unique: true, 
        // 🟢 الحل السحري: التوليد المباشر بدلاً من دوال الحفظ التي تسبب التعليق
        default: function() {
            return 'TCK-' + Math.floor(100000 + Math.random() * 900000);
        }
    },
    entityType: { type: String, enum: ['client_user', 'client_company', 'executor'], required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true }, 
    telegramId: { type: String, required: true },
    name: { type: String, required: true },
    phone: { type: String },
    botToken: { type: String }, 
    status: { type: String, enum: ['open', 'answered', 'closed'], default: 'open' },
    unreadUser: { type: Number, default: 0 }, 
    unreadAdmin: { type: Number, default: 1 }, 
    messages: [supportMessageSchema]
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);