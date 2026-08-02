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

app.use(cors({
  origin: [
    'https://study-group-finder-theta-three.vercel.app',
    'https://study-group-finder.netlify.app',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  credentials: true
}));

app.use(express.json());

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
