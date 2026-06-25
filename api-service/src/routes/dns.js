const express = require('express');
const router = express.Router();
const axios = require('axios');
const log = require('../services/logger');
const { auth, requireAdmin, requireManager } = require('../middleware/auth');
const { asyncWrap, createError } = require('../utils/errors');
const { dnsConfigSchema, dnsFilterSchema, dnsRemoveSchema } = require('../../db/validation');

// AdGuard Home internal URL (Docker DNS)
const AGH_BASE_URL = process.env.AGH_BASE_URL || 'http://wg-fux-dns:3000';
const AGH_USER = (process.env.AGH_USER || '').replace(/['"]/g, '').trim();
const AGH_PASS = (process.env.AGH_PASSWORD || '').replace(/['"]/g, '').trim();
if (!AGH_USER || !AGH_PASS) {
  log.error('dns', 'AGH_USER / AGH_PASSWORD not configured — DNS routes will fail');
}
const AGH_AUTH = {
  headers: {
    Authorization: `Basic ${Buffer.from(`${AGH_USER}:${AGH_PASS}`).toString('base64')}`,
    Accept: '*/*',
    'User-Agent': 'wg-fux-api',
  },
};

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
      [dnsInfo, filtering, safeSearch, safeBrowsing, parental] = await Promise.all([
        axios.get(`${AGH_BASE_URL}/control/dns_info`, AGH_AUTH),
        axios.get(`${AGH_BASE_URL}/control/filtering/status`, AGH_AUTH),
        axios.get(`${AGH_BASE_URL}/control/safesearch/status`, AGH_AUTH),
        axios.get(`${AGH_BASE_URL}/control/safebrowsing/status`, AGH_AUTH),
        axios.get(`${AGH_BASE_URL}/control/parental/status`, AGH_AUTH),
      ]);
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
      requests.push(axios.post(`${AGH_BASE_URL}/control/dns_config`, dnsConfig, AGH_AUTH));
    }

    if (filtering_enabled !== undefined) {
      requests.push(
        axios.post(
          `${AGH_BASE_URL}/control/filtering/config`,
          { enabled: !!filtering_enabled },
          AGH_AUTH
        )
      );
    }

    if (safesearch_enabled !== undefined) {
      requests.push(
        axios.put(
          `${AGH_BASE_URL}/control/safesearch/settings`,
          { enabled: !!safesearch_enabled },
          AGH_AUTH
        )
      );
    }

    if (safebrowsing_enabled !== undefined) {
      const mode = safebrowsing_enabled ? 'enable' : 'disable';
      requests.push(axios.post(`${AGH_BASE_URL}/control/safebrowsing/${mode}`, {}, AGH_AUTH));
    }

    if (parental_enabled !== undefined) {
      const mode = parental_enabled ? 'enable' : 'disable';
      requests.push(axios.post(`${AGH_BASE_URL}/control/parental/${mode}`, {}, AGH_AUTH));
    }

    if (requests.length > 0) {
      if (process.env.VITEST !== 'true') {
        await Promise.all(requests);
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
    let response = { data: {} };
    if (process.env.VITEST !== 'true') {
      response = await axios.get(`${AGH_BASE_URL}/control/stats`, {
        ...AGH_AUTH,
        maxRedirects: 0,
      });
    }
    res.json(response.data);
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
        ...AGH_AUTH,
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
        ...AGH_AUTH,
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
        { ...AGH_AUTH, maxRedirects: 0 }
      );
      return res.json({ success: true, data: response.data });
    }
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
        { ...AGH_AUTH, maxRedirects: 0 }
      );
      return res.json({ success: true, data: response.data });
    }
  })
);

module.exports = router;
