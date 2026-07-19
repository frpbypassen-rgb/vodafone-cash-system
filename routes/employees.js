const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const ClientEmployee = require('../models/ClientEmployee');
const ExecutorBot = require('../models/ExecutorBot');
const ClientBot = require('../models/ClientBot');
const { requireAuth } = require('../middlewares/auth');

router.get('/employees', requireAuth, async (req, res) => {
    const execEmployees = await Employee.find({}); const clientEmployees = await ClientEmployee.find({}); const executors = await ExecutorBot.find({}); const clients = await ClientBot.find({}); const executorBotsMap = {}; executors.forEach(b => executorBotsMap[b._id] = b.name); const clientBotsMap = {}; clients.forEach(b => clientBotsMap[b._id] = b.name);
    res.render('employees', { execEmployees, clientEmployees, executorBotsMap, clientBotsMap });
});

router.post('/employees/executor/:id/toggle', requireAuth, async (req, res) => {
    const emp = await Employee.findById(req.params.id); emp.status = emp.status === 'active' ? 'banned' : 'active'; await emp.save(); res.redirect('/employees');
});

router.post('/employees/client/:id/toggle', requireAuth, async (req, res) => {
    const emp = await ClientEmployee.findById(req.params.id); emp.status = emp.status === 'active' ? 'banned' : 'active'; await emp.save(); res.redirect('/employees');
});

module.exports = router;
