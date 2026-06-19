const express = require('express');
const cors = require('cors');
const initDatabase = require('./config/initDB');

const authRoutes = require('./routes/auth');
const surveyRoutes = require('./routes/surveys');
const questionRoutes = require('./routes/questions');
const responseRoutes = require('./routes/responses');
const statsRoutes = require('./routes/stats');
const exportRoutes = require('./routes/export');
const shareRoutes = require('./routes/share');
const templateRoutes = require('./routes/templates');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

initDatabase();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '问卷调研系统 API 运行正常' });
});

app.use('/api/auth', authRoutes);
app.use('/api/surveys', surveyRoutes);

app.use('/api/surveys/:surveyId/questions', questionRoutes);
app.use('/api/surveys/:surveyId/stats', statsRoutes);
app.use('/api/surveys/:surveyId/export', exportRoutes);
app.use('/api/surveys/:surveyId/share', shareRoutes);
app.use('/api/templates', templateRoutes);

app.use('/api/s', responseRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`问卷调研系统 API 已启动`);
  console.log(`服务地址: http://localhost:${PORT}`);
  console.log(`默认账号: admin / admin123`);
  console.log('');
  console.log('API 列表:');
  console.log('  POST /api/auth/login          - 管理员登录');
  console.log('  GET  /api/health              - 健康检查');
  console.log('');
  console.log('  GET  /api/surveys             - 问卷列表');
  console.log('  POST /api/surveys             - 创建问卷');
  console.log('  GET  /api/surveys/:id         - 问卷详情');
  console.log('  PUT  /api/surveys/:id         - 更新问卷');
  console.log('  DELETE /api/surveys/:id       - 删除问卷');
  console.log('  POST /api/surveys/:id/publish - 发布问卷');
  console.log('  POST /api/surveys/:id/close   - 关闭问卷');
  console.log('');
  console.log('  GET  /api/surveys/:id/questions          - 题目列表');
  console.log('  POST /api/surveys/:id/questions          - 新增题目');
  console.log('  PUT  /api/surveys/:id/questions/:qid     - 更新题目');
  console.log('  DELETE /api/surveys/:id/questions/:qid   - 删除题目');
  console.log('');
  console.log('  GET  /api/surveys/:id/stats/summary      - 回收进度统计');
  console.log('  GET  /api/surveys/:id/stats/question/:qid - 单题统计');
  console.log('  GET  /api/surveys/:id/stats/crosstab     - 交叉统计');
  console.log('  GET  /api/surveys/:id/stats/responses    - 答卷列表');
  console.log('');
  console.log('  GET  /api/surveys/:id/export/csv         - 导出 CSV 数据');
  console.log('  GET  /api/surveys/:id/export/sps         - 导出 SPSS 语法');
  console.log('');
  console.log('  GET  /api/surveys/:id/share              - 分享链接');
  console.log('  GET  /api/surveys/:id/share/qrcode       - 二维码 (DataURL)');
  console.log('  GET  /api/surveys/:id/share/qrcode.png   - 二维码 (PNG图片)');
  console.log('');
  console.log('  POST /api/templates/from-survey/:id      - 问卷存为模板');
  console.log('  GET  /api/templates                      - 模板列表');
  console.log('  GET  /api/templates/:id                  - 模板详情');
  console.log('  DELETE /api/templates/:id                - 删除模板');
  console.log('  POST /api/templates/:id/create-survey    - 从模板创建问卷');
  console.log('');
  console.log('  GET  /api/s/:shareToken                  - 公开获取问卷');
  console.log('  POST /api/s/:shareToken/start              - 开始答题（计时开始）');
  console.log('  POST /api/s/:shareToken/submit             - 提交答卷（支持超时自动提交）');
});

module.exports = app;
