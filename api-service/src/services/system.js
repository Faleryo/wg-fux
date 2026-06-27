const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');
const { runCommand } = require('./shell');
const { executeScript } = require('./scripts');
const log = require('./logger');

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + (sizes[i] || 'B');
};

let _prevCpuStats = null;

const getSystemStats = async () => {
  try {
    const raw = await fsPromises.readFile('/proc/stat', 'utf8').catch(() => '');
    const cpuInfo = (raw.split('\n')?.[0] || '').split(/\s+/);

    const calcTotal = (stats) => {
      if (!Array.isArray(stats)) return 0;
      return stats.slice(1, 8).reduce((a, b) => a + (parseInt(b) || 0), 0);
    };

    const currentTotal = calcTotal(cpuInfo);
    const currentIdle = parseInt(cpuInfo?.[4]) || 0;
    let cpuUsage = 0;
    if (_prevCpuStats) {
      const diffTotal = currentTotal - _prevCpuStats.total;
      const diffIdle = currentIdle - _prevCpuStats.idle;
      cpuUsage = diffTotal > 0 ? (1 - diffIdle / diffTotal) * 100 : 0;
    }
    _prevCpuStats = { total: currentTotal, idle: currentIdle };

    const memInfo = await fsPromises.readFile('/proc/meminfo', 'utf8').catch(() => '');
    const memTotalMatch = memInfo.match(/MemTotal:\s+(\d+)/);
    const memAvailableMatch = memInfo.match(/MemAvailable:\s+(\d+)/);
    const memFreeMatch = memInfo.match(/MemFree:\s+(\d+)/);
    const memCachedMatch = memInfo.match(/Cached:\s+(\d+)/);

    const memTotal = memTotalMatch ? parseInt(memTotalMatch[1]) || 0 : 0;
    let memAvailable = memAvailableMatch ? parseInt(memAvailableMatch[1]) || 0 : 0;
    if (!memAvailable && memFreeMatch && memCachedMatch) {
      memAvailable = (parseInt(memFreeMatch[1]) || 0) + (parseInt(memCachedMatch[1]) || 0);
    }

    const memUsage = memTotal > 0 ? ((memTotal - memAvailable) / memTotal) * 100 : 0;

    const diskRaw = await runCommand('df', ['-kP', '/']).catch(() => ({ stdout: '' }));
    const diskOut = diskRaw.stdout || '';
    const lines = diskOut.trim().split('\n');
    const parts = (lines[1] || '').split(/\s+/) || [];
    const useStr = parts.length >= 5 ? parts?.[4] : '0%';
    const diskUsage = parseFloat(useStr.replace('%', '')) || 0;

    return {
      cpu: isNaN(cpuUsage) ? '0.0' : cpuUsage.toFixed(1),
      memory: isNaN(memUsage) ? '0.0' : memUsage.toFixed(1),
      disk: isNaN(diskUsage) ? '0.0' : diskUsage.toFixed(1),
    };
  } catch (error) {
    return { cpu: '0.0', memory: '0.0', disk: '0.0' };
  }
};

const parseWireGuardDump = (peers) => {
  return Array.isArray(peers) ? peers : [];
};

const getWireGuardStats = async (iface) => {
  try {
    const targetIface = iface || process.env.WG_INTERFACE || 'wg0';
    if (!isValidName(targetIface)) {
      log.error('system', `Invalid interface name: ${targetIface}`);
      return [];
    }
    const result = await executeScript('wg-stats.sh', [targetIface], {
      json: true,
    });
    return result.success ? result.data || [] : [];
  } catch (e) {
    log.error('system', 'getWireGuardStats failed', { error: e.message });
    return [];
  }
};

const getClientDir = (container, name) => {
  return path.join(
    '/etc/wireguard/clients',
    String(container || 'default'),
    String(name || 'default')
  );
};

const getInterfacePath = (iface) => {
  return `/sys/class/net/${iface || process.env.WG_INTERFACE || 'wg0'}`;
};

const isValidName = (str) => /^[a-zA-Z0-9_-]{1,15}$/.test(str || '');
const isValidExpiry = (str) => !str || /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(str);
const isValidNumber = (str) => !str || /^[0-9]+$/.test(String(str));

const waitForFile = async (filePath, retries = 5, delay = 500) => {
  for (let i = 0; i < retries; i++) {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch (e) {
      if (i === retries - 1) return false;
      await new Promise((r) => setTimeout(r, delay * (i + 1)));
    }
  }
  return false;
};

