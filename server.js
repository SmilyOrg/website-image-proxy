require('dotenv').config();

const fastify = require('fastify')({ logger: true })
const puppeteer = require('puppeteer');

fastify.get('/page.png', async (request, reply) => {
  const args = [];
  if (process.env.NO_SANDBOX == "true") args.push("--no-sandbox");
  const browser = await puppeteer.launch({
    args,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: process.env.WIDTH || 800, height: process.env.HEIGHT || 600}); 
  await page.goto(process.env.URL);
  await page._client.send('Animation.setPlaybackRate', { playbackRate: 20 });
  await page.waitForNavigation({
    waitUntil: 'networkidle0',
  });
  const screenshot = await page.screenshot();
  await browser.close();
  reply.type("image/png");
  reply.send(screenshot);
})

const start = async () => {
  try {
    await fastify.listen(process.env.PORT || 8000, '0.0.0.0');
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}
start();
