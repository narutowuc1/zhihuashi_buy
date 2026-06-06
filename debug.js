const { log, launchBrowser } = require('./utils');

const JD_ORDER_CENTER = 'https://order.jd.com/center/list.action';

async function main() {
  const { context, page } = await launchBrowser('./chrome-data');

  log('打开订单中心...');
  await page.goto(JD_ORDER_CENTER, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(8000);

  log('点击取消订单...');
  await page.locator('a.order-cancel').first().click();
  await page.waitForTimeout(3000);

  log('点击挽留弹窗的"取消订单"...');
  await page.locator('.jd-order-center-retain-dialog .submit').click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'debug-cancel-step3.png', fullPage: false });
  log('截图3已保存');

  // 检查所有 iframe
  const frames = page.frames();
  log(`页面共有 ${frames.length} 个 frame`);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    log(`Frame ${i}: ${f.url()}`);
    if (f.url() !== 'about:blank' && f.url() !== page.url()) {
      try {
        const bodyText = await f.evaluate(() => document.body.innerText.trim().substring(0, 500));
        log(`  内容: ${bodyText}`);
        const allEls = await f.evaluate(() => {
          const els = [];
          document.querySelectorAll('a, span, div, select, option, li, button, label, input, p').forEach(el => {
            els.push({
              tag: el.tagName,
              cls: el.className.toString().substring(0, 100),
              text: el.innerText?.trim().substring(0, 50) || '',
              value: el.value || '',
            });
          });
          return els.filter(e => e.text.length > 0);
        });
        log(`  元素: ${JSON.stringify(allEls, null, 2)}`);
      } catch (e) {
        log(`  读取失败: ${e.message}`);
      }
    }
  }

  // 也检查主页面的 .ui-dialog-content 的 innerHTML（可能是空文本但有子元素）
  const dialogContent = await page.evaluate(() => {
    const dc = document.querySelector('.ui-dialog-content');
    if (!dc) return 'no .ui-dialog-content found';
    return {
      innerHTML: dc.innerHTML.substring(0, 1000),
      childCount: dc.children.length,
      childTags: Array.from(dc.children).map(c => ({ tag: c.tagName, cls: c.className.toString().substring(0, 100), text: c.innerText.trim().substring(0, 50) }))
    };
  });
  log(`dialog-content: ${JSON.stringify(dialogContent, null, 2)}`);

  log('按 Ctrl+C 退出');
  process.on('SIGINT', () => process.exit(0));
  await new Promise(() => {});
}

main();
