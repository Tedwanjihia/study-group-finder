const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const auth = require('../middleware/authMiddleware');
const bcrypt = require('bcrypt');

router.patch('/', auth, async (req, res) => {
  const { name, programme, year_of_study } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required.' });
  try {
    const result = await pool.query(
      'UPDATE users SET name = $1, programme = $2, year_of_study = $3 WHERE id = $4 RETURNING id, name, email, programme, year_of_study, is_admin',
      [name, programme, year_of_study, req.user.id]
    );
    res.json({ message: 'Profile updated.', user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.get('/units', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT cu.* FROM course_units cu JOIN user_units uu ON uu.unit_id = cu.id WHERE uu.user_id = $1 ORDER BY cu.code',
      [req.user.id]
    );
    res.json({ units: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.put('/units', auth, async (req, res) => {
  const { unit_ids } = req.body;
  try {
    await pool.query('DELETE FROM user_units WHERE user_id = $1', [req.user.id]);
    if (unit_ids && unit_ids.length > 0) {
      const inserts = unit_ids.map(uid =>
        pool.query('INSERT INTO user_units (user_id, unit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, uid])
      );
      await Promise.all(inserts);
    }
    res.json({ message: 'Units updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.patch('/password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ message: 'Both fields are required.' });
  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    const match = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!match) return res.status(401).json({ message: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;