const fsPromises = require('fs').promises;
const path = require('path');
const { runCommand } = require('./shell');
const { executeScript } = require('./scripts');

/**
 * Format bytes to human readable string
 */
const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Get CPU, Memory, and Disk stats from linux /proc and df
 */
const getSystemStats = async () => {
  try {
    const cpuInfo1 = (await fsPromises.readFile('/proc/stat', 'utf8')).split('\n')[0].split(/\s+/);
    await new Promise(r => setTimeout(r, 200));
    const cpuInfo2 = (await fsPromises.readFile('/proc/stat', 'utf8')).split('\n')[0].split(/\s+/);
    const calcTotal = (stats) => stats.slice(1, 8).reduce((a, b) => a + parseInt(b), 0);
    const total1 = calcTotal(cpuInfo1);
    const total2 = calcTotal(cpuInfo2);
    const idle1 = parseInt(cpuInfo1[4]);
    const idle2 = parseInt(cpuInfo2[4]);
    const diffTotal = total2 - total1;
    const cpuUsage = diffTotal > 0 ? (1 - (idle2 - idle1) / diffTotal) * 100 : 0;

    const memInfo = await fsPromises.readFile('/proc/meminfo', 'utf8');
    const memTotal = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)[1]);
    const memAvailable = parseInt(memInfo.match(/MemAvailable:\s+(\d+)/)[1]);
    const memUsage = ((memTotal - memAvailable) / memTotal) * 100;

    const { stdout: diskOut } = await runCommand('df', ['-kP', '/']);
    const lines = diskOut.trim().split('\n');
    const parts = lines.length > 1 ? lines[1].split(/\s+/) : [];
    const useStr = parts.length >= 5 ? parts[4] : '0%';
    const diskUsage = parseFloat(useStr.replace('%', ''));

    return {
      cpu: isNaN(cpuUsage) ? 0 : cpuUsage.toFixed(1),
      memory: isNaN(memUsage) ? 0 : memUsage.toFixed(1),
      disk: isNaN(diskUsage) ? 0 : diskUsage.toFixed(1)
    };
  } catch (error) {
    console.error('[SYSTEM-SERVICE] Error getting system stats:', error);
    return { cpu: 0, memory: 0, disk: 0 };
  }
};

/**
 * Parses WireGuard dump output into structured JSON (Now handled by the script itself)
 */
const parseWireGuardDump = (data) => {
  return Array.isArray(data) ? data : [];
};

/**
 * Retrieves WireGuard statistics...
 */
const getWireGuardStats = async () => {
  const result = await executeScript('wg-stats.sh', [process.env.WG_INTERFACE || 'wg0'], { json: true });
  return result.success ? result.data : [];
};

/**
 * Get filesystem path for a specific client
 */
const getClientDir = (container, name) => {
  return path.join('/etc/wireguard/clients', String(container), String(name));
};

/**
 * Get system path for network interface stats
 */
const getInterfacePath = (iface) => {
  return `/sys/class/net/${iface || process.env.WG_INTERFACE || 'wg0'}`;
};

/**
 * Validates common identifiers (names, containers)
 */
const isValidName = (str) => /^[a-zA-Z0-9_-]+$/.test(str);
const isValidExpiry = (str) => !str || /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(str);
const isValidNumber = (str) => !str || /^[0-9]+$/.test(String(str));

/**
 * Robustly wait for a file to exist on disk (retries with backoff)
 */
const waitForFile = async (filePath, retries = 5, delay = 500) => {
  for (let i = 0; i < retries; i++) {
    try {
      await fsPromises.access(filePath);
      return true;
    } catch (e) {
      if (i === retries - 1) return false;
      await new Promise(r => setTimeout(r, delay * (i + 1))); // Exponential-ish backoff
    }
  }
  return false;
};

/**
 * Get current MTU for an interface
 */
const getMTU = async (iface) => {
  try {
    // Lecture de la config manager.conf (Source de vérité de l'utilisateur)
    const conf = await fsPromises.readFile('/etc/wireguard/manager.conf', 'utf8').catch(() => '');
    const match = conf.match(/SERVER_MTU="?(\d+)"?/);
    if (match) return parseInt(match[1]);

    // Fallback sur l'interface système si disponible
    const sysMtu = await fsPromises.readFile(`/sys/class/net/${iface || 'wg0'}/mtu`, 'utf8');
    return parseInt(sysMtu.trim());
  } catch { return 1420; }
};

/**
 * Estimate Jitter via light ICMP probe (8.8.8.8)
 */
const estimateJitter = async () => {
  try {
    // Ping vers le gateway local (plus pertinent que 8.8.8.8, moins de trafic externe)
    // Fallback vers le DNS Cloudflare si pas de gateway détectable
    const { stdout: gwOut } = await runCommand('ip', ['route', 'show', 'default']).catch(() => ({ stdout: '' }));
    const gwMatch = gwOut.match(/via\s+(\S+)/);
    const target = gwMatch ? gwMatch[1] : '1.1.1.1';
    // 3 paquets, intervalle 0.3s, timeout 1s
    const { stdout } = await runCommand('ping', ['-c', '3', '-i', '0.3', '-W', '1', target]);
    const match = stdout.match(/rtt min\/avg\/max\/mdev = [0-9.]+\/[0-9.]+\/[0-9.]+\/([0-9.]+)/);
    return match ? parseFloat(match[1]) : 0.5;
  } catch { return 0.5; }
};

/**
 * High-frequency telemetry (CPU + Network)
 */
const getTelemetry = async () => {
  const stats = await getSystemStats(); // Includes short sleep for delta
  const mtu = await getMTU();
  const jitter = await estimateJitter();
    
  // Heuristique Bufferbloat : 
  // A+ (Jitter < 1ms), A (1-3ms), B (3-10ms), C (>10ms)
  let bloatGrade = 'A+';
  if (jitter > 10) bloatGrade = 'C';
  else if (jitter > 3) bloatGrade = 'B';
  else if (jitter > 1) bloatGrade = 'A';
    
  return {
    cpu: stats.cpu,
    memory: stats.memory,
    mtu,
    jitter: jitter.toFixed(2),
    bufferbloat: bloatGrade,
    timestamp: new Date().toISOString()
  };
};

/**
 * Vibe-OS v6.3: Check if all critical scripts are present and executable
 */
const checkScripts = async () => {
  const criticalScripts = [
    'wg-create-client.sh',
    'wg-remove-client.sh',
    'wg-stats.sh',
    'wg-enforcer.sh'
  ];
  const { getScriptPath } = require('./config');
  for (const script of criticalScripts) {
    try {
      await fsPromises.access(getScriptPath(script), fsPromises.constants.X_OK);
    } catch { return false; }
  }
  return true;
};

/**
 * Discover network interfaces
 */
const getInterfaces = async () => {
  try {
    const files = await fsPromises.readdir('/sys/class/net');
    return files.filter(f => f !== 'lo');
  } catch { return ['wg0']; }
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
  getInterfaces
};

