const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

function checkSurveyOwnership(surveyId, userId) {
  const survey = db.prepare('SELECT id FROM surveys WHERE id = ? AND user_id = ?').get(surveyId, userId);
  return !!survey;
}

router.get('/summary', authMiddleware, (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const totalResponses = db.prepare(
    'SELECT COUNT(*) as count FROM responses WHERE survey_id = ?'
  ).get(surveyId).count;

  const today = new Date().toISOString().split('T')[0];
  const todayResponses = db.prepare(`
    SELECT COUNT(*) as count FROM responses 
    WHERE survey_id = ? AND DATE(created_at) = ?
  `).get(surveyId, today).count;

  const last7Days = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count 
    FROM responses 
    WHERE survey_id = ? AND created_at >= date('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(surveyId);

  const questionCount = db.prepare(
    'SELECT COUNT(*) as count FROM questions WHERE survey_id = ?'
  ).get(surveyId).count;

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);

  res.json({
    total_responses: totalResponses,
    today_responses: todayResponses,
    last_7_days: last7Days,
    question_count: questionCount,
    status: survey.status,
    created_at: survey.created_at
  });
});

router.get('/question/:questionId', authMiddleware, (req, res) => {
  const { surveyId, questionId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const question = db.prepare(
    'SELECT * FROM questions WHERE id = ? AND survey_id = ?'
  ).get(questionId, surveyId);

  if (!question) {
    return res.status(404).json({ error: '题目不存在' });
  }

  const totalResponses = db.prepare(
    'SELECT COUNT(DISTINCT response_id) as count FROM answers WHERE question_id = ?'
  ).get(questionId).count;

  if (question.type === 'single') {
    const stats = db.prepare(`
      SELECT answer_value as value, answer_text as text, COUNT(*) as count
      FROM answers
      WHERE question_id = ?
      GROUP BY answer_value
      ORDER BY count DESC
    `).all(questionId);

    const options = db.prepare('SELECT * FROM options WHERE question_id = ? ORDER BY sort_order ASC').all(questionId);
    const optionMap = {};
    for (const opt of options) {
      optionMap[opt.value] = opt.text;
    }

    const enrichedStats = stats.map(s => ({
      value: s.value,
      text: optionMap[s.value] || s.text,
      count: s.count,
      percentage: totalResponses > 0 ? (s.count / totalResponses * 100).toFixed(2) : 0
    }));

    res.json({
      question,
      total_responses: totalResponses,
      stats: enrichedStats
    });

  } else if (question.type === 'multiple') {
    const stats = db.prepare(`
      SELECT answer_value as value, answer_text as text, COUNT(*) as count
      FROM answers
      WHERE question_id = ?
      GROUP BY answer_value
      ORDER BY count DESC
    `).all(questionId);

    const options = db.prepare('SELECT * FROM options WHERE question_id = ? ORDER BY sort_order ASC').all(questionId);
    const optionMap = {};
    for (const opt of options) {
      optionMap[opt.value] = opt.text;
    }

    const enrichedStats = stats.map(s => ({
      value: s.value,
      text: optionMap[s.value] || s.text,
      count: s.count,
      percentage: totalResponses > 0 ? (s.count / totalResponses * 100).toFixed(2) : 0
    }));

    res.json({
      question,
      total_responses: totalResponses,
      stats: enrichedStats
    });

  } else if (question.type === 'scale') {
    const stats = db.prepare(`
      SELECT answer_value as value, COUNT(*) as count
      FROM answers
      WHERE question_id = ?
      GROUP BY answer_value
      ORDER BY CAST(answer_value AS INTEGER) ASC
    `).all(questionId);

    const avgResult = db.prepare(`
      SELECT AVG(CAST(answer_value AS REAL)) as avg
      FROM answers
      WHERE question_id = ?
    `).get(questionId);

    const enrichedStats = stats.map(s => ({
      value: s.value,
      count: s.count,
      percentage: totalResponses > 0 ? (s.count / totalResponses * 100).toFixed(2) : 0
    }));

    res.json({
      question,
      total_responses: totalResponses,
      average: avgResult.avg ? parseFloat(avgResult.avg.toFixed(2)) : 0,
      stats: enrichedStats
    });

  } else if (question.type === 'text') {
    const answers = db.prepare(`
      SELECT answer_text, answer_value, response_id, 
             (SELECT created_at FROM responses WHERE id = answers.response_id) as created_at
      FROM answers
      WHERE question_id = ?
      ORDER BY id DESC
      LIMIT 100
    `).all(questionId);

    res.json({
      question,
      total_responses: totalResponses,
      answers
    });
  }
});

router.get('/crosstab', authMiddleware, (req, res) => {
  const { surveyId } = req.params;
  const { q1, q2 } = req.query;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  if (!q1 || !q2) {
    return res.status(400).json({ error: '请提供两个题目 ID: q1, q2' });
  }

  const question1 = db.prepare('SELECT * FROM questions WHERE id = ? AND survey_id = ?').get(q1, surveyId);
  const question2 = db.prepare('SELECT * FROM questions WHERE id = ? AND survey_id = ?').get(q2, surveyId);

  if (!question1 || !question2) {
    return res.status(404).json({ error: '题目不存在' });
  }

  if (question1.type === 'text' || question2.type === 'text') {
    return res.status(400).json({ error: '文本题不支持交叉分析' });
  }

  const answers1 = db.prepare(`
    SELECT response_id, answer_value
    FROM answers
    WHERE question_id = ?
  `).all(q1);

  const answers2 = db.prepare(`
    SELECT response_id, answer_value
    FROM answers
    WHERE question_id = ?
  `).all(q2);

  const map1 = {};
  for (const a of answers1) {
    if (!map1[a.response_id]) map1[a.response_id] = [];
    map1[a.response_id].push(a.answer_value);
  }

  const map2 = {};
  for (const a of answers2) {
    if (!map2[a.response_id]) map2[a.response_id] = [];
    map2[a.response_id].push(a.answer_value);
  }

  const allResponseIds = [...new Set([...Object.keys(map1), ...Object.keys(map2)])];

  const values1 = question1.type === 'scale'
    ? Array.from({ length: question1.scale_max - question1.scale_min + 1 }, (_, i) => String(question1.scale_min + i))
    : db.prepare('SELECT value FROM options WHERE question_id = ? ORDER BY sort_order ASC').all(q1).map(o => o.value);

  const values2 = question2.type === 'scale'
    ? Array.from({ length: question2.scale_max - question2.scale_min + 1 }, (_, i) => String(question2.scale_min + i))
    : db.prepare('SELECT value FROM options WHERE question_id = ? ORDER BY sort_order ASC').all(q2).map(o => o.value);

  const crosstab = {};
  const rowTotals = {};
  const colTotals = {};
  let grandTotal = 0;

  for (const v1 of values1) {
    crosstab[v1] = {};
    rowTotals[v1] = 0;
    for (const v2 of values2) {
      crosstab[v1][v2] = 0;
      if (!colTotals[v2]) colTotals[v2] = 0;
    }
  }

  for (const rid of allResponseIds) {
    const vals1 = map1[rid] || [];
    const vals2 = map2[rid] || [];

    for (const v1 of vals1) {
      for (const v2 of vals2) {
        if (crosstab[v1] && crosstab[v1][v2] !== undefined) {
          crosstab[v1][v2]++;
          rowTotals[v1]++;
          colTotals[v2]++;
          grandTotal++;
        }
      }
    }
  }

  const labels1 = {};
  const labels2 = {};

  if (question1.type === 'scale') {
    for (const v of values1) labels1[v] = v;
  } else {
    const opts = db.prepare('SELECT value, text FROM options WHERE question_id = ?').all(q1);
    for (const o of opts) labels1[o.value] = o.text;
  }

  if (question2.type === 'scale') {
    for (const v of values2) labels2[v] = v;
  } else {
    const opts = db.prepare('SELECT value, text FROM options WHERE question_id = ?').all(q2);
    for (const o of opts) labels2[o.value] = o.text;
  }

  res.json({
    question1: { id: question1.id, title: question1.title, type: question1.type, values: values1, labels: labels1 },
    question2: { id: question2.id, title: question2.title, type: question2.type, values: values2, labels: labels2 },
    crosstab,
    row_totals: rowTotals,
    column_totals: colTotals,
    grand_total: grandTotal
  });
});

router.get('/responses', authMiddleware, (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;
  const { page = 1, page_size = 20 } = req.query;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const offset = (page - 1) * page_size;
  const limit = parseInt(page_size);

  const responses = db.prepare(`
    SELECT * FROM responses 
    WHERE survey_id = ? 
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(surveyId, limit, offset);

  const total = db.prepare('SELECT COUNT(*) as count FROM responses WHERE survey_id = ?').get(surveyId).count;

  const responseIds = responses.map(r => r.id);
  let answers = [];
  if (responseIds.length > 0) {
    const placeholders = responseIds.map(() => '?').join(',');
    answers = db.prepare(`
      SELECT * FROM answers WHERE response_id IN (${placeholders})
    `).all(...responseIds);
  }

  const answerMap = {};
  for (const a of answers) {
    if (!answerMap[a.response_id]) answerMap[a.response_id] = {};
    if (!answerMap[a.response_id][a.question_id]) {
      answerMap[a.response_id][a.question_id] = [];
    }
    answerMap[a.response_id][a.question_id].push(a);
  }

  const questions = db.prepare('SELECT id, type, title FROM questions WHERE survey_id = ? ORDER BY sort_order ASC').all(surveyId);

  const enrichedResponses = responses.map(r => ({
    id: r.id,
    created_at: r.created_at,
    answers: questions.map(q => {
      const ans = answerMap[r.id]?.[q.id] || [];
      if (q.type === 'multiple') {
        return { question_id: q.id, values: ans.map(a => a.answer_value) };
      }
      return { question_id: q.id, value: ans[0]?.answer_value || '' };
    })
  }));

  res.json({
    total,
    page: parseInt(page),
    page_size: limit,
    responses: enrichedResponses
  });
});

module.exports = router;
