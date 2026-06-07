const { log, launchBrowser } = require('./utils');

const JD_ORDER_CENTER = 'https://order.jd.com/center/list.action';
const JD_CANCELLED_ORDERS = 'https://order.jd.com/center/list.action?type=4'; // 已取消订单筛选

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const now = Date.now();
const cutoffTime = now - TWO_DAYS_MS;

function parseOrderDate(rowText) {
  // 匹配多种日期格式：2026-06-07、2026/06/07、06-07、06/07 等
  const patterns = [
    /(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})[日]?/,
    /(\d{1,2})[月\-/](\d{1,2})[日]?\s*[一-龥]?\s*(今天|昨天)/,
    /(\d{1,2})[\/\-](\d{1,2})/,
  ];

  for (const pattern of patterns) {
    const match = rowText.match(pattern);
    if (match) {
      if (pattern === patterns[1]) {
        // 今天或昨天
        if (rowText.includes('今天')) {
          return new Date(now).setHours(0, 0, 0, 0);
        } else if (rowText.includes('昨天')) {
          return new Date(now - 86400000).setHours(0, 0, 0, 0);
        }
      }

      let year, month, day;
      if (match.length === 4) {
        // 完整日期：年/月/日
        year = parseInt(match[1]);
        month = parseInt(match[2]) - 1;
        day = parseInt(match[3]);
      } else if (match.length === 3) {
        // 短日期：月/日（使用当前年份）
        year = new Date().getFullYear();
        month = parseInt(match[1]) - 1;
        day = parseInt(match[2]);
      }

      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date.getTime();
      }
    }
  }
  return null;
}

function isWithinTwoDays(rowText) {
  const orderTime = parseOrderDate(rowText);
  if (orderTime === null) {
    log('无法解析订单日期，包含此订单');
    return true; // 无法解析时包含
  }
  return orderTime >= cutoffTime;
}

async function deleteCancelledOrders(page) {
  log('打开订单中心（已取消筛选）...');
  await page.goto(JD_CANCELLED_ORDERS, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  let totalDeleted = 0;
  let round = 0;

  while (true) {
    round++;
    log(`\n=== 第 ${round} 轮扫描 ===`);

    // 获取当前页面所有订单行
    const orderRows = await page.locator('tr.tr-th').all();
    log(`当前页面共有 ${orderRows.length} 条订单记录`);

    if (orderRows.length === 0) {
      log('未找到更多已取消订单，结束删除');
      break;
    }

    let deletedThisRound = 0;

    for (let i = 0; i < orderRows.length; i++) {
      const row = orderRows[i];
      try {
        const rowText = await row.innerText();

        // 再次确认是已取消状态
        if (!rowText.includes('已取消')) {
          log(`订单行 ${i + 1} 不是已取消状态，跳过`);
          continue;
        }

        // 检查订单日期，只删除最近2天的
        if (!isWithinTwoDays(rowText)) {
          log(`订单 ${orderId} 超过2天，跳过`);
          continue;
        }

        // 提取订单号
        const orderIdMatch = rowText.match(/\d{19,}/);
        if (!orderIdMatch) {
          log(`订单行 ${i + 1} 未找到有效订单号，跳过`);
          continue;
        }
        const orderId = orderIdMatch[0];
        log(`\n--- 删除订单 ${orderId} ---`);

        // 点击删除按钮
        const deleteBtn = row.locator('a.order-del').first();
        const hasDeleteBtn = await deleteBtn.count() > 0;

        if (!hasDeleteBtn) {
          log(`订单 ${orderId} 未找到删除按钮，跳过`);
          continue;
        }

        await deleteBtn.click();
        await page.waitForTimeout(1500);

        // 确认删除弹窗
        const dialogVisible = await page.locator('.ui-dialog').isVisible();
        if (!dialogVisible) {
          log(`订单 ${orderId} 确认弹窗未出现，跳过`);
          continue;
        }

        const confirmBtn = page.locator('.ui-dialog a.remove-order').first();
        try {
          await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
          await confirmBtn.click();
          log(`订单 ${orderId} 删除确认已提交`);
        } catch {
          log(`订单 ${orderId} 确认按钮未找到，跳过`);
          continue;
        }

        await page.waitForTimeout(2000);
        deletedThisRound++;
        totalDeleted++;

      } catch (err) {
        log(`删除订单时出错: ${err.message}`);
      }
    }

    if (deletedThisRound === 0) {
      log('本轮没有删除任何订单，结束');
      break;
    }

    log(`本轮删除 ${deletedThisRound} 条，刷新页面继续...`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
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
  }

  log('按 Ctrl+C 关闭浏览器');
  process.on('SIGINT', () => process.exit(0));
  await new Promise(() => {});
}

main();