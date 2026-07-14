const express = require('express');
const router = express.Router();
const pool = require('../models/db');
const auth = require('../middleware/authMiddleware');

router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM course_units ORDER BY code');
    res.json({ units: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error.' });
  }
});

module.exports = router;