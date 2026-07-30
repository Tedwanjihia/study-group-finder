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

    if (unit_ids && Array.isArray(unit_ids) && unit_ids.length > 0) {
      const inserts = unit_ids.map(uid =>
        pool.query('INSERT INTO user_units (user_id, unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [result.rows[0].id, uid])
      );
      await Promise.all(inserts);
    }

    res.status(201).json({ message: 'Account created successfully.', user: result.rows[0] });
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
      { id: user.id, name: user.name, email: user.email, is_admin: user.is_admin },
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

module.exports = router;