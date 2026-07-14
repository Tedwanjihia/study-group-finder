
const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const auth = require('../middleware/authMiddleware');

router.get('/my', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sg.*, cu.code as unit_code, cu.name as unit_name,
        COUNT(gm2.user_id) as member_count
      FROM study_groups sg
      JOIN group_members gm ON gm.group_id = sg.id AND gm.user_id = $1
      JOIN course_units cu ON cu.id = sg.unit_id
      LEFT JOIN group_members gm2 ON gm2.group_id = sg.id
      WHERE sg.is_active = true
      GROUP BY sg.id, cu.code, cu.name
      ORDER BY sg.created_at DESC
    `, [req.user.id]);
    res.json({ groups: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.get('/', auth, async (req, res) => {
  const { unit } = req.query;
  try {
    let query = `
      SELECT sg.*, cu.code as unit_code, cu.name as unit_name,
        COUNT(gm.user_id) as member_count
      FROM study_groups sg
      JOIN course_units cu ON cu.id = sg.unit_id
      LEFT JOIN group_members gm ON gm.group_id = sg.id
      WHERE sg.is_active = true
    `;
    const params = [];
    if (unit) {
      params.push(unit);
      query += ' AND cu.code = $' + params.length;
    }
    query += ' GROUP BY sg.id, cu.code, cu.name ORDER BY sg.created_at DESC';
    const result = await pool.query(query, params);
    res.json({ groups: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.post('/', auth, async (req, res) => {
  const { name, unit_id, max_members, schedule, venue } = req.body;
  if (!name || !unit_id) return res.status(400).json({ message: 'Name and unit are required.' });
  try {
    const result = await pool.query(
      'INSERT INTO study_groups (name, unit_id, creator_id, max_members, schedule, venue) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, unit_id, req.user.id, max_members || 5, schedule, venue]
    );
    const group = result.rows[0];
    await pool.query(
      'INSERT INTO group_members (group_id, user_id, status) VALUES ($1, $2, $3)',
      [group.id, req.user.id, 'approved']
    );
    res.status(201).json({ message: 'Group created.', group });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

router.post('/:id/join', auth, async (req, res) => {
  const groupId = req.params.id;
  try {
    const group = await pool.query(
      'SELECT sg.*, COUNT(gm.user_id) as member_count FROM study_groups sg LEFT JOIN group_members gm ON gm.group_id = sg.id WHERE sg.id = $1 GROUP BY sg.id',
      [groupId]
    );
    if (group.rows.length === 0) return res.status(404).json({ message: 'Group not found.' });
    const g = group.rows[0];
    if (parseInt(g.member_count) >= g.max_members) return res.status(400).json({ message: 'Group is full.' });
    const existing = await pool.query(
      'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, req.user.id]
    );
    if (existing.rows.length > 0) return res.status(409).json({ message: 'Already a member.' });
    await pool.query(
      'INSERT INTO group_members (group_id, user_id, status) VALUES ($1, $2, $3)',
      [groupId, req.user.id, 'approved']
    );
    await pool.query(
      'INSERT INTO notifications (user_id, message) VALUES ($1, $2)',
      [g.creator_id, 'A new member joined your group ' + g.name]
    );
    res.json({ message: 'Joined successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});


module.exports = router;
