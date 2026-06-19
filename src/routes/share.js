const express = require('express');
const QRCode = require('qrcode');
const db = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

function checkSurveyOwnership(surveyId, userId) {
  const survey = db.prepare('SELECT id FROM surveys WHERE id = ? AND user_id = ?').get(surveyId, userId);
  return !!survey;
}

router.get('/', authMiddleware, (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const shareUrl = `${baseUrl}/s/${survey.share_token}`;

  res.json({
    share_token: survey.share_token,
    share_url: shareUrl,
    status: survey.status
  });
});

router.get('/qrcode', authMiddleware, async (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const shareUrl = `${baseUrl}/s/${survey.share_token}`;

  try {
    const qrDataUrl = await QRCode.toDataURL(shareUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.json({
      share_url: shareUrl,
      qrcode_data_url: qrDataUrl
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '二维码生成失败' });
  }
});

router.get('/qrcode.png', authMiddleware, async (req, res) => {
  const { surveyId } = req.params;
  const userId = req.user.id;

  if (!checkSurveyOwnership(surveyId, userId)) {
    return res.status(404).json({ error: '问卷不存在' });
  }

  const survey = db.prepare('SELECT * FROM surveys WHERE id = ?').get(surveyId);

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const shareUrl = `${baseUrl}/s/${survey.share_token}`;

  try {
    const qrBuffer = await QRCode.toBuffer(shareUrl, {
      width: 300,
      margin: 2,
      type: 'png',
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="survey_${surveyId}_qrcode.png"`);
    res.send(qrBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '二维码生成失败' });
  }
});

module.exports = router;
