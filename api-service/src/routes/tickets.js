const express = require('express');
const router = express.Router();
const { db, schema } = require('../../db');
const { eq, desc } = require('drizzle-orm');
const { ticketSchema, ticketReplySchema } = require('../../db/validation');
const { auth } = require('../middleware/auth');
const { asyncWrap, createError } = require('../utils/errors');

router.get(
  '/',
  auth,
  asyncWrap(async (req, res) => {
    let results;
    if (req.user.role === 'admin') {
      results = await db.select().from(schema.tickets).orderBy(desc(schema.tickets.updatedAt));
    } else {
      results = await db
        .select()
        .from(schema.tickets)
        .where(eq(schema.tickets.username, req.user.username))
        .orderBy(desc(schema.tickets.updatedAt));
    }
    res.json(results.map((t) => ({ ...t, messages: JSON.parse(t.messages || '[]') })));
  })
);

router.post(
  '/',
  auth,
  asyncWrap(async (req, res) => {
    const result = ticketSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }

    const { title, message } = result.data;
    const ticketData = {
      username: req.user.username,
      title,
      status: 'open',
      messages: JSON.stringify([
        { sender: req.user.username, text: message, timestamp: new Date().toISOString() },
      ]),
      updatedAt: new Date(),
    };
    const [newTicket] = await db.insert(schema.tickets).values(ticketData).returning();
    res.json({ ...newTicket, messages: JSON.parse(newTicket.messages) });
  })
);

router.post(
  '/:id/reply',
  auth,
  asyncWrap(async (req, res) => {
    const result = ticketReplySchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }

    const { message, status } = result.data;

    const [ticket] = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.id, req.params.id))
      .limit(1);

    if (!ticket) {
      return res.status(404).json(createError('Ticket not found', null, 'NOT_FOUND'));
    }

    if (req.user.role !== 'admin' && ticket.username !== req.user.username) {
      return res.status(403).json(createError('Access denied', null, 'FORBIDDEN'));
    }

    let messages = JSON.parse(ticket.messages || '[]');
    if (message) {
      messages.push({
        sender: req.user.username,
        text: message,
        timestamp: new Date().toISOString(),
      });
    }

    const updateData = { messages: JSON.stringify(messages), updatedAt: new Date() };
    if (status) updateData.status = status;

    await db.update(schema.tickets).set(updateData).where(eq(schema.tickets.id, req.params.id));
    res.json({ success: true });
  })
);

module.exports = router;
