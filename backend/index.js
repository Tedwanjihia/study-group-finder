
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const notifRoutes = require('./routes/notifications');
const unitRoutes = require('./routes/units');
const adminRoutes = require('./routes/admin');
const profileRoutes = require('./routes/profile');
const createGroupRoutes = require('./routes/groups');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
  if (!token) {
    return next(new Error('Authentication error'));
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
    if (err) return next(new Error('Authentication error'));
    socket.user = payload;
    next();
  });
});

app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/groups', createGroupRoutes(io));
app.use('/notifications', notifRoutes);
app.use('/units', unitRoutes);
app.use('/admin', adminRoutes);
app.use('/profile', profileRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'Study Group Finder API is running' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});
