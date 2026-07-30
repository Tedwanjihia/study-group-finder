const express = require('express');
const pool = require('../models/db');
const auth = require('../middleware/authMiddleware');

module.exports = function(io) {
  const router = express.Router();

  async function notifyUser(userId, message) {
    try {
      await pool.query(
        'INSERT INTO notifications (user_id, message) VALUES ($1, $2)',
        [userId, message]
      );
    } catch (err) {
      console.error('Failed to create notification:', err);
    }
  }

  io.on('connection', socket => {
    socket.on('joinGroupRoom', async groupId => {
      if (!groupId) return;
      socket.join(`group_${groupId}`);
    });

    socket.on('leaveGroupRoom', groupId => {
      if (!groupId) return;
      socket.leave(`group_${groupId}`);
    });

    socket.on('groupMessage', async ({ groupId, message }, callback) => {
      try {
        if (!groupId || !message || !message.trim()) {
          return callback?.({ status: 'error', message: 'Message cannot be empty.' });
        }

        const memberCheck = await pool.query(
          'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
          [groupId, socket.user.id, 'approved']
        );
        const isCreator = await pool.query(
          'SELECT 1 FROM study_groups WHERE id = $1 AND creator_id = $2',
          [groupId, socket.user.id]
        );
        if (memberCheck.rows.length === 0 && isCreator.rows.length === 0) {
          return callback?.({ status: 'error', message: 'You must be a group member to send messages.' });
        }

        const result = await pool.query(
          'INSERT INTO group_messages (group_id, user_id, message) VALUES ($1, $2, $3) RETURNING id, message, created_at',
          [groupId, socket.user.id, message.trim()]
        );

        const messagePayload = {
          id: result.rows[0].id,
          message: result.rows[0].message,
          created_at: result.rows[0].created_at,
          user_id: socket.user.id,
          name: socket.user.name
        };

        io.to(`group_${groupId}`).emit('groupMessage', messagePayload);
        callback?.({ status: 'ok', message: 'Message sent.', data: messagePayload });
      } catch (err) {
        console.error('Socket message error:', err);
        callback?.({ status: 'error', message: 'Failed to send message.' });
      }
    });
  });

  router.get('/my', auth, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT sg.*, cu.code as unit_code, cu.name as unit_name,
        COUNT(DISTINCT gm.user_id) as member_count,
        ROUND(AVG(gr.rating)::numeric, 1) as avg_rating,
        COUNT(DISTINCT gr.id) as review_count
      FROM study_groups sg
      JOIN course_units cu ON cu.id = sg.unit_id
      JOIN group_members gm ON gm.group_id = sg.id AND gm.user_id = $1 AND gm.status = 'approved'
      LEFT JOIN group_reviews gr ON gr.group_id = sg.id
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
          COUNT(CASE WHEN gm.status = 'approved' THEN 1 END) as member_count
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
        `SELECT sg.*, COUNT(CASE WHEN gm.status = 'approved' THEN 1 END) as member_count
         FROM study_groups sg
         LEFT JOIN group_members gm ON gm.group_id = sg.id
         WHERE sg.id = $1
         GROUP BY sg.id`,
        [groupId]
      );
      if (group.rows.length === 0) return res.status(404).json({ message: 'Group not found.' });
      const g = group.rows[0];
      if (parseInt(g.member_count) >= g.max_members) return res.status(400).json({ message: 'Group is full.' });
      const existing = await pool.query(
        'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, req.user.id]
      );
      if (existing.rows.length > 0) {
        const status = existing.rows[0].status;
        if (status === 'approved') {
          return res.status(409).json({ message: 'You are already a member of this group.' });
        }
        return res.status(409).json({ message: 'Your request is already pending.' });
      }
      await pool.query(
        'INSERT INTO group_members (group_id, user_id, status) VALUES ($1, $2, $3)',
        [groupId, req.user.id, 'pending']
      );
      await notifyUser(g.creator_id, `${req.user.name} requested to join your group ${g.name}.`);
      res.json({ message: 'Join request sent. Waiting for approval.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  router.get('/:id/requests', auth, async (req, res) => {
    const groupId = req.params.id;
    try {
      const groupRes = await pool.query('SELECT creator_id FROM study_groups WHERE id = $1', [groupId]);
      if (groupRes.rows.length === 0) return res.status(404).json({ message: 'Group not found.' });
      if (groupRes.rows[0].creator_id !== req.user.id) {
        return res.status(403).json({ message: 'Only the group owner can view join requests.' });
      }
      const requestsRes = await pool.query(`
        SELECT gm.id, gm.user_id, gm.created_at, u.name, u.programme, u.year_of_study
        FROM group_members gm
        JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = $1 AND gm.status = 'pending'
        ORDER BY gm.created_at ASC
      `, [groupId]);
      res.json({ requests: requestsRes.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  router.post('/:id/requests/:requestId/approve', auth, async (req, res) => {
    const groupId = req.params.id;
    const requestId = req.params.requestId;
    try {
      const groupRes = await pool.query('SELECT creator_id, name, max_members FROM study_groups WHERE id = $1', [groupId]);
      if (groupRes.rows.length === 0) return res.status(404).json({ message: 'Group not found.' });
      if (groupRes.rows[0].creator_id !== req.user.id) {
        return res.status(403).json({ message: 'Only the group owner can approve requests.' });
      }
      const existingRequest = await pool.query(
        'SELECT * FROM group_members WHERE id = $1 AND group_id = $2 AND status = $3',
        [requestId, groupId, 'pending']
      );
      if (existingRequest.rows.length === 0) return res.status(404).json({ message: 'Join request not found.' });
      const approvedCount = await pool.query(
        "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND status = 'approved'",
        [groupId]
      );
      if (parseInt(approvedCount.rows[0].count) >= groupRes.rows[0].max_members) {
        return res.status(400).json({ message: 'Group is already full.' });
      }
      await pool.query('UPDATE group_members SET status = $1 WHERE id = $2', ['approved', requestId]);
      await notifyUser(existingRequest.rows[0].user_id, `Your request to join ${groupRes.rows[0].name} has been approved.`);
      res.json({ message: 'Join request approved.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  router.post('/:id/requests/:requestId/reject', auth, async (req, res) => {
    const groupId = req.params.id;
    const requestId = req.params.requestId;
    try {
      const groupRes = await pool.query('SELECT creator_id, name FROM study_groups WHERE id = $1', [groupId]);
      if (groupRes.rows.length === 0) return res.status(404).json({ message: 'Group not found.' });
      if (groupRes.rows[0].creator_id !== req.user.id) {
        return res.status(403).json({ message: 'Only the group owner can reject requests.' });
      }
      const existingRequest = await pool.query(
        'SELECT * FROM group_members WHERE id = $1 AND group_id = $2 AND status = $3',
        [requestId, groupId, 'pending']
      );
      if (existingRequest.rows.length === 0) return res.status(404).json({ message: 'Join request not found.' });
      await pool.query('DELETE FROM group_members WHERE id = $1', [requestId]);
      await notifyUser(existingRequest.rows[0].user_id, `Your request to join ${groupRes.rows[0].name} was declined.`);
      res.json({ message: 'Join request rejected.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  router.delete('/:id/leave', auth, async (req, res) => {
    const groupId = req.params.id;
    try {
      const group = await pool.query('SELECT creator_id FROM study_groups WHERE id = $1', [groupId]);
      if (group.rows.length === 0) return res.status(404).json({ message: 'Group not found.' });
      if (group.rows[0].creator_id === req.user.id) {
        return res.status(400).json({ message: 'You cannot leave a group you created. Deactivate it instead.' });
      }
      await pool.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, req.user.id]);
      res.json({ message: 'You have left the group.' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  router.get('/:id', auth, async (req, res) => {
    try {
      const groupRes = await pool.query(`
        SELECT sg.*, cu.code as unit_code, cu.name as unit_name,
          COUNT(CASE WHEN gm.status = 'approved' THEN 1 END) as member_count,
          COUNT(CASE WHEN gm.status = 'pending' THEN 1 END) as pending_count,
          ROUND(AVG(gr.rating)::numeric, 1) as avg_rating,
          COUNT(DISTINCT gr.id) as review_count,
          EXISTS(SELECT 1 FROM group_members WHERE group_id = sg.id AND user_id = $2 AND status = 'approved') as is_member,
          EXISTS(SELECT 1 FROM group_members WHERE group_id = sg.id AND user_id = $2 AND status = 'pending') as has_pending_request,
          EXISTS(SELECT 1 FROM study_groups WHERE id = sg.id AND creator_id = $2) as is_creator
        FROM study_groups sg
        JOIN course_units cu ON cu.id = sg.unit_id
        LEFT JOIN group_members gm ON gm.group_id = sg.id
        LEFT JOIN group_reviews gr ON gr.group_id = sg.id
        WHERE sg.id = $1
        GROUP BY sg.id, cu.code, cu.name
      `, [req.params.id, req.user.id]);

      if (groupRes.rows.length === 0) return res.status(404).json({ message: 'Group not found.' });

      const membersRes = await pool.query(`
        SELECT u.id, u.name, u.programme, u.year_of_study
        FROM users u
        JOIN group_members gm ON gm.user_id = u.id
        WHERE gm.group_id = $1 AND gm.status = 'approved'
        ORDER BY gm.joined_at ASC
      `, [req.params.id]);

      res.json({ group: groupRes.rows[0], members: membersRes.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  router.get('/:id/messages', auth, async (req, res) => {
    try {
      const memberCheck = await pool.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
        [req.params.id, req.user.id, 'approved']
      );
      const isCreator = await pool.query(
        'SELECT 1 FROM study_groups WHERE id = $1 AND creator_id = $2',
        [req.params.id, req.user.id]
      );
      if (memberCheck.rows.length === 0 && isCreator.rows.length === 0) {
        return res.status(403).json({ message: 'You must be a member of this group to view messages.' });
      }

      const result = await pool.query(`
        SELECT gm.id, gm.message, gm.created_at, u.id as user_id, u.name
        FROM group_messages gm
        JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = $1
        ORDER BY gm.created_at ASC
      `, [req.params.id]);

      res.json({ messages: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  router.post('/:id/messages', auth, async (req, res) => {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message cannot be empty.' });
    }
    try {
      const memberCheck = await pool.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
        [req.params.id, req.user.id, 'approved']
      );
      const isCreator = await pool.query(
        'SELECT 1 FROM study_groups WHERE id = $1 AND creator_id = $2',
        [req.params.id, req.user.id]
      );
      if (memberCheck.rows.length === 0 && isCreator.rows.length === 0) {
        return res.status(403).json({ message: 'You must be a member of this group to send messages.' });
      }

      const result = await pool.query(`
        INSERT INTO group_messages (group_id, user_id, message)
        VALUES ($1, $2, $3)
        RETURNING id, message, created_at
      `, [req.params.id, req.user.id, message.trim()]);

      const userRes = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
      const payload = {
        id: result.rows[0].id,
        message: result.rows[0].message,
        created_at: result.rows[0].created_at,
        user_id: req.user.id,
        name: userRes.rows[0]?.name || 'You'
      };
      io.to(`group_${req.params.id}`).emit('groupMessage', payload);

      res.status(201).json(payload);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  router.get('/:id/reviews', auth, async (req, res) => {
    try {
      const reviewsRes = await pool.query(`
        SELECT gr.id, gr.rating, gr.comment, gr.created_at, u.id as user_id, u.name
        FROM group_reviews gr
        JOIN users u ON u.id = gr.user_id
        WHERE gr.group_id = $1
        ORDER BY gr.created_at DESC
      `, [req.params.id]);

      const avgRes = await pool.query(`
        SELECT ROUND(AVG(rating)::numeric, 1) as avg_rating, COUNT(*) as review_count
        FROM group_reviews
        WHERE group_id = $1
      `, [req.params.id]);

      res.json({
        reviews: reviewsRes.rows,
        avg_rating: avgRes.rows[0].avg_rating || null,
        review_count: parseInt(avgRes.rows[0].review_count)
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  router.post('/:id/reviews', auth, async (req, res) => {
    const { rating, comment } = req.body;
    const groupId = req.params.id;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
    }

    try {
      const memberCheck = await pool.query(
        'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND status = $3',
        [groupId, req.user.id, 'approved']
      );
      const isCreator = await pool.query(
        'SELECT 1 FROM study_groups WHERE id = $1 AND creator_id = $2',
        [groupId, req.user.id]
      );
      if (memberCheck.rows.length === 0 && isCreator.rows.length === 0) {
        return res.status(403).json({ message: 'You must be a member of this group to leave a review.' });
      }

      const result = await pool.query(`
        INSERT INTO group_reviews (group_id, user_id, rating, comment)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (group_id, user_id)
        DO UPDATE SET rating = $3, comment = $4, created_at = NOW()
        RETURNING id, rating, comment, created_at
      `, [groupId, req.user.id, rating, comment || null]);

      res.status(201).json({
        message: 'Review saved.',
        id: result.rows[0].id,
        rating: result.rows[0].rating,
        comment: result.rows[0].comment,
        created_at: result.rows[0].created_at,
        user_id: req.user.id,
        name: req.user.name
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Server error.' });
    }
  });

  return router;
};