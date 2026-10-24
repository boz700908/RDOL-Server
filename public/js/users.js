/**
 * 用户管理：列出全部注册账号，可改角色、强制下线、删号。
 *
 * 「在线」和「所在房间」都取服务端内存状态，所以每次操作后都要重拉列表。
 */

import { escapeHtml } from './utils.js';
import { getUsers, setUserRole, kickUser, deleteUser } from './api.js';

const PER_PAGE = 20;
const state = { page: 1, q: '', total: 0, list: [] };

function formatTime(iso) {
  if (!iso) return '';
  // SQLite 存的是 "YYYY-MM-DD HH:MM:SS"（UTC），浏览器按本地时区显示
  const normalized = String(iso).includes('T') ? iso : String(iso).replace(' ', 'T') + 'Z';
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return escapeHtml(String(iso));
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function roleTag(role) {
  return Number(role) >= 2
    ? '<span class="tag tag--ok">管理员</span>'
    : '<span class="tag tag--muted">普通用户</span>';
}

function roomCell(row) {
  if (row.room) {
    return `${escapeHtml(row.room.name)} <span class="tag tag--muted">${escapeHtml(row.room.id)}</span>`;
  }
  return '<span class="tag tag--muted">不在房间</span>';
}

function rowsHtml() {
  if (state.list.length === 0) {
    return '<tr><td colspan="7" class="table__empty">没有匹配的账号</td></tr>';
  }
  return state.list.map((u) => {
    const isAdmin = Number(u.role) >= 2;
    return `
      <tr>
        <td>${u.id}</td>
        <td>${escapeHtml(u.username)}</td>
        <td>${escapeHtml(u.email || '—')}</td>
        <td>${roleTag(u.role)}</td>
        <td>${u.online ? '<span class="tag tag--ok">在线</span>' : '<span class="tag tag--muted">离线</span>'}</td>
        <td>${roomCell(u)}</td>
        <td class="table__actions">
          <button type="button" class="btn btn--sm" data-action="role" data-id="${u.id}" data-role="${isAdmin ? 1 : 2}">${isAdmin ? '取消管理员' : '设为管理员'}</button>
          <button type="button" class="btn btn--sm" data-action="kick" data-id="${u.id}" data-name="${escapeHtml(u.username)}"${u.online ? '' : ' disabled'}>强制下线</button>
          <button type="button" class="btn btn--sm btn--danger" data-action="delete" data-id="${u.id}" data-name="${escapeHtml(u.username)}"${u.online ? ' disabled title="先强制下线再删除"' : ''}>删除</button>
        </td>
      </tr>`;
  }).join('');
}

export async function renderUsers(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="page">
      <div class="page__head">
        <div>
          <h2 class="page__title">用户</h2>
          <p class="page__desc">全部注册账号。强制下线只断连接，删号要求账号离线。</p>
        </div>
        <div class="page__actions">
          <button type="button" class="btn" data-action="refresh">刷新</button>
        </div>
      </div>

      <div class="card">
        <div class="form-row">
          <input type="search" class="input" id="users-q" placeholder="按账号或邮箱搜索" aria-label="搜索账号" />
          <button type="button" class="btn btn--primary" data-action="search">搜索</button>
        </div>
        <p class="page__desc" id="users-message" aria-live="polite"></p>
      </div>

      <div class="card">
        <table class="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>账号</th>
              <th>邮箱</th>
              <th>角色</th>
              <th>状态</th>
              <th>所在房间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="users-tbody"></tbody>
        </table>
        <div class="pager">
          <button type="button" class="btn" data-action="prev">上一页</button>
          <span class="pager__info" id="users-pager">第 1 页</span>
          <button type="button" class="btn" data-action="next">下一页</button>
        </div>
      </div>
    </div>
  `;

  const tbody = container.querySelector('#users-tbody');
  const pagerEl = container.querySelector('#users-pager');
  const messageEl = container.querySelector('#users-message');
  const searchEl = container.querySelector('#users-q');

  function setMessage(text, isError) {
    messageEl.textContent = text || '';
    messageEl.className = isError ? 'page__desc page__desc--error' : 'page__desc';
  }

  async function load() {
    setMessage('');
    try {
      const data = await getUsers({ page: state.page, perPage: PER_PAGE, q: state.q });
      state.list = data.list || [];
      state.total = Number(data.total) || 0;
      tbody.innerHTML = rowsHtml();
      const pages = Math.max(1, Math.ceil(state.total / PER_PAGE));
      pagerEl.textContent = `第 ${state.page} / ${pages} 页，共 ${state.total} 个账号`;
      container.querySelector('[data-action="prev"]').disabled = state.page <= 1;
      container.querySelector('[data-action="next"]').disabled = state.page >= pages;
    } catch (err) {
      tbody.innerHTML = '';
      setMessage(err.message || '加载失败', true);
    }
  }

  container.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    const name = btn.dataset.name || '';

    if (action === 'refresh') {
      await load();
      return;
    }
    if (action === 'search') {
      state.q = searchEl.value.trim();
      state.page = 1;
      await load();
      return;
    }
    if (action === 'prev' || action === 'next') {
      state.page += action === 'prev' ? -1 : 1;
      await load();
      return;
    }

    btn.disabled = true;
    try {
      if (action === 'role') {
        const res = await setUserRole(id, Number(btn.dataset.role));
        setMessage(res.message || '已修改角色', false);
      } else if (action === 'kick') {
        if (!window.confirm(`确认把 ${name} 强制下线？`)) return;
        const res = await kickUser(id);
        setMessage(res.message || '已强制下线', false);
      } else if (action === 'delete') {
        if (!window.confirm(`确认删除账号 ${name}？该操作不可撤销。`)) return;
        const res = await deleteUser(id);
        setMessage(res.message || '已删除', false);
      }
      await load();
    } catch (err) {
      setMessage(err.message || '操作失败', true);
      btn.disabled = false;
    }
  });

  searchEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      state.q = searchEl.value.trim();
      state.page = 1;
      load();
    }
  });

  await load();
}
