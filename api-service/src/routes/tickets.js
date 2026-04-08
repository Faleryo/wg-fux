const express = require('express');
const router = express.Router();
const { db, schema } = require('../../db');
const { eq, desc } = require('drizzle-orm');
const { ticketSchema } = require('../../db/validation');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    let results;
    if (req.user.role === 'admin') {
      results = await db.select().from(schema.tickets).orderBy(desc(schema.tickets.updatedAt));
    } else {
      results = await db.select().from(schema.tickets).where(eq(schema.tickets.username, req.user.username)).orderBy(desc(schema.tickets.updatedAt));
    }
    res.json(results.map(t => ({ ...t, messages: JSON.parse(t.messages || '[]') })));
  } catch(e) { res.json([]); }
});

router.post('/', auth, async (req, res) => {
  try {
    const result = ticketSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.errors?.?.[0]?.message || 'Validation failed' });
        
    const { title, message } = result.data;
    const ticketData = {
      username: req.user.username,
      title,
      status: 'open',
      messages: JSON.stringify([{ sender: req.user.username, text: message, timestamp: new Date().toISOString() }]),
      updatedAt: new Date()
    };
    const [newTicket] = await db.insert(schema.tickets).values(ticketData).returning();
    res.json({ ...newTicket, messages: JSON.parse(newTicket.messages) });
  } catch(e) { res.status(500).json({error: e.message}); }
});

router.post('/:id/reply', auth, async (req, res) => {
  const { message, status } = req.body;
  if (!message && !status) return res.status(400).json({ error: 'Message or status required' });
    
  try {
    const [ticket] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, req.params.id)).limit(1);
    if (!ticket) return res.status(404).json({error: 'Ticket not found'});
        
    if (req.user.role !== 'admin' && ticket.username !== req.user.username) {
      return res.status(403).json({ error: 'Access denied' });
    }

    let messages = JSON.parse(ticket.messages || '[]');
    if (message) {
      if (typeof message !== 'string' || message.length > 5000) return res.status(400).json({ error: 'Invalid message' });
      messages.push({ sender: req.user.username, text: message, timestamp: new Date().toISOString() });
    }
        
    const updateData = { messages: JSON.stringify(messages), updatedAt: new Date() };
    if (status && ['open', 'closed', 'pending'].includes(status)) updateData.status = status;
        
    await db.update(schema.tickets).set(updateData).where(eq(schema.tickets.id, req.params.id));
    res.json({ success: true });
  } catch(e) { res.status(500).json({error: e.message}); }
});

module.exports = router;
