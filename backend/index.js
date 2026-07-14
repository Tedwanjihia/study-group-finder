
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const groupRoutes = require('./routes/groups');
const notifRoutes = require('./routes/notifications');
const unitRoutes = require('./routes/units');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/groups', groupRoutes);
app.use('/notifications', notifRoutes);
app.use('/units', unitRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Study Group Finder API is running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});