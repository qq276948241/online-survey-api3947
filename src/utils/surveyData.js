const db = require('../config/database');

function getQuestionsWithOptions(surveyId) {
  const rows = db.prepare(`
    SELECT 
      q.id as q_id,
      q.survey_id as q_survey_id,
      q.type as q_type,
      q.title as q_title,
      q.description as q_description,
      q.required as q_required,
      q.sort_order as q_sort_order,
      q.scale_min as q_scale_min,
      q.scale_max as q_scale_max,
      q.scale_min_label as q_scale_min_label,
      q.scale_max_label as q_scale_max_label,
      o.id as opt_id,
      o.text as opt_text,
      o.value as opt_value,
      o.sort_order as opt_sort_order
    FROM questions q
    LEFT JOIN options o ON q.id = o.question_id
    WHERE q.survey_id = ?
    ORDER BY q.sort_order ASC, q.id ASC, o.sort_order ASC, o.id ASC
  `).all(surveyId);

  return _groupQuestionsWithOptions(rows, 'q_', 'opt_');
}

function getSingleQuestionWithOptions(questionId) {
  const rows = db.prepare(`
    SELECT 
      q.id as q_id,
      q.survey_id as q_survey_id,
      q.type as q_type,
      q.title as q_title,
      q.description as q_description,
      q.required as q_required,
      q.sort_order as q_sort_order,
      q.scale_min as q_scale_min,
      q.scale_max as q_scale_max,
      q.scale_min_label as q_scale_min_label,
      q.scale_max_label as q_scale_max_label,
      o.id as opt_id,
      o.text as opt_text,
      o.value as opt_value,
      o.sort_order as opt_sort_order
    FROM questions q
    LEFT JOIN options o ON q.id = o.question_id
    WHERE q.id = ?
    ORDER BY o.sort_order ASC, o.id ASC
  `).all(questionId);

  const questions = _groupQuestionsWithOptions(rows, 'q_', 'opt_');
  return questions.length > 0 ? questions[0] : null;
}

function getTemplateQuestionsWithOptions(templateId) {
  const rows = db.prepare(`
    SELECT 
      q.id as q_id,
      q.template_id as q_template_id,
      q.type as q_type,
      q.title as q_title,
      q.description as q_description,
      q.required as q_required,
      q.sort_order as q_sort_order,
      q.scale_min as q_scale_min,
      q.scale_max as q_scale_max,
      q.scale_min_label as q_scale_min_label,
      q.scale_max_label as q_scale_max_label,
      o.id as opt_id,
      o.text as opt_text,
      o.value as opt_value,
      o.sort_order as opt_sort_order
    FROM template_questions q
    LEFT JOIN template_options o ON q.id = o.question_id
    WHERE q.template_id = ?
    ORDER BY q.sort_order ASC, q.id ASC, o.sort_order ASC, o.id ASC
  `).all(templateId);

  return _groupQuestionsWithOptions(rows, 'q_', 'opt_');
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

function _groupQuestionsWithOptions(rows, qPrefix, optPrefix) {
  const questionMap = {};
  const questions = [];

  for (const row of rows) {
    const qid = row[qPrefix + 'id'];

    if (!questionMap[qid]) {
      const qType = row[qPrefix + 'type'];
      const question = {
        id: qid,
        type: qType,
        title: row[qPrefix + 'title'],
        description: row[qPrefix + 'description'],
        required: row[qPrefix + 'required'],
        sort_order: parseInt(row[qPrefix + 'sort_order']) || 0,
        scale_min: row[qPrefix + 'scale_min'] !== null ? parseInt(row[qPrefix + 'scale_min']) : null,
        scale_max: row[qPrefix + 'scale_max'] !== null ? parseInt(row[qPrefix + 'scale_max']) : null,
        scale_min_label: row[qPrefix + 'scale_min_label'] || '',
        scale_max_label: row[qPrefix + 'scale_max_label'] || ''
      };

      const surveyId = row[qPrefix + 'survey_id'];
      const templateId = row[qPrefix + 'template_id'];
      if (surveyId !== undefined && surveyId !== null) question.survey_id = surveyId;
      if (templateId !== undefined && templateId !== null) question.template_id = templateId;

      if (qType === 'single' || qType === 'multiple') {
        question.options = [];
      }

      questionMap[qid] = question;
      questions.push(question);
    }

    const optId = row[optPrefix + 'id'];
    if (optId !== null && optId !== undefined) {
      const question = questionMap[qid];
      if (question && Array.isArray(question.options)) {
        question.options.push({
          id: optId,
          text: row[optPrefix + 'text'],
          value: row[optPrefix + 'value'],
          sort_order: parseInt(row[optPrefix + 'sort_order']) || 0
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
