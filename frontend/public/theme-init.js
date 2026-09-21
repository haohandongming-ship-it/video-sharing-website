/*
 * 首屏主题预置。
 *
 * 在首屏渲染前确定暗色模式，避免亮暗切换闪烁（验收标准 19.4）。
 *
 * 为什么不内联在 index.html 里：内联脚本会迫使 nginx 的 CSP 放开 script-src 'unsafe-inline'，
 * 一旦出现 HTML 注入就等于放开任意脚本执行。放在 public/ 下由同源静态文件加载后，
 * CSP 可以收紧为 script-src 'self'。本文件是阻塞式经典脚本（无 defer/async），
 * 仍在首次绘制前执行，因此不会产生主题闪烁。
 *
 * 读取的是 zustand persist 写入的 vs-ui-preference（见 src/stores/uiStore.ts），
 * 键名或结构变化时需同步这里。
 */
(function () {
  try {
    var raw = localStorage.getItem('vs-ui-preference');
    var theme = raw ? JSON.parse(raw).state.theme : 'system';
    var dark = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {
    /* 隐私模式或存储损坏时保持 index.html 上的默认主题 */
  }
})();
