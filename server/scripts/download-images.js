const fs = require('fs');
const path = require('path');
const https = require('https');

const targetDir = path.resolve(__dirname, '../../client/public/images/food');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

const images = [
  { name: 'Grilled Chicken.jpg', url: 'https://images.unsplash.com/photo-1598515214211-89d3c73ae83b?w=800&q=80' },
  { name: 'Beef Steak.jpg', url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=800&q=80' },
  { name: 'Chicken Burger.jpg', url: 'https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?w=800&q=80' },
  { name: 'Beef Burger.jpg', url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=80' },
  { name: 'Chicken Wings.jpg', url: 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=800&q=80' },
  { name: 'Chocolate Cake.jpg', url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800&q=80' },
  { name: 'Samosa.jpg', url: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=800&q=80' },
  { name: 'Coke.jpg', url: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=800&q=80' },
  { name: 'Passion Juice.jpg', url: 'https://images.unsplash.com/photo-1534353473418-4cfa6c56fd38?w=800&q=80' }
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`Status ${response.statusCode} for ${url}`));
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function run() {
  console.log('[Images] Downloading menu photos into client/public/images/food...');
  for (const img of images) {
    const dest = path.join(targetDir, img.name);
    try {
      await download(img.url, dest);
      const stat = fs.statSync(dest);
      console.log(`[Images] Saved ${img.name} (${Math.round(stat.size / 1024)} KB)`);
    } catch (err) {
      console.error(`[Images] Failed to download ${img.name}:`, err.message);
    }
  }
  console.log('[Images] All downloads complete.');
}

run();
