const { log, launchBrowser } = require('./utils');

const JD_CANCELLED_ORDERS = 'https://order.jd.com/center/list.action?type=4';

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const now = Date.now();
const cutoffTime = now - TWO_DAYS_MS;

async function deleteCancelledOrders(page) {
  log('打开订单中心（已取消筛选）...');
  await page.goto(JD_CANCELLED_ORDERS, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  let totalDeleted = 0;
  let round = 0;

  while (true) {
    round++;
    log(`\n=== 第 ${round} 轮扫描 ===`);

    // 获取所有订单行的订单号和日期（一次性获取）
    const orderInfos = await page.evaluate(() => {
      const rows = document.querySelectorAll('tr.tr-th');
      const infos = [];
      rows.forEach(row => {
        const text = row.innerText || '';
        const idMatch = text.match(/\d{16,}/);
        if (!idMatch) return;
        const orderId = idMatch[0];
        const input = document.getElementById('datasubmit-' + orderId);
        if (!input) return;
        const dateMatch = input.value.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (!dateMatch) return;
        const orderTime = new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3])).getTime();
        const deleteBtn = row.querySelector('a.order-del');
        if (!deleteBtn) return;
        infos.push({ orderId, orderTime, hasDelete: true });
      });
      return infos;
    });

    log(`当前页面共有 ${orderInfos.length} 条订单记录`);

    if (orderInfos.length === 0) {
      log('未找到更多已取消订单，结束删除');
      break;
    }

    // 找出2天内的订单
    const toDelete = orderInfos.filter(o => o.orderTime >= cutoffTime);
    log(`其中 ${toDelete.length} 条在2天内可删除`);

    if (toDelete.length === 0) {
      log('没有2天内的订单，结束删除');
      break;
    }

    let deletedThisRound = 0;

    for (let i = 0; i < toDelete.length; i++) {
      const info = toDelete[i];
      log(`\n--- 删除订单 ${info.orderId} ---`);

      try {
        // 找到删除按钮并点击（每次都重新查找）
        const clicked = await page.evaluate((orderId) => {
          const rows = document.querySelectorAll('tr.tr-th');
          for (const row of rows) {
            const text = row.innerText || '';
            if (!text.includes(orderId)) continue;
            const btn = row.querySelector('a.order-del');
            if (btn) {
              btn.click();
              return true;
            }
          }
          return false;
        }, info.orderId);

        if (!clicked) {
          log(`订单 ${info.orderId} 点击失败`);
          continue;
        }

        // 快速检查弹窗并确认
        await page.waitForSelector('.ui-dialog a.remove-order', { timeout: 3000 });
        await page.evaluate(() => {
          const btn = document.querySelector('.ui-dialog a.remove-order');
          if (btn) btn.click();
        });
        log(`订单 ${info.orderId} 删除确认已提交`);

        deletedThisRound++;
        totalDeleted++;

        // 短暂等待页面响应
        await page.waitForTimeout(500);

      } catch (err) {
        log(`删除订单 ${info.orderId} 出错: ${err.message}`);
      }
    }

    if (deletedThisRound === 0) {
      log('本轮没有删除任何订单，结束');
      break;
    }

    log(`本轮删除 ${deletedThisRound} 条，刷新页面继续...`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  }

  return totalDeleted;
}

async function main() {
  log('============================');
  log('京东删除已取消订单（最近2天）');
  log('============================');
  log('');

  log('启动浏览器...');
  const { context, page } = await launchBrowser('./chrome-data');

  try {
    const totalDeleted = await deleteCancelledOrders(page);

    log('');
    log('============================');
    log(`删除完成，共删除 ${totalDeleted} 条已取消订单`);
    log('============================');

  } catch (err) {
    log(`出错: ${err.message}`);
    log(err.stack);
  }

  log('按 Ctrl+C 关闭浏览器');
  process.on('SIGINT', () => process.exit(0));
  await new Promise(() => {});
}

main();