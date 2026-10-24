/**
 * 管理端通用工具
 */

/**
 * 转义 HTML，防止 XSS
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 安全设置元素的 innerHTML（先转义）
 * @param {HTMLElement} el
 * @param {string} text
 */
export function setText(el, text) {
  if (!el) return;
  el.textContent = text ?? '';
}

/**
 * 显示/隐藏视图
 * @param {string} viewId
 * @param {boolean} show
 */
export function toggleView(viewId, show) {
  const view = document.getElementById(viewId);
  if (!view) return;
  view.classList.toggle('view--hidden', !show);
  view.setAttribute('aria-hidden', String(!show));
}

/**
 * 设置导航高亮（左侧边栏）
 * @param {string} route - overview | rooms | room-detail
 */
export function setActiveNav(route) {
  document.querySelectorAll('.sidebar__link').forEach((link) => {
    const isActive = link.getAttribute('data-route') === route;
    link.classList.toggle('sidebar__link--active', isActive);
  });
}
