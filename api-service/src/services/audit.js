const { db, schema } = require('../../db');
const { lt } = require('drizzle-orm');
const log = require('./logger');

/**
 * Log an administrative action to the audit_logs table
 * @param {Object} params - Audit parameters
 * @param {string} params.actor - Username of the person who performed the action
 * @param {string} params.action - 'create', 'delete', 'patch', 'toggle', 'move'
 * @param {string} params.targetType - 'client', 'container', 'user', 'system'
 * @param {string} params.targetName - name/identifier of the target
 * @param {Object} [params.details] - Optional metadata or changes
 * @param {string} [params.ip] - IP address of the requester
 */
async function auditLog({ actor, action, targetType, targetName, details = {}, ip = '' }) {
  try {
    await db.insert(schema.auditLogs).values({
      timestamp: new Date(),
      actor,
      action,
      targetType,
      targetName,
      details: JSON.stringify(details),
      ip,
    });

    // Also log to the standard application logger for real-time visibility
    log.info('audit', `${actor} performed ${action} on ${targetType}:${targetName}`, {
      actor,
      action,
      targetType,
      targetName,
      details,
    });
  } catch (error) {
    log.error('audit', `Failed to record audit log: ${error.message}`, {
      actor,
      action,
      targetType,
      targetName,
    });
    // We don't throw here to avoid breaking the main functionality if audit logging fails
  }
}

/**
 * Mental Garbage Collection: Purge logs older than X days
 * @param {number} days - Retain logs for this many days (default 30)
 */
async function gcAuditLogs(days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  try {
    // 1. Purge Audit Logs
    const auditResult = await db
      .delete(schema.auditLogs)
      .where(lt(schema.auditLogs.timestamp, cutoff));
    log.info('audit', `GC: Purged audit logs older than ${days} days.`);

    // 2. Purge System Logs (Heavy data)
    const logsResult = await db.delete(schema.logs).where(lt(schema.logs.timestamp, cutoff));
    log.info('audit', `GC: Purged system snapshot logs older than ${days} days.`);

    return { auditResult, logsResult };
  } catch (error) {
    log.error('audit', `GC Failed: ${error.message}`);
  }
}

module.exports = {
  auditLog,
  gcAuditLogs,
};
