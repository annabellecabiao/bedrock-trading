const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/register (Registers a viewer user by default)
router.post('/register', (req, res) => {
  try {
    const { username, email, password, full_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Check if username or email already exists
    const existing = db.prepare('SELECT id, username, email FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) {
      if (existing.email.toLowerCase() === email.toLowerCase()) {
        return res.status(400).json({ error: 'Email is already registered.' });
      }
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const role = 'viewer'; // Default public registration is always 'viewer'

    const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, full_name)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(username.trim(), email.trim().toLowerCase(), passwordHash, role, (full_name || username).trim());

    const user = {
      id: result.lastInsertRowid,
      username: username.trim(),
      email: email.trim().toLowerCase(),
      role,
      full_name: (full_name || username).trim()
    };

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

    res.status(201).json({
      message: 'Account created successfully!',
      token,
      user
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error while creating account.' });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { login, password } = req.body; // Can be email or username
    if (!login || !password) {
      return res.status(400).json({ error: 'Login identifier (email or username) and password are required.' });
    }

    const user = db.prepare(`
      SELECT id, username, email, password_hash, role, full_name
      FROM users
      WHERE email = ? OR username = ?
    `).get(login.trim().toLowerCase(), login.trim());

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials. User not found.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials. Incorrect password.' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

    res.json({
      message: 'Logged in successfully!',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        full_name: user.full_name
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// GET /api/auth/me (Returns logged in user)
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/profile
router.put('/profile', authenticate, (req, res) => {
  try {
    const { full_name, email } = req.body;
    const updates = [];
    const params = [];

    if (full_name) {
      updates.push('full_name = ?');
      params.push(full_name.trim());
    }

    if (email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), req.user.id);
      if (existing) {
        return res.status(400).json({ error: 'Email is already used by another account.' });
      }
      updates.push('email = ?');
      params.push(email.trim().toLowerCase());
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided to update.' });
    }

    params.push(req.user.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT id, username, email, role, full_name, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ message: 'Profile updated successfully', user: updated });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Error updating profile.' });
  }
});

module.exports = router;
