/**
 * 房间列表视图：渲染房间表格与刷新、创建房间
 */

import { escapeHtml } from './utils.js';
import { getUsers } from './api.js';

/**
 * 渲染房间列表
 * @param {HTMLElement} container - #room-list-view
 * @param {Array} rooms
 * @param {(roomId: string) => void} onSelectRoom - 点击房间时的回调
 * @param {(data: { name: string, maxPlayers: number, password?: string|null, chartUrl: string, chartName: string }) => Promise<{ roomId: string, room: object }>} [onCreateRoom] - 创建房间回调
 */
export function renderRoomList(container, rooms, onSelectRoom, onCreateRoom) {
  if (!container) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'room-list__toolbar';
  toolbar.innerHTML = `
    <div>
      <h2 class="room-list__title">房间列表</h2>
      <p class="room-list__hint">实时推送，也可点击刷新</p>
    </div>
    <div class="room-list__actions">
      ${onCreateRoom ? '<button type="button" class="room-list__create" id="room-list-create">创建房间</button>' : ''}
      <button type="button" class="room-list__refresh" id="room-list-refresh">刷新</button>
    </div>
  `;

  let createWrap = null;
  if (onCreateRoom) {
    createWrap = document.createElement('div');
    createWrap.className = 'room-list__create-wrap room-list__create-wrap--hidden';
    createWrap.id = 'room-list-create-wrap';
    createWrap.innerHTML = `
      <h3 class="room-list__create-title">新建房间</h3>
      <form class="room-list__create-form" id="room-list-create-form">
        <label>房主账号 <select name="ownerId" id="room-list-create-owner" required><option value="">加载中…</option></select></label>
        <label>房间名称 <input type="text" name="name" required placeholder="必填" /></label>
        <label>最大人数 (1–120) <input type="number" name="maxPlayers" min="1" max="120" value="8" /></label>
        <label>密码（选填，留空无密码） <input type="text" name="password" placeholder="选填" /></label>
        <label>谱面 URL <input type="text" name="chartUrl" required placeholder="必填" /></label>
        <label>谱面名称 <input type="text" name="chartName" required placeholder="必填" /></label>
        <p class="room-list__create-message" id="room-list-create-message" aria-live="polite"></p>
        <div class="room-list__create-btns">
          <button type="submit" class="room-list__btn room-list__btn--submit">创建</button>
          <button type="button" class="room-list__btn room-list__btn--cancel" id="room-list-create-cancel">取消</button>
        </div>
      </form>
    `;
    const ownerSelect = createWrap.querySelector('#room-list-create-owner');
    const ownerHint = document.createElement('p');
    ownerHint.className = 'room-list__create-message';
    ownerSelect.insertAdjacentElement('afterend', ownerHint);
    getUsers({ page: 1, perPage: 100 })
      .then((data) => {
        const list = (data && data.list) || [];
        if (list.length === 0) {
          ownerSelect.innerHTML = '<option value="">库里还没有账号</option>';
          ownerSelect.disabled = true;
          return;
        }
        ownerSelect.innerHTML = '<option value="">请选择房主</option>' + list
          .map((u) => `<option value="${u.id}">${escapeHtml(u.username)}${u.online ? '（在线）' : ''}</option>`)
          .join('');
      })
      .catch((err) => {
        ownerSelect.innerHTML = '<option value="">加载失败</option>';
        ownerHint.textContent = err.message || '账号列表加载失败';
      });

    const createBtn = toolbar.querySelector('#room-list-create');
    const form = createWrap.querySelector('#room-list-create-form');
    const messageEl = createWrap.querySelector('#room-list-create-message');
    createBtn.addEventListener('click', () => {
      createWrap.classList.toggle('room-list__create-wrap--hidden');
      messageEl.textContent = '';
    });
    createWrap.querySelector('#room-list-create-cancel').addEventListener('click', () => {
      createWrap.classList.add('room-list__create-wrap--hidden');
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const ownerId = Number(fd.get('ownerId'));
      if (!ownerId) {
        messageEl.textContent = '请先选择房主账号';
        messageEl.className = 'room-list__create-message room-list__create-message--error';
        return;
      }
      const name = fd.get('name')?.toString().trim() ?? '';
      const maxPlayers = Math.min(120, Math.max(1, parseInt(fd.get('maxPlayers'), 10) || 8));
      const password = fd.get('password')?.toString().trim() ?? '';
      const chartUrl = fd.get('chartUrl')?.toString().trim() ?? '';
      const chartName = fd.get('chartName')?.toString().trim() ?? '';
      messageEl.textContent = '';
      messageEl.className = 'room-list__create-message';
      try {
        const res = await onCreateRoom({ ownerId, name, maxPlayers, password: password || null, chartUrl, chartName });
        messageEl.textContent = '创建成功，正在跳转…';
        messageEl.className = 'room-list__create-message room-list__create-message--success';
        window.location.hash = `#/rooms/${res.roomId}`;
      } catch (err) {
        messageEl.textContent = err.message || '创建失败';
        messageEl.className = 'room-list__create-message room-list__create-message--error';
      }
    });
  }

  let content;
  if (!rooms || rooms.length === 0) {
    content = document.createElement('p');
    content.className = 'room-list__empty';
    content.textContent = '当前没有房间';
  } else {
    content = document.createElement('table');
    content.className = 'room-table';
    content.innerHTML = `
      <thead>
        <tr>
          <th>房间名</th>
          <th>人数</th>
          <th>状态</th>
          <th>房主</th>
          <th>谱面</th>
        </tr>
      </thead>
      <tbody>
        ${rooms
          .map(
            (r) => `
          <tr data-room-id="${escapeHtml(r.id)}">
            <td><a href="#/rooms/${escapeHtml(r.id)}" class="room-table__link" data-room-id="${escapeHtml(r.id)}">${escapeHtml(r.name)}</a></td>
            <td>${r.playerCount} / ${r.maxPlayers}</td>
            <td><span class="room-table__status room-table__status--${r.status}">${r.status === 'waiting' ? '等待中' : '游戏中'}</span></td>
            <td>${r.ownerUsername ? escapeHtml(r.ownerUsername) : '—'}${r.ownerId ? ` <span class="tag tag--muted">ID ${r.ownerId}</span>` : ''}</td>
            <td>${escapeHtml(r.chartName)}</td>
          </tr>
        `
          )
          .join('')}
      </tbody>
    `;

    content.querySelectorAll('.room-table__link, tr[data-room-id]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const id = el.getAttribute('data-room-id');
        if (id) onSelectRoom(id);
      });
    });
  }

  container.innerHTML = '';
  container.appendChild(toolbar);
  if (createWrap) container.appendChild(createWrap);
  container.appendChild(content);
}

/**
 * 绑定房间列表上的刷新按钮
 * @param {HTMLElement} container - #room-list-view
 * @param {() => void} onRefresh
 */
export function bindRoomListRefresh(container, onRefresh) {
  if (!container) return;
  const btn = container.querySelector('#room-list-refresh');
  if (btn) btn.addEventListener('click', onRefresh);
}
