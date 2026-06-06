const { log, loadConfig, launchBrowser, waitForPayTime, formatTime } = require('./utils');

const JD_ORDER_CENTER = 'https://order.jd.com/center/list.action';

async function main() {
  const config = loadConfig();
  const { orderId, paymentPassword, payTime } = config;

  if (!orderId) {
    log('错误: config.json 中 orderId 为空！请先运行 node pre-order.js 或手动填写 orderId');
    process.exit(1);
  }

  log('============================');
  log('京东定时付款');
  log('============================');
  log(`订单号: ${orderId}`);
  log(`付款时间: ${payTime}`);
  log('');

  log('启动浏览器...');
  const { context, page } = await launchBrowser(config.userDataDir);

  try {
    // 1. 打开订单中心，点击"付款"进入收银台
    log('打开订单中心...');
    await page.goto(JD_ORDER_CENTER, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // 截图查看订单页面状态
    try {
      await page.screenshot({ path: 'debug-order-page.png', fullPage: true });
      log('已截图订单页面: debug-order-page.png');
    } catch {}

    log('点击付款按钮...');
    const payBtn = page.locator(`a.btn-pay[href*="${orderId}"]`).first();
    await payBtn.waitFor({ state: 'visible', timeout: 15000 });

    // 付款按钮可能打开新标签页
    const [newPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }).catch(() => null),
      payBtn.click(),
    ]);

    const cashierPage = newPage || page;
    if (newPage) {
      await newPage.waitForLoadState('domcontentloaded');
      log('收银台在新标签页打开');
    }
    await cashierPage.waitForTimeout(5000);
    log(`已进入收银台: ${cashierPage.url()}`);

    // 截图保存收银台页面
    try {
      await cashierPage.screenshot({ path: 'debug-cashier.png', fullPage: true });
      log('已截图 debug-cashier.png');
    } catch {}

    // 检查并确认支付方式已选中（京东白条/京东支付等）
    log('检查支付方式选择...');
    const frames = cashierPage.frames();
    for (const frame of frames) {
      try {
        await frame.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});

        // 查找京东白条或其他支付方式的选中状态
        const checkedPayment = await frame.locator('input[type="checkbox"]:checked, input[type="radio"]:checked').count();
        if (checkedPayment > 0) {
          log(`支付方式已选中: ${checkedPayment} 个`);
        }
      } catch {}
    }

    // 2. 自动点击收银台页面的"立即支付"按钮
    log('查找收银台"立即支付"按钮...');

    let payNowBtn = null;
    let btnContext = cashierPage;

    // 先在主页面查找 - 使用更灵活的选择器
    try {
      // 方法1: 使用 :text 伪选择器
      let btn = cashierPage.locator('button:has-text("立即支付")').first();
      await btn.waitFor({ state: 'visible', timeout: 3000 });
      payNowBtn = btn;
      btnContext = cashierPage;
      log('在主页面找到"立即支付"按钮（方法1）');
    } catch {
      try {
        // 方法2: 查找所有button，通过JavaScript过滤
        const btn = await cashierPage.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
          return buttons.find(b => {
            const text = b.innerText || b.textContent || '';
            return text.includes('立即支付');
          });
        });

        if (btn) {
          payNowBtn = cashierPage.locator(`xpath=//*[contains(text(), "立即支付")]`).first();
          await payNowBtn.waitFor({ state: 'visible', timeout: 2000 });
          btnContext = cashierPage;
          log('在主页面找到"立即支付"按钮（方法2）');
        }
      } catch {
        log('主页面未找到，搜索 iframe...');
      }
    }

    // 如果主页面没找到，在所有 iframe 中查找
    if (!payNowBtn) {
      const allFrames = cashierPage.frames();
      for (let i = 0; i < allFrames.length; i++) {
        const frame = allFrames[i];
        try {
          await frame.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          await frame.waitForTimeout(2000);

          // 等待页面稳定
          await frame.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

          const btn = frame.locator('button:has-text("立即支付"), a:has-text("立即支付")').first();
          await btn.waitFor({ state: 'visible', timeout: 3000 });
          payNowBtn = btn;
          btnContext = frame;
          log(`在 frame[${i}] 找到"立即支付"按钮`);
          break;
        } catch {}
      }
    }

    if (!payNowBtn) {
      throw new Error('未找到"立即支付"按钮');
    }

    // ========== 新流程：提前15秒点击，等待弹窗，输入密码，等待时间，点击确认 ==========

    // 计算提前15秒的时间点
    const now = new Date();
    const [hours, minutes, seconds] = payTime.split(':').map(Number);
    const targetTime = new Date(now);
    targetTime.setHours(hours, minutes, seconds, 0);

    // 提前15秒的时间
    const earlyTime = new Date(targetTime.getTime() - 15 * 1000);

    // 如果还没到提前15秒的时间，等待
    if (now < earlyTime) {
      log(`等待到 ${formatTime(earlyTime)}（提前15秒）点击"立即支付"...`);
      await waitForPayTime(formatTime(earlyTime));
    }

    log('开始点击"立即支付"按钮（提前触发弹窗）...');

    // 方法1: 获取按钮位置，使用鼠标移动+点击模拟真实操作
    let clickSuccess = false;
    try {
      const box = await payNowBtn.boundingBox();
      if (box) {
        // 移动鼠标到按钮中心
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;

        log(`移动鼠标到 (${Math.round(x)}, ${Math.round(y)})`);
        await cashierPage.mouse.move(x, y, { steps: 10 });
        await cashierPage.waitForTimeout(200);

        // 点击
        await cashierPage.mouse.click(x, y);
        log('鼠标点击成功');
        clickSuccess = true;
      } else {
        throw new Error('无法获取按钮位置');
      }
    } catch (e) {
      log(`鼠标点击失败: ${e.message}`);

      // 方法2: 在 frame 内用 JavaScript 触发完整的鼠标事件序列
      try {
        await btnContext.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, a'));
          const payBtn = buttons.find(b => b.innerText && b.innerText.trim().includes('立即支付'));

          if (payBtn) {
            // 模拟完整的鼠标交互序列
            payBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
            payBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
            payBtn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true }));
            payBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
            payBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
            payBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
            payBtn.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, cancelable: true }));
            return true;
          }
          return false;
        });
        log('JavaScript 事件序列触发成功');
        clickSuccess = true;
      } catch (e2) {
        log(`JavaScript 事件序列失败: ${e2.message}`);
      }
    }

    if (!clickSuccess) {
      throw new Error('所有点击方法都失败了');
    }

    await cashierPage.waitForTimeout(2000);

    // ========== 等待支付验证弹窗出现 ==========
    log('等待弹窗出现...');
    let popupAppeared = false;
    let pwdInput = null;
    let pwdContext = null;

    const startWait = Date.now();
    const maxWait = 60000;

    while (!popupAppeared && (Date.now() - startWait < maxWait)) {
      const contexts = [cashierPage, ...cashierPage.frames()];

      for (const ctx of contexts) {
        try {
          const input = ctx.locator('input[type="password"], input[type="tel"], input[type="text"]').first();
          await input.waitFor({ state: 'visible', timeout: 1000 });
          pwdInput = input;
          pwdContext = ctx;
          popupAppeared = true;
          log('检测到支付验证弹窗！');
          break;
        } catch {}
      }

      if (!popupAppeared) {
        await cashierPage.waitForTimeout(500);
      }
    }

    if (!popupAppeared) {
      throw new Error('等待弹窗超时');
    }

    // 截图弹窗
    try {
      await cashierPage.screenshot({ path: 'debug-popup.png', fullPage: true });
      log('已截图 debug-popup.png');
    } catch {}

    // ========== 立即输入密码 ==========
    log('输入支付密码...');
    try {
      await pwdInput.focus();

      for (const digit of paymentPassword) {
        await cashierPage.keyboard.type(digit, { delay: 100 });
      }

      log('密码已输入');
    } catch (e) {
      throw new Error(`密码输入失败: ${e.message}`);
    }

    // ========== 等待到指定时间（提前2秒点击） ==========
    // 计算提前2秒的时间点
    const [th, tm, ts] = payTime.split(':').map(Number);
    const targetDate = new Date();
    targetDate.setHours(th, tm, ts, 0);
    const earlyDate = new Date(targetDate.getTime() - 2 * 1000);
    const earlyTimeStr = `${String(earlyDate.getHours()).padStart(2, '0')}:${String(earlyDate.getMinutes()).padStart(2, '0')}:${String(earlyDate.getSeconds()).padStart(2, '0')}`;

    log(`等待到 ${earlyTimeStr} 提前2秒点击弹窗里的"立即支付"...`);
    await waitForPayTime(earlyTimeStr);
    log(`已到 ${earlyTimeStr}，点击弹窗里的"立即支付"！`);

    // ========== 点击弹窗里的"立即支付"按钮 ==========
    log('在弹窗中查找并点击"立即支付"按钮...');

    let confirmSuccess = false;

    // 直接点击弹窗中心位置（按钮在中心）
    try {
      // 获取弹窗或页面中心位置
      const centerX = 1280 / 2;  // 视口宽度的一半
      const centerY = 800 / 2;   // 视口高度的一半

      // 先尝试获取弹窗位置
      const popupBox = await cashierPage.evaluate(() => {
        // 查找弹窗
        const modals = document.querySelectorAll('[class*="modal"], [class*="popup"], [class*="dialog"]');
        for (const modal of modals) {
          const rect = modal.getBoundingClientRect();
          if (rect.width > 200 && rect.height > 200) {
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          }
        }
        return null;
      });

      let clickX, clickY;
      if (popupBox) {
        clickX = popupBox.x + popupBox.width / 2;
        clickY = popupBox.y + popupBox.height / 2;
        log(`点击弹窗中心位置 (${Math.round(clickX)}, ${Math.round(clickY)})`);
      } else {
        clickX = centerX;
        clickY = centerY;
        log(`点击页面中心位置 (${Math.round(clickX)}, ${Math.round(clickY)})`);
      }

      // 移动鼠标并点击
      await cashierPage.mouse.move(clickX, clickY, { steps: 5 });
      await cashierPage.waitForTimeout(100);
      await cashierPage.mouse.click(clickX, clickY);
      confirmSuccess = true;
      log('鼠标点击成功');

    } catch (e) {
      log(`点击失败: ${e.message}`);
    }

    if (!confirmSuccess) {
      // 最后尝试按Enter键
      try {
        await cashierPage.keyboard.press('Enter');
        confirmSuccess = true;
        log('按Enter键提交成功');
      } catch {}
    }

    const totalTime = Date.now() - startWait;
    log(`支付操作完成`);

    // 5. 检查支付结果
    await cashierPage.waitForTimeout(5000);
    const pageText = await cashierPage.evaluate(() => document.body.innerText);

    if (pageText.includes('支付成功') || pageText.includes('付款成功')) {
      log('');
      log('============================');
      log('支付成功！');
      log('============================');
    } else {
      log('');
      log('============================');
      log('付款状态未知，请手动确认页面');
      log('============================');
    }

  } catch (err) {
    log(`付款出错: ${err.message}`);
    log(err.stack);
  }

  log('按 Ctrl+C 关闭浏览器');
  process.on('SIGINT', () => process.exit(0));
  await new Promise(() => {});
}

main();
