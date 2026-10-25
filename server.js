require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db/database');
const { authenticate, requireRole } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const leadRoutes = require('./routes/leads');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/users');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Liveness & Readiness probe for Docker & Azure
app.get('/health', (req, res) => {
  try {
    // Quick DB check
    const check = db.prepare('SELECT 1 as alive').get();
    res.json({
      status: 'UP',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: check.alive === 1 ? 'healthy' : 'unknown'
    });
  } catch (err) {
    res.status(500).json({ status: 'DOWN', error: err.message });
  }
});

// Admin stats overview endpoint
app.get('/api/stats', authenticate, requireRole('admin'), (req, res) => {
  try {
    const productsCount = db.prepare('SELECT COUNT(*) as count FROM products').get().count;
    const leadsNewCount = db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'new'").get().count;
    const leadsTotalCount = db.prepare('SELECT COUNT(*) as count FROM leads').get().count;
    const ordersPendingCount = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count;
    const ordersTotalCount = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

    res.json({
      products: productsCount,
      leads: { new: leadsNewCount, total: leadsTotalCount },
      orders: { pending: ordersPendingCount, total: ordersTotalCount },
      users: usersCount
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reports', reportRoutes);

// Serve static frontend assets
app.use(express.static(path.join(__dirname)));

// Fallback for SPA routing if accessed directly
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Catch-all route for frontend HTML (Express 5 compatible)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'Internal server error: ' + err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` Bedrock Consumer Goods Trading Server is Running!`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` Health: http://localhost:${PORT}/health`);
  console.log(` Admin Portal: http://localhost:${PORT}/admin.html`);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`====================================================`);
});

module.exports = app;
