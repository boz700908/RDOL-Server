/**
 * 谱面库：CHART_DIR 里的谱面包文件。
 *
 * 这一页管的是「磁盘上的包」，和社区谱面（数据库条目）是两件事：
 * 房间可以直接用这里的文件，但只有发布成社区条目才会出现在游戏内的社区页。
 */

import { escapeHtml } from './utils.js';
import { getCharts, uploadChart, deleteChart, downloadChart } from './api.js';

/** 1024 进制换算，和系统里看到的文件大小一致 */
function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 被引用情况：房间在用、已发布成社区条目，都是不能直接删的信号 */
function describeRefs(file) {
  const parts = [];
  if (Array.isArray(file.levels) && file.levels.length > 0) {
    parts.push(`社区条目 ${file.levels.map(escapeHtml).join('、')}`);
  }
  if (Array.isArray(file.rooms) && file.rooms.length > 0) {
    parts.push(`房间 ${file.rooms.map(escapeHtml).join('、')}`);
  }
  if (parts.length === 0) return '<span class="tag tag--muted">未引用</span>';
  return `<span class="tag tag--warn">${parts.join('；')}</span>`;
}

export async function renderCharts(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="page">
      <div class="page__head">
        <div>
          <h2 class="page__title">谱面库</h2>
          <p class="page__desc">服务器 <code>charts/</code> 目录里的谱面包。上传后可被房间直接选用，发布成社区条目需到「社区谱面」页。</p>
        </div>
        <div class="page__actions">
          <button type="button" class="btn" data-action="refresh">刷新</button>
        </div>
      </div>

      <div class="card">
        <h3 class="card__title">上传谱面</h3>
        <div class="form-row">
          <input type="file" id="chart-file" class="input" accept=".rdzip,.zip,.rdlevel" />
          <button type="button" class="btn btn--primary" data-action="upload">上传</button>
        </div>
        <p class="form-hint">支持 .rdzip / .zip / .rdlevel，落盘名会自动加时间戳前缀以保证地址唯一。</p>
        <p class="form-message" data-role="message" aria-live="polite"></p>
      </div>

      <div class="card">
        <div class="card__head">
          <h3 class="card__title">文件列表</h3>
          <span class="card__meta" data-role="summary"></span>
        </div>
        <div data-role="list"><p class="page__loading">加载中…</p></div>
      </div>
    </div>
  `;

  const listEl = container.querySelector('[data-role="list"]');
  const summaryEl = container.querySelector('[data-role="summary"]');
  const messageEl = container.querySelector('[data-role="message"]');
  const fileEl = container.querySelector('#chart-file');

  const setMessage = (text, isError) => {
    if (!messageEl) return;
    messageEl.textContent = text || '';
    messageEl.className = isError ? 'form-message form-message--error' : 'form-message';
  };

  const load = async () => {
    if (listEl) listEl.innerHTML = '<p class="page__loading">加载中…</p>';
    try {
      const data = await getCharts();
      const files = Array.isArray(data.files) ? data.files : [];
      if (summaryEl) {
        summaryEl.textContent = `${files.length} 个文件，共 ${formatSize(data.totalBytes)}`;
      }
      if (!listEl) return;
      if (files.length === 0) {
        listEl.innerHTML = '<p class="page__empty">还没有谱面文件。房间用的包在上传后会出现在这里。</p>';
        return;
      }

      listEl.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th scope="col">文件名</th>
              <th scope="col">大小</th>
              <th scope="col">上传时间</th>
              <th scope="col">引用情况</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            ${files
              .map(
                (file) => `
              <tr>
                <td class="table__cell-mono">${escapeHtml(file.name)}</td>
                <td>${formatSize(file.size)}</td>
                <td>${escapeHtml(formatTime(file.mtime))}</td>
                <td>${describeRefs(file)}</td>
                <td class="table__cell-actions">
                  <button type="button" class="btn btn--small" data-action="download" data-name="${escapeHtml(file.name)}">下载</button>
                  <button type="button" class="btn btn--small btn--danger" data-action="delete" data-name="${escapeHtml(file.name)}">删除</button>
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

  container.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const name = button.dataset.name;

    if (action === 'refresh') {
      load();
      return;
    }

    if (action === 'upload') {
      const file = fileEl && fileEl.files ? fileEl.files[0] : null;
      if (!file) {
        setMessage('请先选择文件', true);
        return;
      }
      button.disabled = true;
      setMessage('上传中…');
      try {
        const result = await uploadChart(file);
        setMessage(`已上传：${result.data?.name || file.name}`);
        if (fileEl) fileEl.value = '';
        load();
      } catch (err) {
        setMessage(err.message, true);
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === 'download') {
      try {
        await downloadChart(name);
      } catch (err) {
        setMessage(err.message, true);
      }
      return;
    }

    if (action === 'delete') {
      // 删文件是不可恢复的，确认框里把文件名写全，避免误点
      if (!window.confirm(`确定删除谱面文件「${name}」？此操作不可恢复。`)) return;
      button.disabled = true;
      try {
        await deleteChart(name);
        setMessage(`已删除：${name}`);
        load();
      } catch (err) {
        setMessage(err.message, true);
      } finally {
        button.disabled = false;
      }
    }
  });

  load();
}
