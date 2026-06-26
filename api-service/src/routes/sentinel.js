const express = require('express');
const router = express.Router();
const { auth, requireAdmin } = require('../middleware/auth');
const { asyncWrap, createError } = require('../utils/errors');
const { sentinelHeartbeatSchema } = require('../../db/validation');

// In-memory store for Sentinel status
const sentinelStatus = {
  lastHeartbeat: null,
  status: 'offline',
  logs: [],
  stats: {},
};

// Heartbeat endpoint for Sentinel V2
router.post(
  '/heartbeat',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const parsed = sentinelHeartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    }

    const { status, logs, stats } = parsed.data;

    // Atomic update to avoid race conditions
    sentinelStatus.lastHeartbeat = new Date();
    sentinelStatus.status = status || 'active';
    sentinelStatus.logs = Array.isArray(logs) ? logs.slice(-20) : [];
    sentinelStatus.stats = stats || {};

    res.json({ success: true });
  })
);

// Getter for the UI — admins get full data, others get redacted logs
router.get(
  '/status',
  auth,
  asyncWrap(async (req, res) => {
    if (req.user.role === 'admin') {
      return res.json(sentinelStatus);
    }
    const { logs: _logs, ...safeStatus } = sentinelStatus;
    res.json(safeStatus);
  })
);

module.exports = router;
module.exports.getStatus = () => sentinelStatus;
