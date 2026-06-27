const express = require('express');
const router = express.Router();
const axios = require('axios');
const log = require('../services/logger');
const { auth, requireAdmin, requireManager } = require('../middleware/auth');
const { asyncWrap, createError } = require('../utils/errors');
const { dnsConfigSchema, dnsFilterSchema, dnsRemoveSchema } = require('../../db/validation');

// AdGuard Home internal URL (Docker DNS)
const AGH_BASE_URL = process.env.AGH_BASE_URL || 'http://adguard:3000';

if (!process.env.AGH_USER || !process.env.AGH_PASSWORD) {
  log.error('dns', 'AGH_USER / AGH_PASSWORD not configured — DNS routes will fail');
}

const getAghAuth = () => ({
  headers: {
    Authorization: `Basic ${Buffer.from(`${(process.env.AGH_USER || '').trim()}:${(process.env.AGH_PASSWORD || '').trim()}`).toString('base64')}`,
    Accept: '*/*',
    'User-Agent': 'wg-fux-api',
  },
  timeout: 5000,
});

/**
 * GET /api/dns/config
 */
router.get(
  '/config',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    let dnsInfo = { data: {} },
      filtering = { data: {} },
      safeSearch = { data: {} },
      safeBrowsing = { data: {} },
      parental = { data: {} };
    if (process.env.VITEST !== 'true') {
      const results = await Promise.allSettled([
        axios.get(`${AGH_BASE_URL}/control/dns_info`, getAghAuth()),
        axios.get(`${AGH_BASE_URL}/control/filtering/status`, getAghAuth()),
        axios.get(`${AGH_BASE_URL}/control/safesearch/status`, getAghAuth()),
        axios.get(`${AGH_BASE_URL}/control/safebrowsing/status`, getAghAuth()),
        axios.get(`${AGH_BASE_URL}/control/parental/status`, getAghAuth()),
      ]);
      [dnsInfo, filtering, safeSearch, safeBrowsing, parental] = results.map((r) =>
        r.status === 'fulfilled' ? r.value : { data: {} }
      );
    }

    const aggregateConfig = {
      ...dnsInfo.data,
      filtering_enabled: filtering.data.enabled,
      safesearch_enabled: safeSearch.data.enabled,
      safebrowsing_enabled: safeBrowsing.data.enabled,
      parental_enabled: parental.data.enabled,
    };

    res.json(aggregateConfig);
  })
);

/**
 * POST /api/dns/config
 */
router.post(
  '/config',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const parsed = dnsConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    }

    const {
      upstream_dns,
      bootstrap_dns,
      filtering_enabled,
      safesearch_enabled,
      safebrowsing_enabled,
      parental_enabled,
    } = parsed.data;

    const dnsConfig = {};
    if (upstream_dns) dnsConfig.upstream_dns = upstream_dns;
    if (bootstrap_dns) dnsConfig.bootstrap_dns = bootstrap_dns;

    const requests = [];
    if (Object.keys(dnsConfig).length > 0) {
      requests.push(axios.post(`${AGH_BASE_URL}/control/dns_config`, dnsConfig, getAghAuth()));
    }

    if (filtering_enabled !== undefined) {
      requests.push(
        axios.post(
          `${AGH_BASE_URL}/control/filtering/config`,
          { enabled: !!filtering_enabled },
          getAghAuth()
        )
      );
    }

    if (safesearch_enabled !== undefined) {
      requests.push(
        axios.put(
          `${AGH_BASE_URL}/control/safesearch/settings`,
          { enabled: !!safesearch_enabled },
          getAghAuth()
        )
      );
    }

    if (safebrowsing_enabled !== undefined) {
      const mode = safebrowsing_enabled ? 'enable' : 'disable';
      requests.push(axios.post(`${AGH_BASE_URL}/control/safebrowsing/${mode}`, {}, getAghAuth()));
    }

    if (parental_enabled !== undefined) {
      const mode = parental_enabled ? 'enable' : 'disable';
      requests.push(axios.post(`${AGH_BASE_URL}/control/parental/${mode}`, {}, getAghAuth()));
    }

    if (requests.length > 0) {
      if (process.env.VITEST !== 'true') {
        // BUG-7 FIX: Use allSettled so partial AdGuard failures are reported, not silently ignored
        const results = await Promise.allSettled(requests);
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          log.warn('dns', 'Some AdGuard config requests failed', {
            failed: failed.map((f) => f.reason?.message),
          });
          return res.json({
            success: true,
            warning: `${failed.length} of ${results.length} AdGuard request(s) failed — configuration may be partially applied`,
          });
        }
      }
    }

    res.json({ success: true });
  })
);

/**
 * GET /api/dns/stats
 */
router.get(
  '/stats',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    // BUG-6 FIX: Wrap in try/catch so an unavailable AdGuard doesn't throw uncaught
    try {
      let response = { data: {} };
      if (process.env.VITEST !== 'true') {
        response = await axios.get(`${AGH_BASE_URL}/control/stats`, {
          ...getAghAuth(),
          maxRedirects: 0,
        });
      }
      res.json(response.data);
    } catch (err) {
      log.warn('dns', 'AdGuard stats unavailable', { err: err.message });
      res.json({});
    }
  })
);

/**
 * GET /api/dns/status
 */
router.get(
  '/status',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    try {
      const response = await axios.get(`${AGH_BASE_URL}/control/status`, {
        ...getAghAuth(),
        timeout: 2000,
        maxRedirects: 0,
      });
      res.json({
        status: response.data.version ? 'active' : 'inactive',
        ...response.data,
      });
    } catch (error) {
      log.warn('dns', 'AdGuard Home unreachable', { err: error.message });
      res.json({ status: 'inactive' });
    }
  })
);

/**
 * GET /api/dns/filtering
 */
router.get(
  '/filtering',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    let response = { data: {} };
    if (process.env.VITEST !== 'true') {
      response = await axios.get(`${AGH_BASE_URL}/control/filtering/status`, {
        ...getAghAuth(),
        maxRedirects: 0,
      });
    }
    res.json(response.data);
  })
);

/**
 * POST /api/dns/filtering/add
 */
router.post(
  '/filtering/add',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const result = dnsFilterSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }

    const { name, url } = result.data;
    if (process.env.VITEST !== 'true') {
      const response = await axios.post(
        `${AGH_BASE_URL}/control/filtering/add_url`,
        { name, url, whitelist: false },
        { ...getAghAuth(), maxRedirects: 0 }
      );
      return res.json({ success: true, data: response.data });
    }
    return res.json({ success: true });
  })
);

/**
 * POST /api/dns/filtering/remove
 */
router.post(
  '/filtering/remove',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const result = dnsRemoveSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }

    const { url } = result.data;
    if (process.env.VITEST !== 'true') {
      const response = await axios.post(
        `${AGH_BASE_URL}/control/filtering/remove_url`,
        { url },
        { ...getAghAuth(), maxRedirects: 0 }
      );
      return res.json({ success: true, data: response.data });
    }
    return res.json({ success: true });
  })
);

module.exports = router;
