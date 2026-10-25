const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { authenticate, requireRole } = require('../middleware/auth');
const { syncSeedDataFile } = require('../db/sync-seed');

// Helper to generate next sequential product ID (e.g., w10, o18)
function getNextProductId(category) {
  const prefix = category === 'wine' ? 'w' : 'o';
  const products = db.prepare('SELECT id FROM products WHERE category = ?').all(category);
  let maxNum = 0;
  for (const p of products) {
    const match = String(p.id).match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }
  return maxNum > 0 ? `${prefix}${maxNum + 1}` : `${prefix}_${Date.now()}`;
}

// GET /api/products (Public)
router.get('/', (req, res) => {
  try {
    const { category, type, variety, in_stock, search } = req.query;
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (variety) {
      query += ' AND variety LIKE ?';
      params.push(`%${variety}%`);
    }
    if (in_stock !== undefined) {
      query += ' AND in_stock = ?';
      params.push(in_stock === 'true' || in_stock === '1' ? 1 : 0);
    }
    if (search) {
      query += ' AND (name LIKE ? OR fullName LIKE ? OR description LIKE ? OR variety LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    query += ` ORDER BY
      CASE WHEN category = 'wine' THEN 1 ELSE 2 END,
      CAST(SUBSTR(id, 2) AS INTEGER) ASC,
      id ASC`;

    const products = db.prepare(query).all(...params);

    // Parse JSON tags
    const formatted = products.map(p => ({
      ...p,
      tags: p.tags ? JSON.parse(p.tags) : []
    }));

    res.json({ count: formatted.length, products: formatted });
  } catch (err) {
    console.error('Fetch products error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// POST /api/products/sync-seed (Admin only) - Synchronize seed-data.js from database on-demand
router.post('/sync-seed', authenticate, requireRole('admin'), (req, res) => {
  try {
    const result = syncSeedDataFile();
    res.json({ message: 'seed-data.js synchronized successfully', ...result });
  } catch (err) {
    console.error('Sync seed data error:', err);
    res.status(500).json({ error: 'Failed to synchronize seed-data.js: ' + err.message });
  }
});

// GET /api/products/:id (Public)
router.get('/:id', (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    product.tags = product.tags ? JSON.parse(product.tags) : [];
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// POST /api/products (Admin only)
router.post('/', authenticate, requireRole('admin'), (req, res) => {
  try {
    const {
      id, category, name, fullName, variety, region, denomination,
      type, volume, container, special, description, tags, price,
      icon, color, image, in_stock, stock_quantity, reorder_level
    } = req.body;

    if (!name || !category) {
      return res.status(400).json({ error: 'Product name and category (wine or oil) are required.' });
    }

    const prodId = (id && String(id).trim()) ? String(id).trim() : getNextProductId(category);
    const stockQty = stock_quantity !== undefined ? parseInt(stock_quantity, 10) || 0 : 50;
    const reorderLvl = reorder_level !== undefined ? parseInt(reorder_level, 10) || 0 : 15;

    const insert = db.prepare(`
      INSERT INTO products (
        id, category, name, fullName, variety, region, denomination, type,
        volume, container, special, description, tags, price, icon, color, image, in_stock, stock_quantity, reorder_level
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    insert.run(
      prodId,
      category,
      name,
      fullName || name,
      variety || '',
      region || '',
      denomination || '',
      type || '',
      volume || '',
      container || '',
      special || '',
      description || '',
      JSON.stringify(Array.isArray(tags) ? tags : (tags ? [tags] : [])),
      parseFloat(price) || 0,
      icon || (category === 'wine' ? '🍷' : '🫒'),
      color || (category === 'wine' ? '#6b1d2a' : '#4a5b1d'),
      image || '',
      in_stock === undefined ? 1 : (in_stock ? 1 : 0),
      stockQty,
      reorderLvl
    );

    // Automatically synchronize seed-data.js with the updated database
    try {
      syncSeedDataFile();
    } catch (syncErr) {
      console.error('Warning: Failed to auto-sync seed-data.js after product creation:', syncErr);
    }

    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(prodId);
    created.tags = JSON.parse(created.tags);

    res.status(201).json({ message: 'Product created successfully and seed-data.js synchronized', product: created });
  } catch (err) {
    console.error('Create product error:', err);
    res.status(500).json({ error: 'Failed to create product: ' + err.message });
  }
});

// PUT /api/products/:id (Admin only)
router.put('/:id', authenticate, requireRole('admin'), (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const {
      newId,
      id,
      category, name, fullName, variety, region, denomination,
      type, volume, container, special, description, tags, price,
      icon, color, image, in_stock, stock_quantity, reorder_level
    } = req.body;

    const targetId = (newId || id || req.params.id).toString().trim();
    if (targetId !== req.params.id) {
      const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(targetId);
      if (existing) {
        return res.status(400).json({ error: `Product ID '${targetId}' already exists.` });
      }
    }

    const update = db.prepare(`
      UPDATE products SET
        id = ?,
        category = COALESCE(?, category),
        name = COALESCE(?, name),
        fullName = COALESCE(?, fullName),
        variety = COALESCE(?, variety),
        region = COALESCE(?, region),
        denomination = COALESCE(?, denomination),
        type = COALESCE(?, type),
        volume = COALESCE(?, volume),
        container = COALESCE(?, container),
        special = COALESCE(?, special),
        description = COALESCE(?, description),
        tags = COALESCE(?, tags),
        price = COALESCE(?, price),
        icon = COALESCE(?, icon),
        color = COALESCE(?, color),
        image = COALESCE(?, image),
        in_stock = COALESCE(?, in_stock),
        stock_quantity = COALESCE(?, stock_quantity),
        reorder_level = COALESCE(?, reorder_level),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    update.run(
      targetId,
      category !== undefined ? category : null,
      name !== undefined ? name : null,
      fullName !== undefined ? fullName : null,
      variety !== undefined ? variety : null,
      region !== undefined ? region : null,
      denomination !== undefined ? denomination : null,
      type !== undefined ? type : null,
      volume !== undefined ? volume : null,
      container !== undefined ? container : null,
      special !== undefined ? special : null,
      description !== undefined ? description : null,
      tags !== undefined ? JSON.stringify(Array.isArray(tags) ? tags : [tags]) : null,
      price !== undefined ? parseFloat(price) : null,
      icon !== undefined ? icon : null,
      color !== undefined ? color : null,
      image !== undefined ? image : null,
      in_stock !== undefined ? (in_stock ? 1 : 0) : null,
      stock_quantity !== undefined ? parseInt(stock_quantity, 10) : null,
      reorder_level !== undefined ? parseInt(reorder_level, 10) : null,
      req.params.id
    );

    // Automatically synchronize seed-data.js with the updated database
    try {
      syncSeedDataFile();
    } catch (syncErr) {
      console.error('Warning: Failed to auto-sync seed-data.js after product update:', syncErr);
    }

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(targetId);
    updated.tags = JSON.parse(updated.tags);

    res.json({ message: 'Product updated successfully and seed-data.js synchronized', product: updated });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update product: ' + err.message });
  }
});

// PATCH /api/products/:id/toggle-stock (Admin only)
router.patch('/:id/toggle-stock', authenticate, requireRole('admin'), (req, res) => {
  try {
    const product = db.prepare('SELECT id, in_stock, stock_quantity FROM products WHERE id = ?').get(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const newInStock = product.in_stock ? 0 : 1;
    db.prepare('UPDATE products SET in_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newInStock, req.params.id);

    try {
      syncSeedDataFile();
    } catch (syncErr) {
      console.error('Warning: Failed to auto-sync seed-data.js after stock toggle:', syncErr);
    }

    res.json({
      message: `Product is now ${newInStock ? 'In Stock' : 'Out of Stock'}`,
      id: req.params.id,
      in_stock: newInStock
    });
  } catch (err) {
    console.error('Toggle stock error:', err);
    res.status(500).json({ error: 'Failed to toggle stock status' });
  }
});

// DELETE /api/products/:id (Admin only)
router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  try {
    const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Automatically synchronize seed-data.js with the updated database
    try {
      syncSeedDataFile();
    } catch (syncErr) {
      console.error('Warning: Failed to auto-sync seed-data.js after product deletion:', syncErr);
    }

    res.json({ message: 'Product deleted successfully and seed-data.js synchronized', id: req.params.id });
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

module.exports = router;

