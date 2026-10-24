/**
 * 社区谱面：本服务器已发布的条目 + 上游 rhythm.cafe 搜索。
 *
 * 三个入口各管一件事，互不混淆：
 *   本服务器已发布 —— 只看本库，可下载、下架；
 *   上游           —— 实时搜上游，可直链下载，也可抓进本机并发布；
 *   上传并发布     —— 本机文件上传后立刻发布，元数据手填。
 */

import { escapeHtml } from './utils.js';
import {
  getLevels,
  searchUpstreamLevels,
  publishLevel,
  deleteLevel,
  downloadLevel,
  startBrowserDownload,
  uploadChart,
} from './api.js';

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(value));
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 作者、标签可能是数组也可能是空 */
function joinList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join('、');
  if (typeof value === 'string') return value;
  return '';
}

function difficultyText(value) {
  if (value == null || value === '') return '';
  return String(value);
}

export function renderLevels(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="page">
      <div class="page__head">
        <div>
          <h2 class="page__title">社区谱面</h2>
          <p class="page__desc">
            「本服务器已发布」是玩家在游戏内社区页能看到的条目；「上游」只做实时查询与抓取。
            上传谱面文件本身不等于发布，两者分开处理。
          </p>
        </div>
      </div>

      <div class="tabs" role="tablist">
        <button type="button" class="tab tab--active" role="tab" data-tab="local" aria-selected="true">本服务器已发布</button>
        <button type="button" class="tab" role="tab" data-tab="upstream" aria-selected="false">上游 rhythm.cafe</button>
        <button type="button" class="tab" role="tab" data-tab="publish" aria-selected="false">上传并发布</button>
      </div>

      <section class="card" data-panel="local">
        <div class="card__head">
          <h3 class="card__title">已发布条目</h3>
          <span class="card__meta" data-role="local-summary"></span>
        </div>
        <div class="form-row">
          <input type="search" class="input" placeholder="按曲名 / 曲师 / 上传者筛选" data-role="local-q" />
          <button type="button" class="btn" data-action="local-search">筛选</button>
          <button type="button" class="btn" data-action="local-refresh">刷新</button>
        </div>
        <p class="form-message" data-role="local-message" aria-live="polite"></p>
        <div data-role="local-list"><p class="page__loading">加载中…</p></div>
        <div class="pager">
          <button type="button" class="btn btn--small" data-action="local-prev">上一页</button>
          <span class="pager__info" data-role="local-page">第 1 页</span>
          <button type="button" class="btn btn--small" data-action="local-next">下一页</button>
        </div>
      </section>

      <section class="card" data-panel="upstream" hidden>
        <div class="card__head">
          <h3 class="card__title">上游 rhythm.cafe</h3>
          <span class="card__meta" data-role="up-summary"></span>
        </div>
        <div class="form-row">
          <input type="search" class="input" placeholder="曲名 / 曲师 / 作者" data-role="up-q" />
          <button type="button" class="btn btn--primary" data-action="up-search">搜索</button>
        </div>
        <p class="form-hint">搜索结果来自上游实时接口，不代表本库已有；「发布到本库」会把包抓到本服务器再入库。</p>
        <p class="form-message" data-role="up-message" aria-live="polite"></p>
        <div data-role="up-list"><p class="page__empty">输入关键词后点搜索。</p></div>
        <div class="pager">
          <button type="button" class="btn btn--small" data-action="up-prev">上一页</button>
          <span class="pager__info" data-role="up-page">第 1 页</span>
          <button type="button" class="btn btn--small" data-action="up-next">下一页</button>
        </div>
      </section>

      <section class="card" data-panel="publish" hidden>
        <h3 class="card__title">上传并发布</h3>
        <div class="form-grid">
          <label class="form-field">
            <span class="form-field__label">谱面文件</span>
            <input type="file" class="input" accept=".rdzip,.zip,.rdlevel" data-role="pub-file" />
          </label>
          <label class="form-field">
            <span class="form-field__label">曲名</span>
            <input type="text" class="input" data-role="pub-song" />
          </label>
          <label class="form-field">
            <span class="form-field__label">曲师</span>
            <input type="text" class="input" data-role="pub-artist" />
          </label>
          <label class="form-field">
            <span class="form-field__label">谱师（多个用逗号隔开）</span>
            <input type="text" class="input" data-role="pub-authors" />
          </label>
          <label class="form-field">
            <span class="form-field__label">难度</span>
            <input type="number" class="input" min="0" step="1" data-role="pub-difficulty" />
          </label>
          <label class="form-field">
            <span class="form-field__label">描述</span>
            <input type="text" class="input" data-role="pub-description" />
          </label>
        </div>
        <div class="form-row">
          <button type="button" class="btn btn--primary" data-action="pub-submit">上传并发布</button>
        </div>
        <p class="form-message" data-role="pub-message" aria-live="polite"></p>
      </section>
    </div>
  `;

  const q = (selector) => container.querySelector(selector);

  const localList = q('[data-role="local-list"]');
  const localSummary = q('[data-role="local-summary"]');
  const localMessage = q('[data-role="local-message"]');
  const localPageEl = q('[data-role="local-page"]');
  const localQ = q('[data-role="local-q"]');

  const upList = q('[data-role="up-list"]');
  const upSummary = q('[data-role="up-summary"]');
  const upMessage = q('[data-role="up-message"]');
  const upPageEl = q('[data-role="up-page"]');
  const upQ = q('[data-role="up-q"]');

  const pubMessage = q('[data-role="pub-message"]');

  const state = {
    localPage: 1,
    localTotal: 0,
    upPage: 1,
    upTotal: 0,
    upKeyword: '',
    upHits: [],
    upLoaded: false,
  };

  const say = (el, text, isError) => {
    if (!el) return;
    el.textContent = text || '';
    el.className = isError ? 'form-message form-message--error' : 'form-message';
  };

  // ---------------- 本服务器已发布 ----------------

  const loadLocal = async () => {
    if (localList) localList.innerHTML = '<p class="page__loading">加载中…</p>';
    try {
      const data = await getLevels({ page: state.localPage, perPage: 20, q: localQ?.value?.trim() || '' });
      const list = Array.isArray(data.list) ? data.list : [];
      state.localTotal = Number(data.total) || 0;
      if (localSummary) localSummary.textContent = `共 ${state.localTotal} 条`;
      if (localPageEl) localPageEl.textContent = `第 ${state.localPage} 页`;

      if (!localList) return;
      if (list.length === 0) {
        localList.innerHTML = '<p class="page__empty">本库还没有发布条目。可以在「上游」或「上传并发布」里发布。</p>';
        return;
      }

      localList.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th scope="col">曲名</th>
              <th scope="col">曲师</th>
              <th scope="col">谱师</th>
              <th scope="col">难度</th>
              <th scope="col">上传者</th>
              <th scope="col">时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            ${list
              .map(
                (row) => `
              <tr>
                <td>${escapeHtml(row.song || row.id)}</td>
                <td>${escapeHtml(row.artist || '')}</td>
                <td>${escapeHtml(joinList(row.authors))}</td>
                <td>${escapeHtml(difficultyText(row.difficulty))}</td>
                <td>${escapeHtml(row.uploader || '')}</td>
                <td>${formatTime(row.created_at)}</td>
                <td class="table__cell-actions">
                  <button type="button" class="btn btn--small" data-action="level-download" data-id="${escapeHtml(row.id)}"${row.chartName ? '' : ' disabled title="谱面不在本机"'}>下载</button>
                  <button type="button" class="btn btn--small btn--danger" data-action="level-delete" data-id="${escapeHtml(row.id)}">下架</button>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      if (localList) localList.innerHTML = `<p class="page__empty">加载失败：${escapeHtml(err.message)}</p>`;
    }
  };

  // ---------------- 上游 ----------------

  const searchUp = async () => {
    if (upList) upList.innerHTML = '<p class="page__loading">搜索中…</p>';
    say(upMessage, '');
    try {
      const data = await searchUpstreamLevels({
        q: upQ?.value?.trim() || '',
        page: state.upPage,
        perPage: 20,
      });
      const hits = Array.isArray(data.hits) ? data.hits : [];
      state.upHits = hits;
      state.upTotal = Number(data.found) || 0;
      if (upSummary) upSummary.textContent = `上游命中 ${state.upTotal} 条`;
      if (upPageEl) upPageEl.textContent = `第 ${state.upPage} 页`;

      if (!upList) return;
      if (hits.length === 0) {
        upList.innerHTML = '<p class="page__empty">没有匹配的谱面。</p>';
        return;
      }

      upList.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th scope="col">曲名</th>
              <th scope="col">曲师</th>
              <th scope="col">谱师</th>
              <th scope="col">难度</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            ${hits
              .map(
                (hit, index) => `
              <tr>
                <td>${escapeHtml(hit.song || hit.id)}</td>
                <td>${escapeHtml(hit.artist || '')}</td>
                <td>${escapeHtml(joinList(hit.authors))}</td>
                <td>${escapeHtml(difficultyText(hit.difficulty))}</td>
                <td class="table__cell-actions">
                  <button type="button" class="btn btn--small" data-action="up-download" data-up-id="${escapeHtml(hit.id)}">下载</button>
                  <button type="button" class="btn btn--small btn--primary" data-action="up-publish" data-index="${index}">发布到本库</button>
                </td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      if (upList) upList.innerHTML = `<p class="page__empty">搜索失败：${escapeHtml(err.message)}</p>`;
    }
  };

  // ---------------- 上传并发布 ----------------

  const publishFromFile = async (button) => {
    const fileEl = q('[data-role="pub-file"]');
    const file = fileEl && fileEl.files ? fileEl.files[0] : null;
    if (!file) {
      say(pubMessage, '请先选择谱面文件', true);
      return;
    }
    button.disabled = true;
    say(pubMessage, '上传中…');
    try {
      const uploaded = await uploadChart(file);
      const chartName = uploaded.data?.name || '';
      say(pubMessage, '已上传，正在发布…');
      const authorsRaw = q('[data-role="pub-authors"]')?.value?.trim() || '';
      const difficultyRaw = q('[data-role="pub-difficulty"]')?.value?.trim() || '';
      await publishLevel({
        chartName,
        song: q('[data-role="pub-song"]')?.value?.trim() || file.name,
        artist: q('[data-role="pub-artist"]')?.value?.trim() || '',
        authors: authorsRaw ? authorsRaw.split(/[,，]/).map((v) => v.trim()).filter(Boolean) : [],
        difficulty: difficultyRaw ? Number(difficultyRaw) : null,
        description: q('[data-role="pub-description"]')?.value?.trim() || '',
        source: 'admin',
      });
      say(pubMessage, `已发布：${chartName}`);
      if (fileEl) fileEl.value = '';
      state.localPage = 1;
      loadLocal();
    } catch (err) {
      say(pubMessage, err.message, true);
    } finally {
      button.disabled = false;
    }
  };

  // ---------------- 事件 ----------------

  container.addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      const name = tab.dataset.tab;
      container.querySelectorAll('[data-tab]').forEach((el) => {
        const active = el === tab;
        el.classList.toggle('tab--active', active);
        el.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      container.querySelectorAll('[data-panel]').forEach((el) => {
        el.hidden = el.dataset.panel !== name;
      });
      // 不填关键词就是「上游有什么都列出来」：第一次进这页就自动拉一页
      if (name === 'upstream' && !state.upLoaded) {
        state.upLoaded = true;
        searchUp();
      }
      return;
    }

    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;

    if (action === 'local-refresh' || action === 'local-search') {
      if (action === 'local-search') state.localPage = 1;
      loadLocal();
      return;
    }
    if (action === 'local-prev') {
      if (state.localPage > 1) {
        state.localPage -= 1;
        loadLocal();
      }
      return;
    }
    if (action === 'local-next') {
      if (state.localPage * 20 < state.localTotal) {
        state.localPage += 1;
        loadLocal();
      }
      return;
    }

    if (action === 'level-download') {
      try {
        await downloadLevel(button.dataset.id);
      } catch (err) {
        say(localMessage, err.message, true);
      }
      return;
    }

    if (action === 'level-delete') {
      const id = button.dataset.id;
      // 默认只删条目、留文件：房间里可能正在用同一份包
      const purge = window.confirm(
        `确定下架条目「${id}」？\n\n点「确定」只删除条目，谱面文件保留。\n如需连文件一起删，请在谱面库页单独删除。`
      );
      if (!purge) return;
      button.disabled = true;
      try {
        await deleteLevel(id, false);
        say(localMessage, `已下架：${id}`);
        loadLocal();
      } catch (err) {
        say(localMessage, err.message, true);
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === 'up-search') {
      state.upPage = 1;
      state.upLoaded = true;
      searchUp();
      return;
    }
    if (action === 'up-prev') {
      if (state.upPage > 1) {
        state.upPage -= 1;
        searchUp();
      }
      return;
    }
    if (action === 'up-next') {
      if (state.upPage * 20 < state.upTotal) {
        state.upPage += 1;
        searchUp();
      }
      return;
    }

    if (action === 'up-download') {
      // 直连上游 CDN：包不经过这台服务器，浏览器直接下到本机
      const hit = state.upHits.find((h) => h.id === button.dataset.upId);
      const url = hit?.rdzipUrl;
      if (!url) {
        say(upMessage, '这条记录没有可用的直链', true);
        return;
      }
      startBrowserDownload(url);
      say(upMessage, '已开始下载，浏览器直连上游 CDN');
      return;
    }

    if (action === 'up-publish') {
      const hit = state.upHits[Number(button.dataset.index)];
      if (!hit) return;
      if (!window.confirm(`把上游谱面「${hit.song || hit.id}」抓取到本服务器并发布？`)) return;
      button.disabled = true;
      say(upMessage, '抓取并发布中，大包可能需要几十秒…');
      try {
        await publishLevel({
          upstreamId: hit.id,
          song: hit.song || hit.id,
          artist: hit.artist || '',
          authors: Array.isArray(hit.authors) ? hit.authors : [],
          difficulty: hit.difficulty ?? null,
          image: hit.image || '',
          minBpm: hit.min_bpm ?? null,
          maxBpm: hit.max_bpm ?? null,
          tags: Array.isArray(hit.tags) ? hit.tags : [],
          description: hit.description || '',
          url2: hit.url2 || '',
          source: 'rhythm.cafe',
        });
        say(upMessage, `已发布：${hit.song || hit.id}`);
        loadLocal();
      } catch (err) {
        say(upMessage, err.message, true);
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === 'pub-submit') {
      publishFromFile(button);
    }
  });

  loadLocal();
}
