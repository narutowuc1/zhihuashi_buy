const { log, loadConfig, saveConfig, launchBrowser, isTargetTail } = require('./utils');
const { preOrderWithTailCheck } = require('./order');

async function main() {
  const config = loadConfig();

  log('============================');
  log('京东预选订单');
  log('============================');
  log(`商品链接: ${config.productUrl}`);
  log(`购买件数: ${config.quantity}`);
  log(`目标尾号: ${config.targetTails.join(', ')} (末尾${config.tailLength}位)`);
  log('');

  log('启动浏览器...');
  const { context, page } = await launchBrowser(config.userDataDir);

  try {
    const orderId = await preOrderWithTailCheck(page, config);
    const tail = orderId.slice(-config.tailLength);

    // 写入 config.json
    saveConfig({ orderId });

    log('');
    log('============================');
    log(`✓ 预选订单完成！`);
    log(`  订单号: ${orderId}`);
    log(`  尾号: ${tail}`);
    log(`  已写入 config.json`);
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
