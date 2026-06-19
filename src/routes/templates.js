const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');
const { getQuestionsWithOptions, getTemplateQuestionsWithOptions } = require('../utils/surveyData');

const router = express.Router();

router.post('/from-survey/:surveyId', authMiddleware, (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;
  const { title } = req.body;

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ? AND user_id = ?').get(surveyId, userId);

  if (!survey) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const questions = getQuestionsWithOptions(surveyId);

  if (questions.length === 0) {
    return res.status(400).json({ error: '问卷没有题目，无法保存为模板' });
  }

  const templateTitle = title?.trim() || `${survey.title} (模板)`;

  const insertTemplate = db.prepare(`
    INSERT INTO survey_templates (user_id, title, description, is_one_per_person)
    VALUES (?, ?, ?, ?)
  `);

  const insertTplQuestion = db.prepare(`
    INSERT INTO template_questions (template_id, type, title, description, required, sort_order, scale_min, scale_max, scale_min_label, scale_max_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTplOption = db.prepare(`
    INSERT INTO template_options (question_id, text, value, sort_order)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const tplResult = insertTemplate.run(
      userId,
      templateTitle,
      survey.description || '',
      survey.is_one_per_person
    );
    const templateId = tplResult.lastInsertRowid;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sortOrder = Number.isFinite(q.sort_order) ? q.sort_order : i;
      const qResult = insertTplQuestion.run(
        templateId,
        q.type,
        q.title,
        q.description || '',
        q.required,
        sortOrder,
        q.scale_min,
        q.scale_max,
        q.scale_min_label,
        q.scale_max_label
      );
      const tplQuestionId = qResult.lastInsertRowid;

      if (q.options && q.options.length > 0) {
        for (const opt of q.options) {
          const optSortOrder = Number.isFinite(opt.sort_order) ? opt.sort_order : 0;
          insertTplOption.run(tplQuestionId, opt.text, opt.value, optSortOrder);
        }
      }
    }

    return templateId;
  });

  try {
    const templateId = transaction();
    const template = db.prepare('SELECT * FROM survey_templates WHERE id = ?').get(templateId);
    res.status(201).json(template);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '保存模板失败' });
  }
});

router.get('/', authMiddleware, (req, res) => {
  const userId = req.user.id;

  const templates = db.prepare(`
    SELECT st.*, 
           (SELECT COUNT(*) FROM template_questions WHERE template_id = st.id) as question_count
    FROM survey_templates st
    WHERE st.user_id = ?
    ORDER BY st.created_at DESC
  `).all(userId);

  res.json(templates);
});

router.get('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const template = db.prepare(
    'SELECT * FROM survey_templates WHERE id = ? AND user_id = ?'
  ).get(id, userId);

  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  const questions = getTemplateQuestionsWithOptions(id);

  template.questions = questions;
  res.json(template);
});

router.delete('/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const template = db.prepare(
    'SELECT id FROM survey_templates WHERE id = ? AND user_id = ?'
  ).get(id, userId);

  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  db.prepare('DELETE FROM survey_templates WHERE id = ?').run(id);
  res.json({ message: '删除成功' });
});

router.post('/:id/create-survey', authMiddleware, (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { title, description, time_limit, is_one_per_person } = req.body;

  const template = db.prepare(
    'SELECT * FROM survey_templates WHERE id = ? AND user_id = ?'
  ).get(id, userId);

  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  const questions = getTemplateQuestionsWithOptions(id);

  if (questions.length === 0) {
    return res.status(400).json({ error: '模板没有题目' });
  }

  const surveyTitle = title?.trim() || template.title.replace(/\(模板\)$/, '').trim();
  const surveyDesc = description !== undefined ? description : template.description;
  const onePerPerson = is_one_per_person !== undefined ? (is_one_per_person ? 1 : 0) : template.is_one_per_person;
  const timeLimit = time_limit ? parseInt(time_limit) : 0;

  if (timeLimit < 0 || timeLimit > 300) {
    return res.status(400).json({ error: '答题时限需在 0-300 分钟之间，0 表示不限制' });
  }

  const shareToken = uuidv4().replace(/-/g, '').substring(0, 12);

  const insertSurvey = db.prepare(`
    INSERT INTO surveys (user_id, title, description, share_token, is_one_per_person, time_limit)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertQuestion = db.prepare(`
    INSERT INTO questions (survey_id, type, title, description, required, sort_order, scale_min, scale_max, scale_min_label, scale_max_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertOption = db.prepare(`
    INSERT INTO options (question_id, text, value, sort_order)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const sResult = insertSurvey.run(
      userId,
      surveyTitle,
      surveyDesc,
      shareToken,
      onePerPerson,
      timeLimit
    );
    const surveyId = sResult.lastInsertRowid;

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const sortOrder = Number.isFinite(q.sort_order) ? q.sort_order : i;
      const qResult = insertQuestion.run(
        surveyId,
        q.type,
        q.title,
        q.description,
        q.required,
        sortOrder,
        q.scale_min,
        q.scale_max,
        q.scale_min_label,
        q.scale_max_label
      );
      const questionId = qResult.lastInsertRowid;

      if (q.options && q.options.length > 0) {
        for (const opt of q.options) {
          const optSortOrder = Number.isFinite(opt.sort_order) ? opt.sort_order : 0;
          insertOption.run(questionId, opt.text, opt.value, optSortOrder);
        }
      }
    }

    return surveyId;
  });

  try {
    const surveyId = transaction();
    const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
    res.status(201).json(survey);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '从模板创建问卷失败' });
  }
});

module.exports = router;
