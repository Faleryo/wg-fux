const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

// In-memory store for Sentinel status (Shared with other routes if needed)
let sentinelStatus = {
  lastHeartbeat: null,
  status: 'offline',
  logs: [],
  stats: {}
};

// Heartbeat endpoint for Sentinel V2
// WAVE 4: Secured with shared secret (SENTINEL_TOKEN) or JWT
router.post('/heartbeat', async (req, res) => {
  const token = req.headers['x-api-token'];
  const sentinelToken = process.env.SENTINEL_TOKEN || 'vibe-sentinel-trust-99';
    
  if (token !== sentinelToken) {
    // Fallback: check if it's a valid admin/manager JWT
    try {
      const jwt = require('jsonwebtoken');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role !== 'admin' && decoded.role !== 'manager') throw new Error();
    } catch {
      return res.status(401).json({ error: 'Sentinel Auth failed' });
    }
  }

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
