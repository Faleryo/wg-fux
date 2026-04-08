const express = require('express');
const router = express.Router();
const axios = require('axios');
const log = require('../services/logger');
const { auth, requireAdmin, requireManager } = require('../middleware/auth');

// AdGuard Home internal URL (Docker DNS)
const AGH_BASE_URL = 'http://wg-fux-dns:3000';
const AGH_USER = process.env.AGH_USER || 'admin';
const AGH_PASS = process.env.AGH_PASSWORD || 'password';
const AGH_AUTH = {
  auth: {
    username: AGH_USER,
    password: AGH_PASS.length < 8 ? AGH_PASS.padEnd(8, '0') : AGH_PASS
  }
};


/**
 * GET /api/dns/config
 * Retrieves the current DNS configuration (Aggregate from multiple AGH endpoints)
 */
router.get('/config', auth, requireManager, async (req, res) => {
  try {
    const [dnsInfo, filtering, safeSearch, safeBrowsing, parental] = await Promise.all([
      axios.get(`${AGH_BASE_URL}/control/dns_info`, AGH_AUTH),
      axios.get(`${AGH_BASE_URL}/control/filtering/status`, AGH_AUTH),
      axios.get(`${AGH_BASE_URL}/control/safesearch/status`, AGH_AUTH),
      axios.get(`${AGH_BASE_URL}/control/safebrowsing/status`, AGH_AUTH),
      axios.get(`${AGH_BASE_URL}/control/parental/status`, AGH_AUTH)
    ]);

    const aggregateConfig = {
      ...dnsInfo.data,
      filtering_enabled: filtering.data.enabled,
      safesearch_enabled: safeSearch.data.enabled,
      safebrowsing_enabled: safeBrowsing.data.enabled,
      parental_enabled: parental.data.enabled
    };

    res.json(aggregateConfig);
  } catch (error) {
    log.error('dns', 'Failed to fetch aggregate DNS config from AGH', { error: error.message });
    res.status(500).json({ error: 'Internal DNS Error', message: 'Could not aggregate AdGuard Home configuration' });
  }
});

/**
 * POST /api/dns/config
 * Updates the DNS configuration (Upstreams, Filtering, SafeSearch, etc.)
 */
router.post('/config', auth, requireAdmin, async (req, res) => {
  try {
    const { 
      upstream_dns, bootstrap_dns, 
      filtering_enabled, safesearch_enabled, 
      safebrowsing_enabled, parental_enabled 
    } = req.body;

    // 1. Update Core DNS Config (Upstreams)
    const dnsConfig = {};
    if (upstream_dns) dnsConfig.upstream_dns = upstream_dns;
    if (bootstrap_dns) dnsConfig.bootstrap_dns = bootstrap_dns;
    
    const requests = [
      axios.post(`${AGH_BASE_URL}/control/dns_config`, dnsConfig, AGH_AUTH)
    ];

    // 2. Dispatch Toggles to specialized AGH endpoints
    if (filtering_enabled !== undefined) {
      requests.push(axios.post(`${AGH_BASE_URL}/control/filtering/config`, { enabled: !!filtering_enabled }, AGH_AUTH));
    }
    
    if (safesearch_enabled !== undefined) {
      requests.push(axios.post(`${AGH_BASE_URL}/control/safesearch/status`, { enabled: !!safesearch_enabled }, AGH_AUTH));
    }

    if (safebrowsing_enabled !== undefined) {
      requests.push(axios.post(`${AGH_BASE_URL}/control/safebrowsing/enable`, {}, AGH_AUTH).catch(async () => {
         if (!safebrowsing_enabled) return axios.post(`${AGH_BASE_URL}/control/safebrowsing/disable`, {}, AGH_AUTH);
      }));
    }

    if (parental_enabled !== undefined) {
      requests.push(axios.post(`${AGH_BASE_URL}/control/parental/enable`, {}, AGH_AUTH).catch(async () => {
         if (!parental_enabled) return axios.post(`${AGH_BASE_URL}/control/parental/disable`, {}, AGH_AUTH);
      }));
    }

    await Promise.all(requests);

    res.json({ success: true });
  } catch (error) {
    log.error('dns', 'Failed to update multi-tier DNS config in AGH', { error: error.message });
    res.status(500).json({ error: 'Internal DNS Error', message: 'Could not update all AdGuard Home settings' });
  }
});

/**
 * GET /api/dns/stats
 * Retrieves DNS statistics (queries, blocked, etc.)
 */
router.get('/stats', auth, requireManager, async (req, res) => {
  try {
    const response = await axios.get(`${AGH_BASE_URL}/control/stats`, { ...AGH_AUTH, maxRedirects: 0 });

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
router.get('/status', auth, requireManager, async (req, res) => {
  try {
    const response = await axios.get(`${AGH_BASE_URL}/control/status`, { ...AGH_AUTH, maxRedirects: 0 });

    res.json(response.data);
  } catch (error) {
    res.json({ initialized: false, error: error.message });
  }
});

/**
 * GET /api/dns/filtering
 * Retrieves filtering status and blocklists
 */
router.get('/filtering', auth, requireManager, async (req, res) => {
  try {
    const response = await axios.get(`${AGH_BASE_URL}/control/filtering/status`, { ...AGH_AUTH, maxRedirects: 0 });

    res.json(response.data);
  } catch (error) {
    log.error('dns', 'Failed to fetch filtering status', { error: error.message });
    res.status(500).json({ error: 'Internal DNS Error', message: 'Could not fetch filtering status' });
  }
});

/**
 * POST /api/dns/filtering/add
 * Adds a new filter (blocklist)
 */
router.post('/filtering/add', auth, requireAdmin, async (req, res) => {
  try {
    const { name, url } = req.body;
    const response = await axios.post(`${AGH_BASE_URL}/control/filtering/add_url`, { name, url, whitelist: false }, { ...AGH_AUTH, maxRedirects: 0 });

    res.json({ success: true, data: response.data });
  } catch (error) {
    log.error('dns', 'Failed to add blocklist', { error: error.message });
    res.status(500).json({ error: 'Internal DNS Error', message: 'Could not add blocklist' });
  }
});

/**
 * POST /api/dns/filtering/remove
 * Removes a filter (blocklist)
 */
router.post('/filtering/remove', auth, requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    const response = await axios.post(`${AGH_BASE_URL}/control/filtering/remove_url`, { url }, { ...AGH_AUTH, maxRedirects: 0 });

    res.json({ success: true, data: response.data });
  } catch (error) {
    log.error('dns', 'Failed to remove blocklist', { error: error.message });
    res.status(500).json({ error: 'Internal DNS Error', message: 'Could not remove blocklist' });
  }
});

module.exports = router;

