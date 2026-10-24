/**
 * Mod 发布：整包上传、切换生效版本、预览热更新清单。
 *
 * 服务端把整包拆成两层：
 *   CacheAssets/ —— 热更新层，客户端下一次启动时按 /checkupdate 的 files[] 比对下载；
 *   其余根目录文件 —— 重启层，只在重新出包时更新。
 * 预览就是按客户端格式算一遍 files[]，发布前先核对数量与哈希，避免发空清单。
 */

import { escapeHtml } from './utils.js';
import { getMods, publishMod, activateMod, previewMod, deleteMod } from './api.js';

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 只显示哈希前 12 位，核对时够用又不占宽 */
function shortHash(hash) {
  const text = String(hash || '');
  const value = text.startsWith('sha256:') ? text.slice(7) : text;
  return value.slice(0, 12);
}

export function renderMods(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="page">
      <div class="page__head">
        <div>
          <h2 class="page__title">Mod 发布</h2>
          <p class="page__desc">
            上传出包生成的整包 zip，服务端自动分拣热更新文件与重启文件。
            切换生效版本后，客户端下一次启动检查更新即按新版本比对。
          </p>
        </div>
        <div class="page__actions">
          <button type="button" class="btn" data-action="refresh">刷新</button>
        </div>
      </div>

      <div class="card">
        <h3 class="card__title">发布新版本</h3>
        <div class="form-grid">
          <label class="form-field">
            <span class="form-field__label">整包 zip</span>
            <input type="file" class="input" accept=".zip" data-role="mod-file" />
          </label>
          <label class="form-field">
            <span class="form-field__label">发布目录名（留空自动生成）</span>
            <input type="text" class="input" placeholder="例如 20261024-1" data-role="mod-release" />
          </label>
          <label class="form-field">
            <span class="form-field__label">客户端版本号（留空沿用当前）</span>
            <input type="text" class="input" placeholder="2.0.0" data-role="mod-client-version" />
          </label>
          <label class="form-field">
            <span class="form-field__label">更新公告</span>
            <input type="text" class="input" data-role="mod-announcement" />
          </label>
        </div>
        <div class="form-row form-row--inline">
          <label class="form-check">
            <input type="checkbox" data-role="mod-activate" checked />
            <span>发布后立即生效</span>
          </label>
          <label class="form-check">
            <input type="checkbox" data-role="mod-force" />
            <span>强制更新</span>
          </label>
        </div>
        <div class="form-row">
          <button type="button" class="btn btn--primary" data-action="publish">上传并发布</button>
        </div>
        <p class="form-hint">
          发布目录名只能是字母、数字与 . _ -；同一目录名重复发布会覆盖该版本的 CacheAssets 内容。
        </p>
        <p class="form-message" data-role="message" aria-live="polite"></p>
      </div>

      <div class="card">
        <div class="card__head">
          <h3 class="card__title">发布列表</h3>
          <span class="card__meta" data-role="summary"></span>
        </div>
        <div data-role="list"><p class="page__loading">加载中…</p></div>
      </div>

      <div class="card" data-role="preview-card" hidden>
        <div class="card__head">
          <h3 class="card__title">热更新清单预览</h3>
          <span class="card__meta" data-role="preview-summary"></span>
        </div>
        <div data-role="preview"><p class="page__empty">选择某个版本后点「预览清单」。</p></div>
      </div>
    </div>
  `;

  const q = (selector) => container.querySelector(selector);
  const listEl = q('[data-role="list"]');
  const summaryEl = q('[data-role="summary"]');
  const messageEl = q('[data-role="message"]');
  const previewCard = q('[data-role="preview-card"]');
  const previewEl = q('[data-role="preview"]');
  const previewSummary = q('[data-role="preview-summary"]');

  const say = (text, isError) => {
    if (!messageEl) return;
    messageEl.textContent = text || '';
    messageEl.className = isError ? 'form-message form-message--error' : 'form-message';
  };

  const load = async () => {
    if (listEl) listEl.innerHTML = '<p class="page__loading">加载中…</p>';
    try {
      const data = await getMods();
      const releases = Array.isArray(data.releases) ? data.releases : [];
      if (summaryEl) {
        summaryEl.textContent = data.current ? `共 ${releases.length} 个版本，当前生效 ${data.current}` : `共 ${releases.length} 个版本，未设置生效版本`;
      }
      if (!listEl) return;
      if (releases.length === 0) {
        listEl.innerHTML = '<p class="page__empty">还没有发布。出包后把整包 zip 上传即可。</p>';
        return;
      }

      listEl.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th scope="col">发布目录</th>
              <th scope="col">版本</th>
              <th scope="col">客户端版本</th>
              <th scope="col">热更新 / 重启</th>
              <th scope="col">状态</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            ${releases
              .map(
                (release) => `
              <tr>
                <td class="table__cell-mono">${escapeHtml(release.id)}</td>
                <td>${escapeHtml(release.version || '')}</td>
                <td>${escapeHtml(release.clientVersion || '')}</td>
                <td>${Number(release.hotCount) || 0} / ${Number(release.bootCount) || 0}</td>
                <td>${
                  release.current
                    ? '<span class="tag tag--ok">生效中</span>'
                    : '<span class="tag tag--muted">未生效</span>'
                }${release.force ? ' <span class="tag tag--warn">强制</span>' : ''}</td>
                <td class="table__cell-actions">
                  ${
                    release.current
                      ? ''
                      : `<button type="button" class="btn btn--small btn--primary" data-action="activate" data-release="${escapeHtml(release.id)}">切换生效</button>`
                  }
                  <button type="button" class="btn btn--small" data-action="preview" data-release="${escapeHtml(release.id)}">预览清单</button>
                  ${
                    release.current
                      ? ''
                      : `<button type="button" class="btn btn--small btn--danger" data-action="delete" data-release="${escapeHtml(release.id)}">删除</button>`
                  }
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      if (listEl) listEl.innerHTML = `<p class="page__empty">加载失败：${escapeHtml(err.message)}</p>`;
    }
  };

  const showPreview = async (release) => {
    if (!previewEl) return;
    if (previewCard) previewCard.hidden = false;
    previewEl.innerHTML = '<p class="page__loading">计算中…</p>';
    try {
      const data = await previewMod(release);
      const files = Array.isArray(data.files) ? data.files : [];
      if (previewSummary) {
        previewSummary.textContent = `${data.release}：${files.length} 个文件，共 ${formatSize(data.totalBytes)}`;
      }
      if (files.length === 0) {
        // 空清单在客户端是安全但无效的更新，明确提示不要这样发
        previewEl.innerHTML = '<p class="page__empty">该版本没有热更新文件（CacheAssets 为空），客户端不会下载任何内容。</p>';
        return;
      }
      previewEl.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th scope="col">文件名</th>
              <th scope="col">大小</th>
              <th scope="col">哈希（前 12 位）</th>
            </tr>
          </thead>
          <tbody>
            ${files
              .map(
                (file) => `
              <tr>
                <td class="table__cell-mono">${escapeHtml(file.name)}</td>
                <td>${formatSize(file.size)}</td>
                <td class="table__cell-mono">${escapeHtml(shortHash(file.hash))}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      previewEl.innerHTML = `<p class="page__empty">预览失败：${escapeHtml(err.message)}</p>`;
    }
  };

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const release = button.dataset.release || '';

    if (action === 'refresh') {
      load();
      return;
    }

    if (action === 'publish') {
      const fileEl = q('[data-role="mod-file"]');
      const file = fileEl && fileEl.files ? fileEl.files[0] : null;
      if (!file) {
        say('请先选择整包 zip', true);
        return;
      }
      button.disabled = true;
      say('上传中，按包大小可能需要一两分钟…');
      try {
        const result = await publishMod(file, {
          release: q('[data-role="mod-release"]')?.value?.trim() || '',
          clientVersion: q('[data-role="mod-client-version"]')?.value?.trim() || '',
          announcement: q('[data-role="mod-announcement"]')?.value?.trim() || '',
          force: Boolean(q('[data-role="mod-force"]')?.checked),
          activate: Boolean(q('[data-role="mod-activate"]')?.checked),
        });
        const data = result.data || {};
        say(`发布成功：${data.releaseId || ''}  热更新 ${data.hotCount ?? 0} 个文件`);
        if (fileEl) fileEl.value = '';
        load();
      } catch (err) {
        say(err.message, true);
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === 'activate') {
      if (!window.confirm(`把「${release}」设为当前生效版本？客户端下次检查更新会立刻拿到它。`)) return;
      button.disabled = true;
      try {
        await activateMod(release);
        say(`已切换生效版本：${release}`);
        load();
      } catch (err) {
        say(err.message, true);
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === 'preview') {
      showPreview(release);
      return;
    }

    if (action === 'delete') {
      if (!window.confirm(`确定删除发布「${release}」？该版本目录会整个删除，不可恢复。`)) return;
      button.disabled = true;
      try {
        await deleteMod(release);
        say(`已删除发布：${release}`);
        load();
      } catch (err) {
        say(err.message, true);
      } finally {
        button.disabled = false;
      }
    }
  });

  load();
}
