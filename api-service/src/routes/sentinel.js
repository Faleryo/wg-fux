const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

// In-memory store for Sentinel status
let sentinelStatus = {
  lastHeartbeat: null,
  status: 'offline',
  logs: [],
  stats: {},
};

// Heartbeat endpoint for Sentinel V2
// WAVE 5: Strictly rely on 'auth' middleware for SENTINEL_TOKEN verification + IP check
router.post('/heartbeat', auth, async (req, res) => {
  // If we reach here, 'auth' middleware has already verified the token AND the IP
  // or it verified a valid admin/manager JWT.

  const { status, logs, stats } = req.body;

  sentinelStatus = {
    lastHeartbeat: new Date(),
    status: status || 'active',
    logs: Array.isArray(logs) ? logs.slice(-20) : [],
    stats: stats || {},
  };

  res.json({ success: true });
});

// Getter for the UI
router.get('/status', auth, (req, res) => {
  res.json(sentinelStatus);
});

module.exports = router;
module.exports.getStatus = () => sentinelStatus;
