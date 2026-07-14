const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const auth = require('../middleware/authMiddleware');

const isAdmin = (req, res, next) => {
  if (!req.user.is_admin) return res.status(403).json({ message: 'Admin access required.' });
  next();
};

router.get('/stats', auth, isAdmin, async (req, res) => {
  try {
    const [users, groups, active, units] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM study_groups'),
      pool.query('SELECT COUNT(*) FROM study_groups WHERE is_active = true'),
      pool.query('SELECT COUNT(*) FROM course_units')
    ]);
    res.json({
      users: parseInt(users.rows[0].count),
      groups: parseInt(groups.rows[0].count),
      active_groups: parseInt(active.rows[0].count),
      units: parseInt(units.rows[0].count)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.get('/users', auth, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, programme, year_of_study, is_admin, created_at FROM users ORDER BY created_at DESC'
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.delete('/users/:id', auth, isAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: 'User removed.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.get('/groups', auth, isAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sg.*, cu.code as unit_code, cu.name as unit_name,
        COUNT(gm.user_id) as member_count
      FROM study_groups sg
      JOIN course_units cu ON cu.id = sg.unit_id
      LEFT JOIN group_members gm ON gm.group_id = sg.id
      GROUP BY sg.id, cu.code, cu.name
      ORDER BY sg.created_at DESC
    `);
    res.json({ groups: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.patch('/groups/:id/toggle', auth, isAdmin, async (req, res) => {
  try {
    await pool.query(
      'UPDATE study_groups SET is_active = NOT is_active WHERE id = $1',
      [req.params.id]
    );
    res.json({ message: 'Group updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;