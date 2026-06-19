const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { getQuestionsWithOptions, getSingleQuestionWithOptions } = require('../utils/surveyData');

const router = express.Router({ mergeParams: true });

const validTypes = ['single', 'multiple', 'text', 'scale'];

function checkSurveyOwnership(surveyId, userId) {
  const survey = db.prepare('SELECT id FROM surveys WHERE id = ? AND user_id = ?').get(surveyId, userId);
  return !!survey;
}

router.post('/', authMiddleware, (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const { type, title, description, required, sort_order, options, scale_min, scale_max, scale_min_label, scale_max_label } = req.body;

  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({ error: '题型无效，可选：single, multiple, text, scale' });
  }

  if (!title || title.trim() === '') {
    return res.status(400).json({ error: '题目标题不能为空' });
  }

  if (type === 'scale') {
    if (!scale_min || !scale_max) {
      return res.status(400).json({ error: '量表题需要设置最小和最大值' });
    }
    if (scale_min >= scale_max) {
      return res.status(400).json({ error: '量表最大值必须大于最小值' });
    }
  }

  const stmt = db.prepare(`
    INSERT INTO questions (survey_id, type, title, description, required, sort_order, scale_min, scale_max, scale_min_label, scale_max_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    surveyId,
    type,
    title.trim(),
    description || '',
    required ? 1 : 0,
    sort_order || 0,
    scale_min || null,
    scale_max || null,
    scale_min_label || '',
    scale_max_label || ''
  );

  const questionId = result.lastInsertRowid;

  if ((type === 'single' || type === 'multiple') && options && options.length > 0) {
    const optStmt = db.prepare(`
      INSERT INTO options (question_id, text, value, sort_order)
      VALUES (?, ?, ?, ?)
    `);

    const transaction = db.transaction((opts) => {
      opts.forEach((opt, index) => {
        optStmt.run(
          questionId,
          opt.text,
          opt.value || String(index + 1),
          opt.sort_order !== undefined ? opt.sort_order : index
        );
      });
    });

    transaction(options);
  }

  const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId);

  if (type === 'single' || type === 'multiple') {
    question.options = db.prepare(`
      SELECT id, text, value, sort_order 
      FROM options 
      WHERE question_id = ? 
      ORDER BY sort_order ASC, id ASC
    `).all(questionId);
  }

  res.status(201).json(question);
});

router.put('/:questionId', authMiddleware, (req, res) => {
  const { surveyId, questionId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const question = db.prepare('SELECT * FROM questions WHERE id = ? AND survey_id = ?').get(questionId, surveyId);

  if (!question) {
    return res.status(404).json({ error: '题目不存在' });
  }

  const { title, description, required, sort_order, options, scale_min, scale_max, scale_min_label, scale_max_label } = req.body;

  const stmt = db.prepare(`
    UPDATE questions 
    SET title = ?, description = ?, required = ?, sort_order = ?, 
        scale_min = ?, scale_max = ?, scale_min_label = ?, scale_max_label = ?
    WHERE id = ?
  `);

  stmt.run(
    title !== undefined ? title.trim() : question.title,
    description !== undefined ? description : question.description,
    required !== undefined ? (required ? 1 : 0) : question.required,
    sort_order !== undefined ? sort_order : question.sort_order,
    scale_min !== undefined ? scale_min : question.scale_min,
    scale_max !== undefined ? scale_max : question.scale_max,
    scale_min_label !== undefined ? scale_min_label : question.scale_min_label,
    scale_max_label !== undefined ? scale_max_label : question.scale_max_label,
    questionId
  );

  if (options && Array.isArray(options)) {
    db.prepare('DELETE FROM options WHERE question_id = ?').run(questionId);

    if (options.length > 0) {
      const optStmt = db.prepare(`
        INSERT INTO options (question_id, text, value, sort_order)
        VALUES (?, ?, ?, ?)
      `);

      const transaction = db.transaction((opts) => {
        opts.forEach((opt, index) => {
          optStmt.run(
            questionId,
            opt.text,
            opt.value || String(index + 1),
            opt.sort_order !== undefined ? opt.sort_order : index
          );
        });
      });

      transaction(options);
    }
  }

  const updated = getSingleQuestionWithOptions(questionId);

  res.json(updated);
});

router.delete('/:questionId', authMiddleware, (req, res) => {
  const { surveyId, questionId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const question = db.prepare('SELECT id FROM questions WHERE id = ? AND survey_id = ?').get(questionId, surveyId);

  if (!question) {
    return res.status(404).json({ error: '题目不存在' });
  }

  db.prepare('DELETE FROM questions WHERE id = ?').run(questionId);
  res.json({ message: '删除成功' });
});

router.get('/', authMiddleware, (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const questions = getQuestionsWithOptions(surveyId);

  res.json(questions);
});

module.exports = router;
