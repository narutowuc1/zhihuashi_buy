const { loadConfig, log, launchBrowser } = require('./utils');

async function main() {
  const config = loadConfig();

  log('============================');
  log('京东登录脚本');
  log('============================');
  log('');
  log('将打开京东登录页面，请手动登录。');
  log('登录成功后，登录态会自动保存到 chrome-data 目录。');
  log('之后运行 npm start 即可使用保存的登录态。');
  log('');

  const { context, page } = await launchBrowser(config.userDataDir);

  // 导航到京东登录页
  await page.goto('https://passport.jd.com/new/login.aspx', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  log('浏览器已打开京东登录页面，请手动登录。');
  log('登录成功后，输入以下内容确认:');
  log('  - 登录成功后按 Ctrl+C 关闭此脚本');
  log('  - 然后运行 npm start 开始下单');
  log('');

  // 持续检测登录状态
  setInterval(async () => {
    try {
      const cookies = await context.cookies('https://www.jd.com');
      const hasLoginCookie = cookies.some(c =>
        c.name === 'thor' || c.name === '3AB9D23F7A4B3C98' || c.name === 'pin'
      );
      if (hasLoginCookie) {
        log('✓ 检测到登录态已保存！可以关闭此脚本并运行 npm start');
      }
    } catch {
      // 忽略
    }
  }, 5000);

  // 永久等待
  await new Promise(() => {});
}

main();
