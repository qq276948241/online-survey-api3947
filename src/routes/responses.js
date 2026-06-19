const express = require('express');
const db = require('../config/database');
const { generateRespondentHash, getClientIp } = require('../utils/respondent');

const router = express.Router();

router.get('/:shareToken', (req, res) => {
  const { shareToken } = req.params;

  const survey = db.prepare('SELECT * FROM surveys WHERE share_token = ?').get(shareToken);

  if (!survey) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  if (survey.status !== 'published') {
    return res.status(403).json({ error: '问卷未发布或已关闭' });
  }

  const questions = db.prepare(`
    SELECT * FROM questions 
    WHERE survey_id = ? 
    ORDER BY sort_order ASC, id ASC
  `).all(survey.id);

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

  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const respondentHash = generateRespondentHash(ip, userAgent);

  const existingResponse = db.prepare(
    'SELECT id FROM responses WHERE survey_id = ? AND respondent_hash = ?'
  ).get(survey.id, respondentHash);

  res.json({
    id: survey.id,
    title: survey.title,
    description: survey.description,
    questions,
    already_responded: !!existingResponse,
    is_one_per_person: !!survey.is_one_per_person
  });
});

router.post('/:shareToken/submit', (req, res) => {
  const { shareToken } = req.params;
  const { answers } = req.body;

  const survey = db.prepare('SELECT * FROM surveys WHERE share_token = ?').get(shareToken);

  if (!survey) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  if (survey.status !== 'published') {
    return res.status(403).json({ error: '问卷未发布或已关闭' });
  }

  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const respondentHash = generateRespondentHash(ip, userAgent);

  if (survey.is_one_per_person) {
    const existingResponse = db.prepare(
      'SELECT id FROM responses WHERE survey_id = ? AND respondent_hash = ?'
    ).get(survey.id, respondentHash);

    if (existingResponse) {
      return res.status(409).json({ error: '您已经提交过答卷了' });
    }
  }

  const questions = db.prepare(
    'SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(survey.id);

  const questionMap = {};
  for (const q of questions) {
    questionMap[q.id] = q;
  }

  for (const q of questions) {
    if (q.required) {
      const answer = answers && answers[String(q.id)];
      if (answer === undefined || answer === null || answer === '') {
        return res.status(400).json({ error: `第${q.sort_order + 1}题为必答题` });
      }
      if (q.type === 'multiple' && Array.isArray(answer) && answer.length === 0) {
        return res.status(400).json({ error: `第${q.sort_order + 1}题为必答题` });
      }
    }
  }

  const insertResponse = db.prepare(`
    INSERT INTO responses (survey_id, respondent_hash, ip_address, user_agent)
    VALUES (?, ?, ?, ?)
  `);

  const insertAnswer = db.prepare(`
    INSERT INTO answers (response_id, question_id, answer_text, answer_value)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const result = insertResponse.run(survey.id, respondentHash, ip, userAgent);
    const responseId = result.lastInsertRowid;

    for (const questionIdStr in answers) {
      const questionId = parseInt(questionIdStr);
      const question = questionMap[questionId];
      if (!question) continue;

      const answer = answers[questionIdStr];

      if (question.type === 'multiple') {
        const values = Array.isArray(answer) ? answer : [answer];
        for (const val of values) {
          insertAnswer.run(responseId, questionId, String(val), String(val));
        }
      } else if (question.type === 'single' || question.type === 'scale') {
        insertAnswer.run(responseId, questionId, String(answer), String(answer));
      } else if (question.type === 'text') {
        insertAnswer.run(responseId, questionId, String(answer || ''), answer ? String(answer) : '');
      }
    }

    return responseId;
  });

  try {
    const responseId = transaction();
    res.status(201).json({ success: true, response_id: responseId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '提交失败，请稍后重试' });
  }
});

module.exports = router;
