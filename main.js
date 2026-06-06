const { loadConfig, log } = require('./utils');

async function main() {
  const config = loadConfig();

  if (config.orderId) {
    log('检测到 config.json 中已有 orderId，跳转到付款流程');
    require('./pay');
  } else {
    log('config.json 中 orderId 为空，进入预选订单流程');
    require('./pre-order');
  }
}

main();
