// Read-only verification against the immutable Pages deployment origin.
import { chromium } from 'playwright';

const [url, project] = process.argv.slice(2);
if (!['word-garden', 'void-swarm'].includes(project) ||
    !new RegExp(`^https://[a-z0-9]+\\.${project}\\.pages\\.dev$`).test(url || '')) {
  throw new Error('An immutable allow-listed Pages deployment URL is required.');
}
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-dev-shm-usage'],
  ...(proxy ? { proxy: { server: proxy } } : {})
});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const failures = [];
  // Fresh local storage; never submit feedback, cloud saves or other writes.
  await context.route('**/*', async route => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method()) || new URL(request.url()).origin !== url) {
      failures.push('Unexpected off-origin request or network write.');
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', () => failures.push('Browser runtime error.'));
  page.on('console', message => { if (message.type() === 'error') failures.push('Browser console error.'); });
  page.on('requestfailed', () => failures.push('Preview asset request failed.'));
  page.on('response', response => { if (response.status() >= 400) failures.push('Preview asset returned an error.'); });
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  if (!response?.ok()) throw new Error('Preview HTML did not load.');
  await page.waitForSelector(project === 'word-garden' ? '.letter' : 'canvas', { state: 'visible', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  if (project === 'void-swarm') {
    const painted = await page.locator('canvas').first().evaluate(canvas => {
      const copy = document.createElement('canvas');
      copy.width = 32; copy.height = 32;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0, 32, 32);
      const pixels = ctx.getImageData(0, 0, 32, 32).data;
      return [...pixels].some((value, index) => index % 4 !== 3 && value > 0);
    });
    if (!painted) throw new Error('Preview canvas is blank.');
  }
  if (failures.length) throw new Error([...new Set(failures)].join(' '));
  console.log('PASS: deployed game boots at the verified preview URL; network writes blocked.');
} finally {
  await browser.close();
}
