const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');

// Helper to generate readable order numbers
function generateOrderNumber() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BR-${dateStr}-${rand}`;
}

// POST /api/orders (Public / Guest or Authenticated Viewer)
router.post('/', optionalAuth, (req, res) => {
  try {
    const {
      customer_name, email, phone, address,
      barangay, city, province, zip,
      delivery_method, delivery_fee, payment_method,
      items, notes
    } = req.body;

    if (!customer_name || !phone || !address || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Customer name, phone, address, and items are required.' });
    }

    const orderNumber = generateOrderNumber();
    const userId = req.user ? req.user.id : null;
    const fee = parseFloat(delivery_fee) || 0;

    let totalItems = 0;
    let itemsSubtotal = 0;

    items.forEach(it => {
      const q = parseInt(it.qty) || 1;
      const p = parseFloat(it.price) || 0;
      totalItems += q;
      itemsSubtotal += (p * q);
    });

    const totalAmount = itemsSubtotal + fee;

    const insert = db.prepare(`
      INSERT INTO orders (
        order_number, user_id, customer_name, email, phone,
        address, barangay, city, province, zip,
        delivery_method, delivery_fee, payment_method,
        items, total_items, total_amount, notes, status
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, 'pending'
      )
    `);

    const result = insert.run(
      orderNumber,
      userId,
      customer_name.trim(),
      (email || (req.user ? req.user.email : '')).trim(),
      phone.trim(),
      address.trim(),
      (barangay || '').trim(),
      (city || '').trim(),
      (province || '').trim(),
      (zip || '').trim(),
      delivery_method || 'standard',
      fee,
      payment_method || 'gcash',
      JSON.stringify(items),
      totalItems,
      totalAmount,
      (notes || '').trim()
    );

    res.status(201).json({
      message: 'Order placed successfully!',
      orderNumber,
      orderId: result.lastInsertRowid,
      totalAmount,
      totalItems,
      status: 'pending'
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to place order: ' + err.message });
  }
});

// GET /api/orders (Admin sees all; Viewer sees their own)
router.get('/', authenticate, (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (req.user.role !== 'admin') {
      // Viewer only sees their own orders
      query += ' AND (user_id = ? OR email = ?)';
      params.push(req.user.id, req.user.email);
    } else if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const orders = db.prepare(query).all(...params);
    const parsed = orders.map(o => ({
      ...o,
      items: JSON.parse(o.items)
    }));

    res.json({ count: parsed.length, orders: parsed });
  } catch (err) {
    console.error('Fetch orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// PATCH /api/orders/:id/status (Admin only)
router.patch('/:id/status', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!valid.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid values: ${valid.join(', ')}` });
    }

    const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json({ message: 'Order status updated successfully', status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

module.exports = router;
