const log = require('./logger');
const { runSystemCommand } = require('./shell');
const { getScriptPath } = require('./config');

/**
 * 🔔 SaaS Builder: Unified Notification Service
 * Handles Telegram, Email (Mocked), and Webhooks.
 */
class NotificationService {
  constructor() {
    this.telegramEnabled = !!process.env.TELEGRAM_BOT_TOKEN;
  }

  async send(type, message, metadata = {}) {
    log.info('notify', `[${type.toUpperCase()}] ${message}`, metadata);

    // 1. Telegram
    if (this.telegramEnabled) {
      try {
        const result = await runSystemCommand(getScriptPath('wg-send-msg.sh'), [
          `🔔 *[${type.toUpperCase()}]*\n${message}`,
        ]);
        if (!result.success) {
          log.warn('notify', 'Telegram notification failed', { error: result.error });
        }
      } catch (e) {
        log.warn('notify', 'Telegram notification failed', { error: e.message });
      }
    }

    // 2. Email (Mocked for SaaS simulation)
    if (process.env.SMTP_HOST) {
      log.info('notify', `[MOCK-EMAIL] Sending to admin: ${message}`);
      // Real implementation with nodemailer would go here
    }

    // 3. Webhook (Optional for integrations)
    if (process.env.WEBHOOK_URL) {
      const axios = require('axios');
      axios
        .post(process.env.WEBHOOK_URL, { type, message, metadata, ts: new Date() }, { timeout: 5000 })
        .catch((e) => log.warn('notify', 'Webhook notification failed', { error: e.message }));
    }
  }

  async notifyUser(username, type, message) {
    // For internal dashboard notifications (stored in DB or Sent via WS)
    const wsService = require('./ws');
    wsService.sendToUser(username, 'notification', { type, message, ts: new Date() });
  }
}

module.exports = new NotificationService();
