const express = require('express');
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

function checkSurveyOwnership(surveyId, userId) {
  const survey = db.prepare('SELECT id FROM surveys WHERE id = ? AND user_id = ?').get(surveyId, userId);
  return !!survey;
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function generateVariableName(index, type) {
  const base = `Q${index}`;
  return base;
}

router.get('/csv', authMiddleware, (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);
  const questions = db.prepare(
    'SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(surveyId);

  const optionMap = {};
  for (const q of questions) {
    if (q.type === 'single' || q.type === 'multiple') {
      const opts = db.prepare(
        'SELECT * FROM options WHERE question_id = ? ORDER BY sort_order ASC'
      ).all(q.id);
      optionMap[q.id] = opts;
    }
  }

  const responses = db.prepare(
    'SELECT * FROM responses WHERE survey_id = ? ORDER BY id ASC'
  ).all(surveyId);

  const responseIds = responses.map(r => r.id);
  let allAnswers = [];
  if (responseIds.length > 0) {
    const placeholders = responseIds.map(() => '?').join(',');
    allAnswers = db.prepare(`
      SELECT * FROM answers WHERE response_id IN (${placeholders})
    `).all(...responseIds);
  }

  const answerMap = {};
  for (const a of allAnswers) {
    if (!answerMap[a.response_id]) answerMap[a.response_id] = {};
    if (!answerMap[a.response_id][a.question_id]) {
      answerMap[a.response_id][a.question_id] = [];
    }
    answerMap[a.response_id][a.question_id].push(a);
  }

  const headers = ['response_id', 'submit_time'];

  const columns = [];
  questions.forEach((q, qIndex) => {
    const varName = generateVariableName(qIndex + 1, q.type);
    if (q.type === 'multiple') {
      if (optionMap[q.id]) {
        optionMap[q.id].forEach((opt, oIndex) => {
          headers.push(`${varName}_${oIndex + 1}`);
          columns.push({
            questionId: q.id,
            type: 'multiple_dichotomy',
            optionValue: opt.value,
            varName: `${varName}_${oIndex + 1}`,
            label: `${q.title} - ${opt.text}`,
            valueLabels: { '0': '未选', '1': '选中' }
          });
        });
      }
    } else {
      headers.push(varName);
      const col = {
        questionId: q.id,
        type: q.type,
        varName,
        label: q.title
      };
      if (q.type === 'single' && optionMap[q.id]) {
        col.valueLabels = {};
        optionMap[q.id].forEach(opt => {
          col.valueLabels[opt.value] = opt.text;
        });
      }
      columns.push(col);
    }
  });

  const rows = [];
  responses.forEach(response => {
    const row = [response.id, response.created_at];
    columns.forEach(col => {
      const answers = answerMap[response.id]?.[col.questionId] || [];
      if (col.type === 'multiple_dichotomy') {
        const selected = answers.some(a => a.answer_value === col.optionValue);
        row.push(selected ? '1' : '0');
      } else if (col.type === 'text') {
        row.push(answers[0]?.answer_text || '');
      } else {
        row.push(answers[0]?.answer_value || '');
      }
    });
    rows.push(row.map(escapeCSV).join(','));
  });

  const csvContent = [headers.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="survey_${surveyId}_data.csv"`);
  res.setHeader('X-Variable-Labels', encodeURIComponent(JSON.stringify(columns.map(c => ({ name: c.varName, label: c.label })))));
  res.send('\uFEFF' + csvContent);
});

router.get('/sps', authMiddleware, (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const questions = db.prepare(
    'SELECT * FROM questions WHERE survey_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(surveyId);

  const optionMap = {};
  for (const q of questions) {
    if (q.type === 'single' || q.type === 'multiple') {
      const opts = db.prepare(
        'SELECT * FROM options WHERE question_id = ? ORDER BY sort_order ASC'
      ).all(q.id);
      optionMap[q.id] = opts;
    }
  }

  const columns = [];
  questions.forEach((q, qIndex) => {
    const varName = generateVariableName(qIndex + 1, q.type);
    if (q.type === 'multiple') {
      if (optionMap[q.id]) {
        optionMap[q.id].forEach((opt, oIndex) => {
          columns.push({
            varName: `${varName}_${oIndex + 1}`,
            label: `${q.title} - ${opt.text}`,
            type: 'multiple_dichotomy',
            valueLabels: { '0': '未选', '1': '选中' }
          });
        });
      }
    } else {
      const col = {
        varName,
        label: q.title,
        type: q.type
      };
      if (q.type === 'single' && optionMap[q.id]) {
        col.valueLabels = {};
        optionMap[q.id].forEach(opt => {
          col.valueLabels[opt.value] = opt.text;
        });
      }
      if (q.type === 'scale') {
        col.valueLabels = {};
        if (q.scale_min_label) col.valueLabels[String(q.scale_min)] = q.scale_min_label;
        if (q.scale_max_label) col.valueLabels[String(q.scale_max)] = q.scale_max_label;
      }
      columns.push(col);
    }
  });

  let spsContent = '* SPSS 语法文件 - 用于定义变量标签和值标签.\n';
  spsContent += '* 使用方法: 先导入CSV数据，然后运行此语法文件.\n\n';

  spsContent += 'VARIABLE LABELS\n';
  spsContent += '  response_id "答卷ID"\n';
  spsContent += '  submit_time "提交时间"\n';
  columns.forEach(col => {
    const label = col.label.replace(/"/g, '\'');
    spsContent += `  ${col.varName} "${label}"\n`;
  });
  spsContent += '.\n\n';

  const valueLabelVars = columns.filter(c => c.valueLabels && Object.keys(c.valueLabels).length > 0);
  if (valueLabelVars.length > 0) {
    spsContent += 'VALUE LABELS\n';
    valueLabelVars.forEach(col => {
      spsContent += `  ${col.varName}\n`;
      for (const [val, label] of Object.entries(col.valueLabels)) {
        const lbl = label.replace(/"/g, '\'');
        spsContent += `    ${val} "${lbl}"\n`;
      }
    });
    spsContent += '.\n\n';
  }

  spsContent += 'VARIABLE LEVEL\n';
  columns.forEach(col => {
    if (col.type === 'text') {
      spsContent += `  ${col.varName} (NOMINAL)\n`;
    } else if (col.type === 'scale' || col.type === 'single' || col.type === 'multiple_dichotomy') {
      spsContent += `  ${col.varName} (SCALE)\n`;
    } else {
      spsContent += `  ${col.varName} (NOMINAL)\n`;
    }
  });
  spsContent += '.\n\n';

  spsContent += 'EXECUTE.\n';

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="survey_${surveyId}_spss.sps"`);
  res.send(spsContent);
});

module.exports = router;
