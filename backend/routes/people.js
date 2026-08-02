const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const auth = require('../middleware/authMiddleware');

router.get('/search', auth, async (req, res) => {
  const { q, unit } = req.query;
  try {
    let query = `
      SELECT DISTINCT u.id, u.name, u.programme, u.year_of_study,
        ARRAY_AGG(DISTINCT cu.code) FILTER (WHERE cu.code IS NOT NULL) as units
      FROM users u
      LEFT JOIN user_units uu ON uu.user_id = u.id
      LEFT JOIN course_units cu ON cu.id = uu.unit_id
      WHERE u.id != $1 AND u.is_admin = false
    `;
    const params = [req.user.id];

    if (q) {
      params.push('%' + q.toLowerCase() + '%');
      query += ' AND LOWER(u.name) LIKE $' + params.length;
    }

    if (unit) {
      params.push(unit);
      query += ` AND u.id IN (
        SELECT uu2.user_id FROM user_units uu2
        JOIN course_units cu2 ON cu2.id = uu2.unit_id
        WHERE cu2.code = $${params.length}
      )`;
    }

    query += ' GROUP BY u.id, u.name, u.programme, u.year_of_study ORDER BY u.name ASC LIMIT 30';

    const result = await pool.query(query, params);

    // Get current user's units to find shared ones
    const myUnitsRes = await pool.query(
      'SELECT cu.code FROM course_units cu JOIN user_units uu ON uu.unit_id = cu.id WHERE uu.user_id = $1',
      [req.user.id]
    );
    const myUnits = new Set(myUnitsRes.rows.map(r => r.code));

    const people = result.rows.map(p => ({
      ...p,
      units: p.units || [],
      shared_units: (p.units || []).filter(u => myUnits.has(u))
    }));

    res.json({ people });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;