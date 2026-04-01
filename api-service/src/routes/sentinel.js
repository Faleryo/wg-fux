const express = require('express');
const router = express.Router();
const { auth, requireAdmin } = require('../middleware/auth');

// In-memory store for Sentinel status (Shared with other routes if needed)
let sentinelStatus = {
    lastHeartbeat: null,
    status: 'offline',
    logs: [],
    stats: {}
};

// Heartbeat endpoint for Sentinel V2
router.post('/heartbeat', async (req, res) => {
    const { status, logs, stats } = req.body;
    
    sentinelStatus = {
        lastHeartbeat: new Date(),
        status: status || 'active',
        logs: Array.isArray(logs) ? logs.slice(-20) : [],
        stats: stats || {}
    };

    res.json({ success: true });
});

// Getter for the UI
router.get('/status', auth, (req, res) => {
    res.json(sentinelStatus);
});

module.exports = router;
module.exports.getStatus = () => sentinelStatus;
