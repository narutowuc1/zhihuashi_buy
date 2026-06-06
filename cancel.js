const { log, launchBrowser } = require('./utils');

const JD_ORDER_CENTER = 'https://order.jd.com/center/list.action';

async function main() {
  const args = process.argv.slice(2);
  const orderIds = args.filter(a => /^\d{10,}$/.test(a));

  if (orderIds.length === 0) {
    log('用法: node cancel.js <订单号1> [订单号2] ...');
    log('示例: node cancel.js 3521428001258701 3521428011084726');
    process.exit(1);
  }

  log('============================');
  log('京东删除已取消订单');
  log('============================');
  log(`待删除订单: ${orderIds.join(', ')}`);
  log('');

  log('启动浏览器...');
  const { context, page } = await launchBrowser('./chrome-data');

  try {
    log('打开订单中心...');
    await page.goto(JD_ORDER_CENTER, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);

    for (const orderId of orderIds) {
      log(`\n--- 处理订单 ${orderId} ---`);

      // 在页面中查找该订单号
      const found = await page.evaluate((oid) => {
        const bodyText = document.body.innerText;
        return bodyText.includes(oid);
      }, orderId);

      if (!found) {
        log(`订单 ${orderId} 未在当前页面找到，可能已被删除或翻页`);
        continue;
      }

      // 找到该订单所在区域，检查状态
      const orderInfo = await page.evaluate((oid) => {
        const bodyText = document.body.innerText;
        // 找到包含该订单号的文本段落
        const idx = bodyText.indexOf(oid);
        if (idx === -1) return null;
        // 获取该订单号前后的文字（用于判断状态）
        const context = bodyText.substring(Math.max(0, idx - 50), Math.min(bodyText.length, idx + 200));
        return context;
      }, orderId);

      log(`订单上下文: ${orderInfo}`);

      // 确认该订单是"已取消"状态
      if (!orderInfo || !orderInfo.includes('已取消')) {
        log(`订单 ${orderId} 不是"已取消"状态，跳过删除（安全起见不操作）`);
        continue;
      }

      log(`订单 ${orderId} 确认为"已取消"状态，执行删除...`);

      // 找到该订单的"删除"按钮
      try {
        // 尝试多种可能的选择器来定位订单行
        const rowSelectors = [
          'tr.tr-th',                  // 京东订单行的主要class
          'tr[data-sid]',              // 京东使用data-sid
          '.order-detail',
          '.order-list',
          '.order-item',
          '[class*="order"]',
          '.goods-item',
        ];

        let orderRow = null;
        for (const sel of rowSelectors) {
          const rows = await page.locator(sel).all();
          for (const row of rows) {
            try {
              const text = await row.innerText();
              if (text.includes(orderId)) {
                orderRow = row;
                log(`找到订单行，选择器: ${sel}`);
                break;
              }
            } catch {}
          }
          if (orderRow) break;
        }

        if (!orderRow) {
          log(`订单 ${orderId} 未找到`);
          continue;
        }

        // 尝试多种删除链接选择器 - 注意：京东的删除按钮没有文本，class是order-del
        const deleteSelectors = [
          'a.order-del',              // 京东的删除按钮就是这个class（没有文本）
          'a:has-text("删除")',
          'a[class*="delete"]',
          'a[title*="删除"]',
          '[class*="delete"] a',
          'button:has-text("删除")',
          '.delete-btn',
          '.order-delete',
        ];

        let deleteClicked = false;
        for (const sel of deleteSelectors) {
          try {
            const deleteLink = orderRow.locator(sel).first();
            const count = await deleteLink.count();
            if (count > 0) {
              await deleteLink.click({ timeout: 3000 });
              log(`已点击删除按钮: ${sel}`);
              deleteClicked = true;
              break;
            }
          } catch {}
        }

        if (!deleteClicked) {
          // 备用方案：在页面范围内搜索
          for (const sel of deleteSelectors) {
            try {
              const links = page.locator(sel).all();
              for (const link of links) {
                const text = await link.innerText();
                const parentText = await link.locator('..').innerText().catch(() => '');
                if (parentText.includes(orderId) || text.includes(orderId)) {
                  await link.click({ timeout: 3000 });
                  log(`通过备用方案点击删除: ${sel}`);
                  deleteClicked = true;
                  break;
                }
              }
            } catch {}
            if (deleteClicked) break;
          }
        }

        await page.waitForTimeout(2000);

        // 处理确认删除弹窗 - 使用正确的选择器 a.remove-order
        const dialogVisible = await page.locator('.ui-dialog').isVisible();
        if (!dialogVisible) {
          log(`订单 ${orderId} 确认弹窗未出现`);
          continue;
        }

        try {
          const confirmDelete = page.locator('.ui-dialog a.remove-order').first();
          await confirmDelete.waitFor({ state: 'visible', timeout: 5000 });

          // 尝试普通点击，如果失败则使用 force
          try {
            await confirmDelete.click({ timeout: 3000 });
            log('已点击确认按钮');
          } catch (err) {
            log(`普通点击失败，使用 force 方式: ${err.message}`);
            await confirmDelete.click({ force: true });
            log('已点击确认按钮 (force)');
          }

          // 等待删除完成
          await page.waitForTimeout(2000);

          // 刷新页面确认删除
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(3000);
          const pageText = await page.evaluate(() => document.body.innerText);
          if (!pageText.includes(orderId)) {
            log(`✓ 确认订单 ${orderId} 已删除`);
          } else {
            log(`✗ 订单 ${orderId} 仍在页面中`);
          }
        } catch (err) {
          log(`订单 ${orderId} 删除确认出错: ${err.message}`);
        }

      } catch (err) {
        log(`删除订单 ${orderId} 出错: ${err.message}`);
      }
    }

    log('');
    log('============================');
    log('删除操作完成');
    log('============================');

  } catch (err) {
    log(`出错: ${err.message}`);
  }

  log('按 Ctrl+C 关闭浏览器');
  process.on('SIGINT', () => process.exit(0));
  await new Promise(() => {});
}

main();
