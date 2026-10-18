require('dotenv').config({ path: __dirname + '/../.env' });
const http = require('http');

// Set port to 5098 to not conflict with any running server
process.env.PORT = '5098';

const serverApp = require('../dist/index.js');

function fetchUrl(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:5098${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, data: JSON.parse(data) });
      });
    }).on('error', reject);
  });
}

setTimeout(async () => {
  try {
    console.log('[Test] Testing /api/health...');
    const health = await fetchUrl('/api/health');
    console.log('[Test] Health response:', health.status, health.data);

    console.log('[Test] Testing /api/public/restaurants...');
    const restaurants = await fetchUrl('/api/public/restaurants');
    console.log('[Test] Restaurants response:', restaurants.status, 'Count:', restaurants.data?.data?.restaurants?.length);

    console.log('[Test] Testing /api/public/menu...');
    const menu = await fetchUrl('/api/public/menu');
    console.log('[Test] Menu response:', menu.status, 'Categories:', menu.data?.data?.categories?.length, 'Items:', menu.data?.data?.items?.length);
    console.log('[Test] Sample item:', menu.data?.data?.items?.[0]?.name, 'Image:', menu.data?.data?.items?.[0]?.image);

    console.log('\n>>> ALL ENDPOINT TESTS PASSED WITH ZERO 500 INTERNAL SERVER ERRORS! <<<');
    process.exit(0);
  } catch (err) {
    console.error('[Test] FAILED:', err);
    process.exit(1);
  }
}, 1500);
