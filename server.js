require('dotenv').config();

const fastify = require('fastify')({
  logger: true,
})
const puppeteer = require('puppeteer');

function getInt(input, def) {
  if (input) {
    if (typeof input == "string") return parseInt(input, 10);
    if (typeof input == "number") return input;
    throw new Error("Unsupported type");
  }
  return def;
}

const websiteUrl = process.env.URL;
if (!websiteUrl) {
  console.error("URL env var required");
  process.exit(1);
}

const username = process.env.USERNAME;
const password = process.env.PASSWORD;

const updateTimeMargin = getInt(process.env.UPDATE_TIME_MARGIN, 10000);
const postLoadDelay = getInt(process.env.POST_LOAD_DELAY, 2000);

let screenshot = null;
let updatePromise = null;
let updateDuration = 0;
let requestLastResponseTime = null;
let requestInterval = 0;
let updateTimer = 0;
let updateTimerDuration = 0;

// Browser launch options
const browserOptions = {
  args: [
    "--disable-dev-shm-usage",
  ],
  // headless: false,
  userDataDir: "./data/",
}

const viewportOptions = {
  width: getInt(process.env.WIDTH, 800),
  height: getInt(process.env.HEIGHT, 600),
}

/**
 * Update the current in-memory screenshot. If an update is already running,
 * the call is ignored/dropped (there is no queueing).
 */
async function updateScreenshot(log) {
  async function update() {
    const startTime = Date.now();
    let browser;
    try {
      log.info("update open browser");
      browser = await puppeteer.launch(browserOptions);

      log.info("update open page");
      const page = await browser.newPage();
      await page.setViewport(viewportOptions); 

      log.info("update goto");
      await page.goto(websiteUrl);

      log.info("update load");

      // Try to speed up any animations
      await page._client.send('Animation.setPlaybackRate', { playbackRate: 20 });
      
      if (username && password) {
        log.info("update login checking");
        log.info(`update wait ${postLoadDelay}ms`);
        await new Promise(resolve => setTimeout(resolve, postLoadDelay));
        const hasLogin = await page.evaluate(() => {
          return !!(
            document.querySelector(`[type="text"]`) &&
            document.querySelector(`[type="password"]`)
          );
        });
        log.info("update login found: " + hasLogin);
        if (hasLogin) {
          await page.type(`[type="text"]`, username);
          await page.type(`[type="password"]`, password);
          await page.keyboard.press("Enter");
        }
      }
      
      // Wait until everything is loaded
      log.info("update wait for navigation");
      await page.waitForNavigation({
        waitUntil: 'networkidle0',
      });

      // Waiting for some time can help when additional content is still loading
      // in asynchronously. Without the website telling you, you can't really
      // know when it's "really" loaded, so this is a good enough approximation.
      log.info(`update wait ${postLoadDelay}ms`);
      await new Promise(resolve => setTimeout(resolve, postLoadDelay));

      log.info("update screenshot");
      screenshot = await page.screenshot();
    } catch(error) {
      log.error("update error " + error);
    } finally {
      if (browser) {
        log.info("update close");
        await browser.close();
      }
      updateDuration = Date.now() - startTime;

      log.info("update done " + updateDuration + "ms");
      updatePromise = null;
    }
  }
  if (!updatePromise) {
    updatePromise = update();
  }
  return updatePromise;
}

/**
 * Format provided milliseconds as rounded seconds
 */
function formatTime(ms) {
  return (ms / 1000).toFixed(0) + "s";
}

/**
 * Schedule a screenshot update to be done as soon as possible (or even sooner).
 * 
 * The best case scenario is that an up-to-date in-memory screenshot will
 * already be available _before_ this function is called.
 * 
 * The worst case scenario is that the in-memory screenshot will only be updated
 * some time _after_ this function is called.
 * 
 * The function assumes that it will be called periodically with a constant time
 * period in-between the calls. This makes it possible to run the next update
 * so that it finishes _before_ the next time the function is called.
 * 
 * This is achieved by measuring the time interval between the last call and
 * the current one and the time it takes to finish an update.
 */
function scheduleScreenshot(log) {
  let timeoutDuration = 0;
  if (screenshot) {
    const now = Date.now();
    if (requestLastResponseTime === null) {
      requestLastResponseTime = now;
    }
    requestInterval = now - requestLastResponseTime;
    requestLastResponseTime = now;
    timeoutDuration = Math.max(0, requestInterval - updateDuration - updateTimeMargin);
  }
  if (updateTimer) {
    clearTimeout(updateTimer);
    log.warn(`scheduler got request ${formatTime(updateTimerDuration - requestInterval - updateDuration)} ahead of time, try increasing time margin`);
    timeoutDuration = 0;
  }
  log.info(`scheduler interval ${formatTime(requestInterval)} - duration ${formatTime(updateDuration)} - margin ${formatTime(updateTimeMargin)} => running after ${formatTime(timeoutDuration)}`);
  updateTimerDuration = timeoutDuration;
  updateTimer = setTimeout(() => {
    updateTimer = 0;
    updateScreenshot(log);
  }, timeoutDuration);
}

fastify.get('/page.png', async (request, reply) => {
  if (screenshot) {
    reply.type("image/png");
    reply.send(screenshot);
  } else {
    // Return "No Content" if there is no screenshot immediately available.
    // This will be the case until the very first update finishes.
    reply.code(204);
  }
  scheduleScreenshot(request.log);
})


async function listen() {
  try {
    await fastify.listen(getInt(process.env.PORT, 8000), '0.0.0.0');
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

async function start() {
  await listen();
}
start();
