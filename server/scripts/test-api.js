const http = require('http');

// Start server
require('dotenv').config({ path: __dirname + '/../.env' });
const app = require('../dist/index.js'); // or start via node dist/index.js
