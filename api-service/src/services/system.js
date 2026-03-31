const fsPromises = require('fs').promises;
const path = require('path');
const { runCommand, runSystemCommand } = require('./shell');

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
 * Parses WireGuard dump output into structured JSON
 */
const parseWireGuardDump = (stdout) => {
    if (!stdout) return [];
    const now = Math.floor(Date.now() / 1000);
    return stdout.trim().split('\n').map(line => {
        const parts = line.split('\t');
        if (parts.length < 8) return null;
        const lastSeen = parseInt(parts[4]) || 0;
        return {
            publicKey: parts[0],
            preSharedKey: parts[1],
            endpoint: parts[2],
            allowedIps: parts[3],
            lastSeen,
            rx: parseInt(parts[5]) || 0,
            tx: parseInt(parts[6]) || 0,
            isOnline: (now - lastSeen) < 180,
            keepalive: parts[7]
        };
    }).filter(Boolean);
};

/**
 * Retrieves WireGuard statistics...
 */
const getWireGuardStats = async () => {
    try {
        const { stdout } = await runSystemCommand('/usr/local/bin/wg-stats.sh', ['show', process.env.WG_INTERFACE, 'dump']);
        return stdout;
    } catch (e) {
        console.error('[SYSTEM-SERVICE] Error getting WG stats:', e);
        return "";
    }
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
const isValidName = (str) => /^[a-zA-Z0-9_\-]+$/.test(str);
const isValidExpiry = (str) => !str || /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(str);
const isValidNumber = (str) => !str || /^[0-9]+$/.test(String(str));

module.exports = {
    getWireGuardStats,
    getSystemStats,
    getClientDir,
    getInterfacePath,
    parseWireGuardDump,
    formatBytes,
    isValidName,
    isValidExpiry,
    isValidNumber
};
