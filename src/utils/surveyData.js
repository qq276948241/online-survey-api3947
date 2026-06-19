const db = require('../config/database');

function getQuestionsWithOptions(surveyId) {
  const rows = db.prepare(`
    SELECT 
      q.id as question_id,
      q.survey_id,
      q.type,
      q.title,
      q.description,
      q.required,
      q.sort_order,
      q.scale_min,
      q.scale_max,
      q.scale_min_label,
      q.scale_max_label,
      o.id as option_id,
      o.text as option_text,
      o.value as option_value,
      o.sort_order as option_sort_order
    FROM questions q
    LEFT JOIN options o ON q.id = o.question_id
    WHERE q.survey_id = ?
    ORDER BY q.sort_order ASC, q.id ASC, o.sort_order ASC, o.id ASC
  `).all(surveyId);

  return _groupQuestionsWithOptions(rows);
}

function getSingleQuestionWithOptions(questionId) {
  const rows = db.prepare(`
    SELECT 
      q.id as question_id,
      q.survey_id,
      q.type,
      q.title,
      q.description,
      q.required,
      q.sort_order,
      q.scale_min,
      q.scale_max,
      q.scale_min_label,
      q.scale_max_label,
      o.id as option_id,
      o.text as option_text,
      o.value as option_value,
      o.sort_order as option_sort_order
    FROM questions q
    LEFT JOIN options o ON q.id = o.question_id
    WHERE q.id = ?
    ORDER BY o.sort_order ASC, o.id ASC
  `).all(questionId);

  const questions = _groupQuestionsWithOptions(rows);
  return questions.length > 0 ? questions[0] : null;
}

function getTemplateQuestionsWithOptions(templateId) {
  const rows = db.prepare(`
    SELECT 
      q.id as question_id,
      q.template_id,
      q.type,
      q.title,
      q.description,
      q.required,
      q.sort_order,
      q.scale_min,
      q.scale_max,
      q.scale_min_label,
      q.scale_max_label,
      o.id as option_id,
      o.text as option_text,
      o.value as option_value,
      o.sort_order as option_sort_order
    FROM template_questions q
    LEFT JOIN template_options o ON q.id = o.question_id
    WHERE q.template_id = ?
    ORDER BY q.sort_order ASC, q.id ASC, o.sort_order ASC, o.id ASC
  `).all(templateId);

  return _groupQuestionsWithOptions(rows);
}

function getOptionMap(questionId) {
  const options = db.prepare(`
    SELECT value, text FROM options WHERE question_id = ? ORDER BY sort_order ASC, id ASC
  `).all(questionId);

  const map = {};
  for (const opt of options) {
    map[opt.value] = opt.text;
  }
  return map;
}

function getOptionValues(questionId) {
  return db.prepare(`
    SELECT value FROM options WHERE question_id = ? ORDER BY sort_order ASC, id ASC
  `).all(questionId).map(o => o.value);
}

function _groupQuestionsWithOptions(rows) {
  const questionMap = {};
  const questions = [];

  for (const row of rows) {
    const qid = row.question_id;

    if (!questionMap[qid]) {
      const question = {
        id: qid,
        type: row.type,
        title: row.title,
        description: row.description,
        required: row.required,
        sort_order: row.sort_order,
        scale_min: row.scale_min,
        scale_max: row.scale_max,
        scale_min_label: row.scale_min_label,
        scale_max_label: row.scale_max_label
      };

      if (row.survey_id !== undefined) question.survey_id = row.survey_id;
      if (row.template_id !== undefined) question.template_id = row.template_id;

      if (row.type === 'single' || row.type === 'multiple') {
        question.options = [];
      }

      questionMap[qid] = question;
      questions.push(question);
    }

    if (row.option_id !== null && row.option_id !== undefined) {
      const question = questionMap[qid];
      if (question.options) {
        question.options.push({
          id: row.option_id,
          text: row.option_text,
          value: row.option_value,
          sort_order: row.option_sort_order
        });
      }
    }
  }

  return questions;
}

module.exports = {
  getQuestionsWithOptions,
  getSingleQuestionWithOptions,
  getTemplateQuestionsWithOptions,
  getOptionMap,
  getOptionValues
};
