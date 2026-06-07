const { log, loadConfig, saveConfig, launchBrowser, isTargetTail } = require('./utils');
const { addToCart, goToCheckout, submitOrderAndCreate, getOrderIdFromUrl, exitPayPage, cancelOrder } = require('./order');

const JD_ORDER_CENTER = 'https://order.jd.com/center/list.action';
const PROTECT_WAIT_MS = 1 * 60 * 1000; // 触发保护机制后等待1分钟

// 从订单列表中找到指定订单并取消
async function cancelOrderFromList(page, orderId) {
  log(`前往订单列表查找订单 ${orderId}...`);
  await page.goto(JD_ORDER_CENTER, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 查找包含该订单号的订单块
  const orderItem = page.locator(`tr:has-text("${orderId}")`).first();
  try {
    await orderItem.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    log(`订单列表中未找到订单 ${orderId}，可能已不存在，继续下单`);
    return 'not_found';
  }

  // 检查订单状态
  const itemText = await orderItem.innerText();
  if (itemText.includes('已取消')) {
    log(`订单 ${orderId} 已是取消状态，无需操作`);
    return 'already_cancelled';
  }
  if (!itemText.includes('待付款')) {
    log(`订单 ${orderId} 状态不是待付款（状态: ${itemText.substring(0, 50)}），跳过取消`);
    return 'skip';
  }

  // 点击取消按钮
  log(`订单 ${orderId} 为待付款状态，执行取消...`);
  const cancelBtn = orderItem.locator('a.order-cancel, a:has-text("取消订单")').first();
  try {
    await cancelBtn.waitFor({ state: 'visible', timeout: 5000 });
    await cancelBtn.click();
    await page.waitForTimeout(1500);
  } catch {
    log(`未找到取消按钮，跳过`);
    return 'no_cancel_btn';
  }

  // 处理 PLUS 挽留弹窗
  try {
    const retainDialog = page.locator('.jd-order-center-retain-dialog .submit');
    await retainDialog.waitFor({ state: 'visible', timeout: 3000 });
    await retainDialog.click();
    log('已点击挽留弹窗的"取消订单"');
    await page.waitForTimeout(1000);
  } catch {
    log('未出现挽留弹窗');
  }

  // 取消原因弹窗在 iframe 中
  const frames = page.frames();
  const cancelFrame = frames.find(f => f.url().includes('cancelOrder'));
  if (!cancelFrame) {
    log('未找到取消原因 iframe，取消失败');
    return 'cancel_failed';
  }

  // 选择取消原因
  const reasonBtn = cancelFrame.locator('div.reason', { hasText: '不想要了' }).first();
  await reasonBtn.waitFor({ state: 'visible', timeout: 5000 });
  await reasonBtn.click();
  await page.waitForTimeout(500);

  // 提交取消
  const confirmBtn = cancelFrame.locator('a.J-confirm').first();
  await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
  await confirmBtn.click();
  log('已提交取消');
  await page.waitForTimeout(2000);

  // 检查结果
  const pageText = await page.evaluate(() => document.body.innerText);
  if (pageText.includes('已取消')) {
    log(`订单 ${orderId} 从列表取消成功`);
    return 'cancelled';
  }

  log(`订单 ${orderId} 取消结果不确定`);
  return 'unknown';
}

async function preOrderWithTailCheckAndProtect(page, config) {
  const { productUrl, quantity, targetTails, tailLength, paymentPassword, retryIntervalMs, maxRetries, tailMatchTarget = 1 } = config;

  let attempt = 0;
  let consecutiveCancelFails = 0;
  let matchedOrders = [];

  while (attempt < maxRetries) {
    attempt++;
    log(`=== 第 ${attempt} 次预下单尝试 (已匹配 ${matchedOrders.length}/${tailMatchTarget}) ===`);

    try {
      await addToCart(page, productUrl, quantity);
      await goToCheckout(page);
      await submitOrderAndCreate(page, paymentPassword);

      const orderId = getOrderIdFromUrl(page);
      if (!orderId) {
        throw new Error('无法从 URL 获取订单号');
      }

      const tail = orderId.slice(-tailLength);
      log(`订单号: ${orderId}, 尾号: ${tail}`);

      if (isTargetTail(orderId, targetTails, tailLength)) {
        matchedOrders.push(orderId);
        log(`✓ 尾号 ${tail} 符合要求！保留订单 ${orderId} (${matchedOrders.length}/${tailMatchTarget})`);
        if (matchedOrders.length >= tailMatchTarget) {
          return matchedOrders;
        }
        log(`继续下单匹配下一个...`);
        log(`等待 ${retryIntervalMs / 1000} 秒后重试...`);
        await page.waitForTimeout(retryIntervalMs);
        continue;
      }

      log(`✗ 尾号 ${tail} 不符合要求，取消订单并重试...`);
      await exitPayPage(page);
      const cancelOk = await cancelOrder(page, orderId);

      if (!cancelOk) {
        consecutiveCancelFails++;
        log(`取消失败（连续第 ${consecutiveCancelFails} 次），可能触发商品保护机制`);
        if (consecutiveCancelFails >= 1) {
          log(`========================================`);
          log(`检测到保护机制，暂停下单 ${PROTECT_WAIT_MS / 1000 / 60} 分钟...`);
          log(`========================================`);
          await page.waitForTimeout(PROTECT_WAIT_MS);
          consecutiveCancelFails = 0;

          // 暂停结束后，去订单列表查找并取消上次取消失败的订单
          log('等待结束，尝试清理上次未取消的订单...');
          const result = await cancelOrderFromList(page, orderId);
          log(`清理结果: ${result}，继续下单...`);
        }
      } else {
        consecutiveCancelFails = 0;
      }

      log(`等待 ${retryIntervalMs / 1000} 秒后重试...`);
      await page.waitForTimeout(retryIntervalMs);

    } catch (err) {
      log(`预下单出错: ${err.message}`);
      log(`等待 ${retryIntervalMs / 1000} 秒后重试...`);
      await page.waitForTimeout(retryIntervalMs);
    }
  }

  throw new Error(`已达到最大重试次数 ${maxRetries}，已匹配 ${matchedOrders.length}/${tailMatchTarget} 个订单`);
}

async function main() {
  const config = loadConfig();

  log('============================');
  log('京东预选订单（带保护判断）');
  log('============================');
  log(`商品链接: ${config.productUrl}`);
  log(`购买件数: ${config.quantity}`);
  log(`目标尾号: ${config.targetTails.join(', ')} (末尾${config.tailLength}位)`);
  log(`尾号匹配目标: ${config.tailMatchTarget || 1} 个`);
  log(`保护机制等待: ${PROTECT_WAIT_MS / 1000 / 60} 分钟`);
  log('');

  log('启动浏览器...');
  const { context, page } = await launchBrowser(config.userDataDir);

  try {
    const matchedOrders = await preOrderWithTailCheckAndProtect(page, config);

    saveConfig({ matchedOrders });

    log('');
    log('============================');
    log(`预选订单完成！共匹配 ${matchedOrders.length} 个订单:`);
    matchedOrders.forEach((id, i) => {
      log(`  ${i + 1}. 订单号: ${id}, 尾号: ${id.slice(-config.tailLength)}`);
    });
    log(`  已写入 config.json (matchedOrders)`);
    log('============================');
    log('');
    log('接下来可以:');
    log('  1. 运行 node pay.js 等待付款');
    log('  2. 或手动修改 config.json 中的 orderId 后再运行 pay.js');
    log('');
    log('按 Ctrl+C 关闭浏览器');

  } catch (err) {
    log(`预选订单出错: ${err.message}`);
  }

  process.on('SIGINT', () => process.exit(0));
  await new Promise(() => {});
}

main();
