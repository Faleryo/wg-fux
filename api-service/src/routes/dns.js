const express = require('express');
const router = express.Router();
const axios = require('axios');
const log = require('../services/logger');

// AdGuard Home internal URL (Docker DNS)
const AGH_BASE_URL = 'http://wg-fux-dns:3000';
const AGH_AUTH = {
    auth: {
        username: 'admin',
        password: 'password' // In production, this should be an ENV variable
    }
};

/**
 * GET /api/dns/config
 * Retrieves the current DNS configuration from AdGuard Home
 */
router.get('/config', async (req, res) => {
    try {
        const response = await axios.get(`${AGH_BASE_URL}/control/dns_config`, AGH_AUTH);
        res.json(response.data);
    } catch (error) {
        log.error('dns', 'Failed to fetch DNS config from AGH', { error: error.message });
        res.status(500).json({ error: 'Internal DNS Error', message: 'Could not connect to AdGuard Home API' });
    }
});

/**
 * POST /api/dns/config
 * Updates the DNS configuration (Upstreams, etc.)
 */
router.post('/config', async (req, res) => {
    try {
        // req.body should contain { upstream_dns: [...], bootstrap_dns: [...], etc. }
        const response = await axios.post(`${AGH_BASE_URL}/control/dns_config`, req.body, AGH_AUTH);
        res.json({ success: true, status: response.status });
    } catch (error) {
        log.error('dns', 'Failed to update DNS config in AGH', { error: error.message });
        res.status(500).json({ error: 'Internal DNS Error', message: 'Could not update AdGuard Home configuration' });
    }
});

/**
 * GET /api/dns/stats
 * Retrieves DNS statistics (queries, blocked, etc.)
 */
router.get('/stats', async (req, res) => {
    try {
        const response = await axios.get(`${AGH_BASE_URL}/control/stats`, AGH_AUTH);
        res.json(response.data);
    } catch (error) {
        log.error('dns', 'Failed to fetch DNS stats from AGH', { error: error.message });
        res.status(500).json({ error: 'Internal DNS Error', message: 'Could not fetch AdGuard Home statistics' });
    }
});

/**
 * GET /api/dns/status
 * Check if AdGuard Home is initialized
 */
router.get('/status', async (req, res) => {
    try {
        const response = await axios.get(`${AGH_BASE_URL}/control/status`, AGH_AUTH);
        res.json(response.data);
    } catch (error) {
        // If we get a 302 or 404 on /control/status, it might mean it's in setup mode
        res.json({ initialized: false, error: error.message });
    }
});

module.exports = router;
