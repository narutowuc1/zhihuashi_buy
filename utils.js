const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function saveConfig(partial) {
  const config = loadConfig();
  Object.assign(config, partial);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  return config;
}

function log(msg) {
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  console.log(`[${now}] ${msg}`);
}

async function launchBrowser(userDataDir) {
  const absDataDir = path.resolve(__dirname, userDataDir);
  if (!fs.existsSync(absDataDir)) {
    fs.mkdirSync(absDataDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(absDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || await context.newPage();
  return { context, page };
}

function isTargetTail(orderId, targetTails, tailLength) {
  const str = String(orderId);
  const tail = str.slice(-tailLength);
  return targetTails.includes(tail);
}

function waitForPayTime(payTimeStr) {
  return new Promise((resolve) => {
    const [h, m, s] = payTimeStr.split(':').map(Number);

    const check = () => {
      const now = new Date();
      const target = new Date(now);
      target.setHours(h, m, s, 0);

      if (now >= target) {
        resolve();
        return;
      }

      const diff = target - now;
      if (diff > 1000) {
        setTimeout(check, 500);
      } else {
        while (new Date() < target) {}
        resolve();
      }
    };

    check();
  });
}

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

module.exports = {
  loadConfig,
  saveConfig,
  log,
  launchBrowser,
  isTargetTail,
  waitForPayTime,
  formatTime,
};