const getMTU = async (iface) => {
  try {
    const targetIface = iface || process.env.WG_INTERFACE || 'wg0';
    if (!isValidName(targetIface)) return 1420;

    const conf = await fsPromises.readFile('/etc/wireguard/manager.conf', 'utf8').catch(() => '');
    const match = conf.match(/SERVER_MTU="?(\d+)"?/);
    if (match) return parseInt(match?.[1]) || 1420;

    const sysMtu = await fsPromises
      .readFile(`/sys/class/net/${targetIface}/mtu`, 'utf8')
      .catch(() => '1420');
    return parseInt(sysMtu.trim()) || 1420;
  } catch {
    return 1420;
  }
};

const estimateJitter = async () => {
  try {
    const gwRaw = await runCommand('ip', ['route', 'show', 'default']).catch(() => ({
      stdout: '',
    }));
    const gwOut = gwRaw.stdout || '';
    const gwMatch = gwOut.match(/via\s+(\S+)/);
    const target = gwMatch ? gwMatch?.[1] : '1.1.1.1';

    const pingRaw = await runCommand('ping', ['-c', '3', '-i', '0.3', '-W', '1', target]).catch(
      () => ({ stdout: '' })
    );
    const stdout = pingRaw.stdout || '';
    const match = stdout.match(/rtt min\/avg\/max\/mdev = [0-9.]+\/[0-9.]+\/[0-9.]+\/([0-9.]+)/);
    return match ? parseFloat(match?.[1]) : 0.5;
  } catch {
    return 0.5;
  }
};

const getTelemetry = async (iface) => {
  try {
    const targetIface = iface || process.env.WG_INTERFACE || 'wg0';
    if (!isValidName(targetIface)) {
      return {
        cpu: '0.0',
        memory: '0.0',
        mtu: 1420,
        jitter: '0.50',
        bufferbloat: 'A+',
        timestamp: new Date().toISOString(),
      };
    }
    const stats = await getSystemStats();
    const mtu = await getMTU(targetIface);
    const jitter = await estimateJitter();

    let bloatGrade = 'A+';
    if (jitter > 10) bloatGrade = 'C';
    else if (jitter > 3) bloatGrade = 'B';
    else if (jitter > 1) bloatGrade = 'A';

    return {
      interface: targetIface,
      cpu: stats.cpu,
      memory: stats.memory,
      load_avg: os.loadavg()[0].toFixed(2),
      mtu,
      jitter: (jitter || 0.5).toFixed(2),
      bufferbloat: bloatGrade,
      p95: log.getP95Latency ? log.getP95Latency() : 0,
      timestamp: new Date().toISOString(),
    };
  } catch (e) {
    log.error('system', 'getTelemetry failed', { error: e.message });
    return {
      cpu: '0.0',
      memory: '0.0',
      mtu: 1420,
      jitter: '0.50',
      bufferbloat: 'A+',
      timestamp: new Date().toISOString(),
    };
  }
};

const { getScriptPath } = require('./config');

const checkScripts = async () => {
  const { constants: fsConstants } = require('fs');
  const criticalScripts = [
    'wg-create-client.sh',
    'wg-remove-client.sh',
    'wg-stats.sh',
    'wg-enforcer.sh',
  ];
  for (const script of criticalScripts) {
    try {
      await fsPromises.access(getScriptPath(script), fsConstants.X_OK);
    } catch {
      return false;
    }
  }
  return true;
};

const getInterfaces = async () => {
  try {
    const files = await fsPromises.readdir('/sys/class/net').catch(() => []);
    const interfaces = (files || []).filter((f) => f !== 'lo');

    return await Promise.all(
      interfaces.map(async (iface) => {
        const isWg = iface.startsWith('wg');
        const mtu = await fsPromises
          .readFile(`/sys/class/net/${iface}/mtu`, 'utf8')
          .catch(() => 'N/A');
        const operState = await fsPromises
          .readFile(`/sys/class/net/${iface}/operstate`, 'utf8')
          .catch(() => 'unknown');

        return {
          name: iface,
          type: isWg ? 'WireGuard' : 'Physical',
          status: operState.trim(),
          mtu: mtu.trim(),
        };
      })
    );
  } catch (e) {
    log.error('system', 'getInterfaces failed', { error: e.message });
    return [{ name: 'wg0', type: 'WireGuard', status: 'unknown', mtu: '1420' }];
  }
};

module.exports = {
  getWireGuardStats,
  getSystemStats,
  getTelemetry,
  getMTU,
  estimateJitter,
  getClientDir,
  getInterfacePath,
  parseWireGuardDump,
  formatBytes,
  isValidName,
  isValidExpiry,
  isValidNumber,
  waitForFile,
  checkScripts,
  getInterfaces,
};
