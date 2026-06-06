const { log, isTargetTail, loadConfig, saveConfig, launchBrowser } = require('./utils');

const JD_CART = 'https://cart.jd.com/';
const JD_ORDER_CENTER = 'https://order.jd.com/center/list.action';

async function addToCart(page, productUrl, quantity) {
  log(`打开商品页面: ${productUrl}`);
  await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);

  const url = page.url();
  if (url.includes('passport.jd.com') || url.includes('login')) {
    throw new Error('未登录！请先运行 npm run login 登录京东');
  }

  // 设置件数
  if (quantity > 1) {
    log(`设置购买件数: ${quantity}`);
    try {
      const qtyInput = page.locator('#buy-num, input[class*="num"], input.quantity').first();
      await qtyInput.waitFor({ state: 'visible', timeout: 5000 });
      await qtyInput.click({ clickCount: 3 });
      await qtyInput.fill(String(quantity));
      await page.waitForTimeout(300);
    } catch {
      log('未找到数量输入框，使用默认1件');
    }
  }

  log('尝试加入购物车...');
  const addCartBtn = await page.waitForSelector('#add-to-cart', { timeout: 15000 });
  await addCartBtn.click();
  await page.waitForTimeout(1000);
  log('商品已加入购物车');
}

async function goToCheckout(page) {
  log('进入购物车并结算...');
  await page.goto(JD_CART, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // 直接等结算按钮出现，跳过 cart_count_detail 的单独等待
  const checkoutBtn = page.locator('#cart_count_detail div', { hasText: /结算/ }).last();
  await checkoutBtn.waitFor({ state: 'visible', timeout: 30000 });
  await checkoutBtn.click();
  await page.waitForURL(/trade\.jd\.com|cashier/, { timeout: 30000 });
  await page.waitForTimeout(2000);
  log('已到达结算页面');
}

async function handlePayPasswordIfNeeded(page, password) {
  await page.waitForTimeout(2000);
  const pageText = await page.evaluate(() => document.body.innerText);

  if (pageText.includes('请输入支付密码')) {
    log('检测到支付密码输入框，输入密码...');
    try {
      const pwdInput = page.locator('input[type="password"], input[type="tel"][maxlength="6"]').first();
      await pwdInput.waitFor({ state: 'visible', timeout: 5000 });
      await pwdInput.fill(password);
      await page.waitForTimeout(500);

      const confirmBtn = page.locator('button:has-text("确认"), button:has-text("确定"), button:has-text("完成")').first();
      try { await confirmBtn.click({ timeout: 3000 }); } catch {}

      await page.waitForTimeout(3000);
      log('支付密码已输入');
    } catch {
      log('尝试通过虚拟键盘输入密码...');
      for (const digit of password) {
        try {
          await page.locator(`[data-key="${digit}"], span:has-text("${digit}")`).first().click({ timeout: 1000 });
          await page.waitForTimeout(100);
        } catch {}
      }
      await page.waitForTimeout(2000);
    }
    return true;
  }

  log('不需要输入支付密码（之前已输入过）');
  return false;
}

async function submitOrderAndCreate(page, paymentPassword) {
  // 先检查结算页是否有密码输入框（新版京东：密码在结算页底部，和提交按钮同一页面）
  const pageText = await page.evaluate(() => document.body.innerText);

  if (pageText.includes('支付密码') || pageText.includes('请输入支付密码')) {
    log('结算页包含支付密码区域，先输入密码...');
    try {
      const pwdInput = page.locator('input[type="password"], input[type="tel"][maxlength="1"]').first();
      await pwdInput.waitFor({ state: 'visible', timeout: 5000 });
      // 逐位输入密码
      await pwdInput.focus();
      for (const digit of paymentPassword) {
        await page.keyboard.type(digit, { delay: 80 });
      }
      log('已在结算页输入支付密码');
      await page.waitForTimeout(500);
    } catch {
      log('结算页密码输入框未找到，尝试点击密码区域触发弹窗...');
      try {
        const pwdArea = page.locator('text=支付密码').first();
        await pwdArea.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
      } catch {}
    }
  }

  // 点击提交订单
  log('点击提交订单...');
  const submitBtn = page.locator('button:has-text("提交订单")').first();
  await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
  await submitBtn.click();
  log('已点击提交订单');

  // 点击后可能弹出密码输入框（如果结算页没有预输入密码）
  await handlePayPasswordIfNeeded(page, paymentPassword);

  // 等待订单创建完成（页面会跳转到支付页面）
  log('等待订单创建和页面跳转...');

  // 等待 URL 变化（包含 orderId 或跳到支付页）
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (url.match(/orderId|cashier|payc\.m\.jd/)) {
      log(`页面已跳转: ${url}`);
      return;
    }
  }

  log(`等待结束，当前 URL: ${page.url()}`);
}

function getOrderIdFromUrl(page) {
  const url = page.url();
  const match = url.match(/orderId[=:](\d+)/i);
  return match ? match[1] : null;
}

async function exitPayPage(page) {
  log('退出支付页面...');
  await page.goto(JD_ORDER_CENTER, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
}

async function cancelOrder(page, orderId) {
  log(`取消订单 ${orderId}...`);

  try {
    const cancelBtn = page.locator('a.order-cancel').first();
    await cancelBtn.waitFor({ state: 'visible', timeout: 10000 });
    await cancelBtn.click();
    await page.waitForTimeout(1500);

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
      return false;
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
    await page.waitForTimeout(1000);

    // 检查是否已取消
    const pageText = await page.evaluate(() => document.body.innerText);
    if (pageText.includes('已取消')) {
      log(`订单 ${orderId} 取消成功`);
      return true;
    }

    // 刷新再检查一次
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const pageText2 = await page.evaluate(() => document.body.innerText);
    if (pageText2.includes('已取消')) {
      log(`订单 ${orderId} 取消成功`);
      return true;
    }

    log(`订单 ${orderId} 取消结果不确定`);
    return false;

  } catch (err) {
    log(`取消订单出错: ${err.message}`);
    return false;
  }
}

async function preOrderWithTailCheck(page, config) {
  const { productUrl, quantity, targetTails, tailLength, paymentPassword, retryIntervalMs, maxRetries } = config;

  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    log(`=== 第 ${attempt} 次预下单尝试 ===`);

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
        log(`✓ 尾号 ${tail} 符合要求！保留订单 ${orderId}`);
        return orderId;
      }

      log(`✗ 尾号 ${tail} 不符合要求，取消订单并重试...`);
      await exitPayPage(page);
      await cancelOrder(page, orderId);

      log(`等待 ${retryIntervalMs / 1000} 秒后重试...`);
      await page.waitForTimeout(retryIntervalMs);

    } catch (err) {
      log(`预下单出错: ${err.message}`);
      log(`等待 ${retryIntervalMs / 1000} 秒后重试...`);
      await page.waitForTimeout(retryIntervalMs);
    }
  }

  throw new Error(`已达到最大重试次数 ${maxRetries}，未能获得目标尾号`);
}

module.exports = {
  addToCart,
  goToCheckout,
  submitOrderAndCreate,
  getOrderIdFromUrl,
  exitPayPage,
  cancelOrder,
  preOrderWithTailCheck,
};
