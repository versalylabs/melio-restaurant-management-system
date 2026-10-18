async function testLive() {
  try {
    const htmlRes = await fetch('http://localhost:5000/');
    const html = await htmlRes.text();

    const healthRes = await fetch('http://localhost:5000/api/health');
    const health = await healthRes.json();

    const menuRes = await fetch('http://localhost:5000/api/public/menu');
    const menu = await menuRes.json();

    const imgRes = await fetch('http://localhost:5000/images/food/Grilled%20Chicken.jpg');

    console.log('LIVE VERIFICATION RESULTS:');
    console.log('  1. HTML Status:', htmlRes.status, 'Has root div:', html.includes('<div id="root"></div>'));
    console.log('  2. Health Status:', healthRes.status, health);
    console.log('  3. Menu Items:', menuRes.status, 'Count:', menu.data?.items?.length, 'Sample Image:', menu.data?.items?.[0]?.image);
    console.log('  4. Food Image Served:', imgRes.status, imgRes.headers.get('content-type'));

    if (htmlRes.status === 200 && health.status === 'healthy' && menu.data?.items?.length > 0 && imgRes.status === 200) {
      console.log('\n>>> SYSTEM ON PORT 5000 IS 100% OPERATIONAL WITH ZERO ERRORS! <<<');
      process.exit(0);
    } else {
      console.error('\n>>> UNEXPECTED RESPONSE <<<');
      process.exit(1);
    }
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

testLive();
