const serverless = require('serverless-http');
const app = require('../../api/index.js');

module.exports.handler = serverless(app);
