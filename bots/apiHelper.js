const axios = require('axios');

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api/bot';

const createBotApi = (botToken) => {
    return axios.create({
        baseURL: API_BASE_URL,
        headers: {
            'x-bot-token': botToken,
            'Content-Type': 'application/json'
        }
    });
};

module.exports = {
    createBotApi
};
