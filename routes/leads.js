const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

// POST /api/leads (Public - for contact form and lead capture)
router.post('/', (req, res) => {
  try {
    const { name, email, phone, company, inquiry_type, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required.' });
    }

    const insert = db.prepare(`
      INSERT INTO leads (name, email, phone, company, inquiry_type, message, status)
      VALUES (?, ?, ?, ?, ?, ?, 'new')
    `);

    const result = insert.run(
      name.trim(),
      email.trim(),
      (phone || '').trim(),
      (company || '').trim(),
      inquiry_type || 'General Inquiry',
      message.trim()
    );

    res.status(201).json({
      message: 'Thank you for your message! Our team will get back to you shortly.',
      leadId: result.lastInsertRowid
    });
  } catch (err) {
    console.error('Submit lead error:', err);
    res.status(500).json({ error: 'Failed to submit inquiry. Please try again.' });
  }
});

// GET /api/leads (Admin only)
router.get('/', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM leads';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const leads = db.prepare(query).all(...params);
    res.json({ count: leads.length, leads });
  } catch (err) {
    console.error('Fetch leads error:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// PATCH /api/leads/:id/status (Admin only)
router.patch('/:id/status', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['new', 'contacted', 'qualified', 'closed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const result = db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({ message: 'Lead status updated successfully', status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update lead status' });
  }
});

// DELETE /api/leads/:id (Admin only)
router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  try {
    const result = db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.json({ message: 'Lead deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

module.exports = router;
