require('dotenv').config({ quiet: true });
const Redis = require('ioredis');
const r = new Redis(process.env.REDIS_URL);
const scan = async (pat) => { const out = []; let c='0';
  do { const [n,k] = await r.scan(c,'MATCH',pat,'COUNT',500); c=n; out.push(...k); } while (c!=='0'); return out; };
(async () => {
  const before = await scan('t:*:storefront:ids:*');
  if (before.length) await r.del(...before);
  console.log('cleared', before.length, 'existing id-batch cache keys');

  const res = await fetch('http://localhost:3003/', { headers: { 'cache-control': 'no-cache' } });
  const html = await res.text();
  console.log('homepage status:', res.status, '| html bytes:', html.length);
  console.log('product links rendered:', (html.match(/\/product\//g) || []).length);

  await new Promise(r2 => setTimeout(r2, 1500));
  const after = await scan('t:*:storefront:ids:*');
  console.log('id-batch API calls made by that render:', after.length);
  await r.quit();
})();
