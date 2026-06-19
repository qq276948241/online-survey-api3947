const crypto = require('crypto');

function generateRespondentHash(ip, userAgent) {
  const str = `${ip}|${userAgent}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection.remoteAddress || '';
}

module.exports = {
  generateRespondentHash,
  getClientIp
};
