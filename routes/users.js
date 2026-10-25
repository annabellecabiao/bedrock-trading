const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/users (Admin only) - Sophisticated Customer Profile List
router.get('/', authenticate, requireRole('admin'), (req, res) => {
  try {
    const users = db.prepare(`
      SELECT
        u.id, u.username, u.email, u.role, u.full_name,
        u.phone, u.company, u.address, u.barangay, u.city, u.province, u.postal_code,
        u.customer_tier, u.customer_type, u.preferred_category, u.tax_id, u.notes, u.status,
        u.created_at,
        COUNT(o.id) as total_orders,
        COUNT(o.id) as orders_count,
        COALESCE(SUM(o.total_amount), 0) as total_spent,
        COALESCE(SUM(o.total_amount), 0) as lifetime_spend,
        MAX(o.created_at) as last_order_date
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id OR (o.email = u.email AND o.email IS NOT NULL AND o.email != '')
      GROUP BY u.id
      ORDER BY total_spent DESC, u.created_at DESC
    `).all();

    res.json({ count: users.length, users });
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: 'Failed to fetch customer profile records: ' + err.message });
  }
});

// GET /api/users/:id (Admin only) - Detailed Customer Profile Dossier
router.get('/:id', authenticate, requireRole('admin'), (req, res) => {
  try {
    const user = db.prepare(`
      SELECT
        id, username, email, role, full_name,
        phone, company, address, barangay, city, province, postal_code,
        customer_tier, customer_type, preferred_category, tax_id, notes, status,
        created_at
      FROM users WHERE id = ?
    `).get(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'Customer record not found' });
    }

    // Retrieve full order history for this customer
    const orders = db.prepare(`
      SELECT * FROM orders
      WHERE user_id = ? OR (email = ? AND email IS NOT NULL AND email != '')
      ORDER BY created_at DESC
    `).all(user.id, user.email);

    const parsedOrders = orders.map(o => ({
      ...o,
      items: JSON.parse(o.items || '[]')
    }));

    const totalSpent = parsedOrders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const completedOrders = parsedOrders.filter(o => o.status === 'delivered' || o.status === 'shipped').length;
    const avgOrderValue = parsedOrders.length > 0 ? (totalSpent / parsedOrders.length) : 0;

    const stats = {
      totalOrders: parsedOrders.length,
      orders_count: parsedOrders.length,
      completedOrders,
      totalSpent,
      lifetime_spend: totalSpent,
      avgOrderValue: Math.round(avgOrderValue),
      aov: Math.round(avgOrderValue),
      lastOrderDate: parsedOrders.length > 0 ? parsedOrders[0].created_at : null
    };

    user.metrics = stats;
    user.orders = parsedOrders;

    res.json({
      user,
      stats,
      metrics: stats,
      orders: parsedOrders
    });
  } catch (err) {
    console.error('Fetch customer dossier error:', err);
    res.status(500).json({ error: 'Failed to fetch customer dossier: ' + err.message });
  }
});

// PUT /api/users/:id (Admin only) - Update Customer Profile Details
router.put('/:id', authenticate, requireRole('admin'), (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const {
      full_name, email, phone, company, address, barangay,
      city, province, postal_code, customer_tier, customer_type,
      preferred_category, tax_id, notes, status, role
    } = req.body;

    // Check email uniqueness if email provided
    if (email) {
      const emailDup = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), req.params.id);
      if (emailDup) {
        return res.status(400).json({ error: 'Email is already assigned to another customer account.' });
      }
    }

    const update = db.prepare(`
      UPDATE users SET
        full_name = COALESCE(?, full_name),
        email = COALESCE(?, email),
        phone = COALESCE(?, phone),
        company = COALESCE(?, company),
        address = COALESCE(?, address),
        barangay = COALESCE(?, barangay),
        city = COALESCE(?, city),
        province = COALESCE(?, province),
        postal_code = COALESCE(?, postal_code),
        customer_tier = COALESCE(?, customer_tier),
        customer_type = COALESCE(?, customer_type),
        preferred_category = COALESCE(?, preferred_category),
        tax_id = COALESCE(?, tax_id),
        notes = COALESCE(?, notes),
        status = COALESCE(?, status),
        role = COALESCE(?, role)
      WHERE id = ?
    `);

    update.run(
      full_name !== undefined ? full_name.trim() : null,
      email !== undefined ? email.trim().toLowerCase() : null,
      phone !== undefined ? phone.trim() : null,
      company !== undefined ? company.trim() : null,
      address !== undefined ? address.trim() : null,
      barangay !== undefined ? barangay.trim() : null,
      city !== undefined ? city.trim() : null,
      province !== undefined ? province.trim() : null,
      postal_code !== undefined ? postal_code.trim() : null,
      customer_tier !== undefined ? customer_tier.trim() : null,
      customer_type !== undefined ? customer_type.trim() : null,
      preferred_category !== undefined ? preferred_category.trim() : null,
      tax_id !== undefined ? tax_id.trim() : null,
      notes !== undefined ? notes.trim() : null,
      status !== undefined ? status.trim() : null,
      role !== undefined ? role.trim() : null,
      req.params.id
    );

    const updated = db.prepare(`
      SELECT
        id, username, email, role, full_name,
        phone, company, address, barangay, city, province, postal_code,
        customer_tier, customer_type, preferred_category, tax_id, notes, status,
        created_at
      FROM users WHERE id = ?
    `).get(req.params.id);

    res.json({ message: 'Customer profile updated successfully', user: updated });
  } catch (err) {
    console.error('Update customer profile error:', err);
    res.status(500).json({ error: 'Failed to update customer profile: ' + err.message });
  }
});

// PATCH /api/users/:id/role (Admin only)
router.patch('/:id/role', authenticate, requireRole('admin'), (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either admin or viewer.' });
    }

    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role.' });
    }

    const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User role updated successfully', role });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// DELETE /api/users/:id (Admin only)
router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
