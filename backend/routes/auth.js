const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../models/db');

router.post('/register', async (req, res) => {
  const { name, email, password, programme, year_of_study, unit_ids } = req.body;
  if (!name || !email || !password || !programme || !year_of_study) {
    return res.status(400).json({ message: 'All fields are required.' });
  }
  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'An account with that email already exists.' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash, programme, year_of_study) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, programme, year_of_study',
      [name, email, password_hash, programme, year_of_study]
    );
    const user = result.rows[0];

    // Save selected course units
    if (unit_ids && unit_ids.length > 0) {
      const unitInserts = unit_ids.map(uid =>
        pool.query('INSERT INTO user_units (user_id, unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.id, uid])
      );
      await Promise.all(unitInserts);
    }

    res.status(201).json({ message: 'Account created successfully.', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, is_admin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        programme: user.programme,
        year_of_study: user.year_of_study,
        is_admin: user.is_admin
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// Post a new message to a group (members only)
router.post('/:id/messages', auth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ message: 'Message cannot be empty.' });
  }
  try {
    const memberCheck = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    const isCreator = await pool.query(
      'SELECT 1 FROM study_groups WHERE id = $1 AND creator_id = $2',
      [req.params.id, req.user.id]
    );
    if (memberCheck.rows.length === 0 && isCreator.rows.length === 0) {
      return res.status(403).json({ message: 'You must be a member of this group to send messages.' });
    }

    const result = await pool.query(`
      INSERT INTO group_messages (group_id, user_id, message)
      VALUES ($1, $2, $3)
      RETURNING id, message, created_at
    `, [req.params.id, req.user.id, message.trim()]);

    const userRes = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);

    res.status(201).json({
      id: result.rows[0].id,
      message: result.rows[0].message,
      created_at: result.rows[0].created_at,
      user_id: req.user.id,
      name: userRes.rows[0]?.name || 'You'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;