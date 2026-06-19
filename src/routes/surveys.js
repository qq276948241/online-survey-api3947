const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.post('/', authMiddleware, (req, res) => {
  const { title, description, is_one_per_person, time_limit } = req.body;
  const userId = req.user.id;

  if (!title || title.trim() === '') {
    return res.status(400).json({ error: '问卷标题不能为空' });
  }

  const timeLimit = time_limit ? parseInt(time_limit) : 0;
  if (timeLimit < 0 || timeLimit > 300) {
    return res.status(400).json({ error: '答题时限需在 0-300 分钟之间，0 表示不限制' });
  }

  const shareToken = uuidv4().replace(/-/g, '').substring(0, 12);

  const stmt = db.prepare(`
    INSERT INTO surveys (user_id, title, description, share_token, is_one_per_person, time_limit)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    userId,
    title.trim(),
    description || '',
    shareToken,
    is_one_per_person ? 1 : 1,
    timeLimit
  );

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(survey);
});

router.get('/', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { status } = req.query;

  let sql = 'SELECT * FROM surveys WHERE user_id = ?';
  const params = [userId];

  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC';

  const surveys = db.prepare(sql).all(...params);
  res.json(surveys);
});

router.get('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?').get(id, userId);

  if (!survey) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const questions = db.prepare(`
    SELECT * FROM questions 
    WHERE survey_id = ? 
    ORDER BY sort_order ASC, id ASC
  `).all(id);

  for (const q of questions) {
    if (q.type === 'single' || q.type === 'multiple') {
      q.options = db.prepare(`
        SELECT id, text, value, sort_order 
        FROM options 
        WHERE question_id = ? 
        ORDER BY sort_order ASC, id ASC
      `).all(q.id);
    }
  }

  survey.questions = questions;

  const responseCount = db.prepare(
    'SELECT COUNT(*) as count FROM responses WHERE survey_id = ?'
  ).get(id).count;

  survey.response_count = responseCount;

  res.json(survey);
});

router.put('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { title, description, is_one_per_person, time_limit } = req.body;

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?').get(id, userId);

  if (!survey) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  let timeLimit = survey.time_limit;
  if (time_limit !== undefined) {
    timeLimit = parseInt(time_limit) || 0;
    if (timeLimit < 0 || timeLimit > 300) {
      return res.status(400).json({ error: '答题时限需在 0-300 分钟之间，0 表示不限制' });
    }
  }

  const stmt = db.prepare(`
    UPDATE surveys 
    SET title = ?, description = ?, is_one_per_person = ?, time_limit = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(
    title || survey.title,
    description !== undefined ? description : survey.description,
    is_one_per_person !== undefined ? (is_one_per_person ? 1 : 0) : survey.is_one_per_person,
    timeLimit,
    id
  );

  const updated = db.prepare('SELECT * FROM surveys WHERE id = ?').get(id);
  res.json(updated);
});

router.delete('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?').get(id, userId);

  if (!survey) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  db.prepare('DELETE FROM surveys WHERE id = ?').run(id);
  res.json({ message: '删除成功' });
});

router.post('/:id/publish', authMiddleware, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?').get(id, userId);

  if (!survey) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const questionCount = db.prepare(
    'SELECT COUNT(*) as count FROM questions WHERE survey_id = ?'
  ).get(id).count;

  if (questionCount === 0) {
    return res.status(400).json({ error: '问卷至少需要一道题目才能发布' });
  }

  db.prepare("UPDATE surveys SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);

  const updated = db.prepare('SELECT * FROM surveys WHERE id = ?').get(id);
  res.json(updated);
});

router.post('/:id/close', authMiddleware, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?').get(id, userId);

  if (!survey) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  db.prepare("UPDATE surveys SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);

  const updated = db.prepare('SELECT * FROM surveys WHERE id = ?').get(id);
  res.json(updated);
});

module.exports = router;
