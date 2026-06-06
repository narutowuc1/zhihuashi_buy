const { log, loadConfig, launchBrowser } = require('./utils');

async function main() {
  const config = loadConfig();
  const { context, page } = await launchBrowser(config.userDataDir);

  log('打开订单中心...');
  await page.goto('https://order.jd.com/center/list.action', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(10000);

  // 找所有包含"付款"文字的元素
  const payElements = await page.evaluate(() => {
    const result = [];
    document.querySelectorAll('*').forEach(el => {
      const text = el.innerText?.trim();
      if (text === '付款' || text === '去付款') {
        result.push({
          tag: el.tagName,
          cls: el.className.toString().substring(0, 150),
          text,
          href: el.getAttribute('href') || '',
          id: el.id,
          parentTag: el.parentElement?.tagName,
          parentCls: el.parentElement?.className.toString().substring(0, 100),
          display: getComputedStyle(el).display,
        });
      }
    });
    return result;
  });
  log(`付款按钮: ${JSON.stringify(payElements, null, 2)}`);

  // 也看看 .order-detail 结构
  const orderDetails = await page.evaluate(() => {
    const rows = document.querySelectorAll('.order-detail');
    return rows.length;
  });
  log(`.order-detail 数量: ${orderDetails}`);

  log('按 Ctrl+C 退出');
  process.on('SIGINT', () => process.exit(0));
  await new Promise(() => {});
}

main();
