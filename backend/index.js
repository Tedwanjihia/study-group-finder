const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const notifRoutes = require('./routes/notifications');
const unitRoutes = require('./routes/units');
const adminRoutes = require('./routes/admin');
const profileRoutes = require('./routes/profile');
const peopleRoutes = require('./routes/people');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/test-auth', require('./middleware/authMiddleware'), (req, res) => {
  res.json({ message: 'Auth works', user: req.user });
});

app.get('/test-db', require('./middleware/authMiddleware'), async (req, res) => {
  const pool = require('./models/db');
  try {
    const result = await pool.query('SELECT id, name FROM study_groups LIMIT 3');
    res.json({ groups: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/test-groups', require('./middleware/authMiddleware'), async (req, res) => {
  const pool = require('./models/db');
  try {
    const result = await pool.query(`
      SELECT sg.id, sg.name, cu.code as unit_code
      FROM study_groups sg
      JOIN course_units cu ON cu.id = sg.unit_id
      WHERE sg.is_active = true
      LIMIT 5
    `);
    res.json({ groups: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/auth', authRoutes);
app.use('/groups', groupRoutes);
app.use('/notifications', notifRoutes);
app.use('/units', unitRoutes);
app.use('/admin', adminRoutes);
app.use('/profile', profileRoutes);
app.use('/people', peopleRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Study Group Finder API is running' });
});

app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// Keep server awake by pinging itself every 10 minutes
const https = require('https');
setInterval(() => {
  https.get('https://study-group-finder-api.onrender.com/ping', (res) => {
    console.log('Self-ping status:', res.statusCode);
  }).on('error', (e) => {
    console.log('Self-ping error:', e.message);
  });
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
