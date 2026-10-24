/**
 * 房间详情视图：参考图布局 — 左侧主内容（房间信息/谱面/聊天），右侧玩家列表；深色主题
 */

import { escapeHtml } from './utils.js';
import { deleteRoom } from './api.js';

function playerAvatarHtml(p) {
  const src = p.avatar && p.avatar.trim() ? escapeHtml(p.avatar) : '';
  if (src) {
    return `<img class="room-detail__player-avatar" src="${src}" alt="" onerror="this.classList.add('room-detail__player-avatar--hide')" />`;
  }
  return `<span class="room-detail__player-avatar room-detail__player-avatar--letter">${escapeHtml((p.username || '?')[0])}</span>`;
}

function playerItemHtml(p, ownerId) {
  const isOwner = p.userId === ownerId;
  return `
    <li class="room-detail__player" data-user-id="${p.userId}">
      ${playerAvatarHtml(p)}
      <div class="room-detail__player-info">
        <span class="room-detail__player-name">${escapeHtml(p.username)}${isOwner ? ' <span class="room-detail__owner-tag">房主</span>' : ''}</span>
        ${p.ready !== undefined ? `<span class="room-detail__player-ready room-detail__player-ready--${p.ready ? 'yes' : 'no'}">${p.ready ? '已准备' : '未准备'}</span>` : ''}
      </div>
      <div class="room-detail__player-actions">
        ${!isOwner ? `<button type="button" class="room-detail__player-btn room-detail__player-btn--owner" data-action="transfer" data-user-id="${p.userId}">设为房主</button>` : ''}
        <button type="button" class="room-detail__player-btn room-detail__player-btn--kick" data-action="kick" data-user-id="${p.userId}">移出</button>
      </div>
    </li>
  `;
}

/**
 * 渲染房间详情（参考图：左主右栏、深色、返回/修改、聊天、玩家列表；支持移出/转移房主）
 */
export function renderRoomDetail(container, room, players, onBack, onSave, onKick, onTransferOwner) {
  if (!container || !room) return;

  const ownerId = room.ownerId;
  const playersList = (players || []).map((p) => playerItemHtml(p, ownerId)).join('');
  const count = room.playerCount ?? 0;
  const max = room.maxPlayers ?? 8;
  const statusText = room.status === 'waiting' ? '等待中' : '游戏中';

  container.innerHTML = `
    <div class="room-detail-page">
      <div class="room-detail__main">
        <div class="room-detail__header-card">
          <div class="room-detail__header-info">
            <h2 class="room-detail__title">${escapeHtml(room.name)}</h2>
            <p class="room-detail__meta">
              <span class="room-detail__online"><span id="room-detail-player-count">${count}</span> 在线</span>
              <span class="room-detail__status-badge" id="room-detail-status">${statusText}</span>
              <span>人数 <span id="room-detail-count-text">${count}</span> / <span id="room-detail-max-text">${max}</span></span>
              <span>房主: ${room.ownerUsername ? escapeHtml(room.ownerUsername) : '—'}${room.ownerId ? `（ID ${room.ownerId}）` : ''}</span>
            </p>
          </div>
          <div class="room-detail__header-actions">
            <button type="button" class="room-detail__btn room-detail__btn--back" id="room-detail-back">← 返回</button>
            <button type="button" class="room-detail__btn room-detail__btn--modify" id="room-detail-modify">修改</button>
            <button type="button" class="room-detail__btn room-detail__btn--close" id="room-detail-close"${count > 0 ? ' disabled title="房间内还有玩家，先移出"' : ''}>关闭房间</button>
          </div>
        </div>

        <div class="room-detail__game-card">
          <div class="room-detail__game-poster"></div>
          <div class="room-detail__game-info">
            <span class="room-detail__game-label">谱面</span>
            <span class="room-detail__game-name">${escapeHtml(room.chartName || '—')}</span>
            ${room.chartUrl ? `<a href="${escapeHtml(room.chartUrl)}" target="_blank" rel="noopener" class="room-detail__game-link">打开链接</a>` : ''}
          </div>
        </div>

        <div class="room-detail__chat-card">
          <h3 class="room-detail__chat-title">聊天</h3>
          <ul class="room-detail__live" id="room-detail-live" aria-live="polite"></ul>
          <p class="room-detail__chat-hint">仅显示玩家聊天消息</p>
        </div>

        <div class="room-detail__edit-wrap room-detail__edit-wrap--hidden" id="room-detail-edit-wrap">
          <h3 class="room-detail__section-title">修改房间信息</h3>
          <form class="room-detail__form" id="room-detail-form">
            <label>房间名称 <input type="text" name="name" value="${escapeHtml(room.name ?? '')}" /></label>
            <label>最大人数 (1–120) <input type="number" name="maxPlayers" min="1" max="120" value="${room.maxPlayers ?? 8}" /></label>
            <label>密码（留空取消） <input type="text" name="password" value="${escapeHtml(room.password ?? '')}" placeholder="留空表示无密码" /></label>
            <label>谱面 URL <input type="text" name="chartUrl" value="${escapeHtml(room.chartUrl ?? '')}" /></label>
            <label>谱面名称 <input type="text" name="chartName" value="${escapeHtml(room.chartName ?? '')}" /></label>
            <button type="submit" class="room-detail__btn room-detail__btn--submit" id="room-detail-submit">保存</button>
            <p class="room-detail__message" id="room-detail-message" aria-live="polite"></p>
          </form>
        </div>
      </div>

      <aside class="room-detail__sidebar">
        <h3 class="room-detail__sidebar-title">玩家列表</h3>
        <p class="room-detail__sidebar-status" id="room-detail-sidebar-status" aria-live="polite"></p>
        <ul class="room-detail__players" id="room-detail-players-list">
          ${playersList || '<li class="room-detail__player room-detail__player--empty">暂无玩家</li>'}
        </ul>
      </aside>
    </div>
  `;

  container.querySelector('#room-detail-back').addEventListener('click', (e) => {
    e.preventDefault();
    onBack();
  });

  container.querySelector('#room-detail-close')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!confirm(`确定关闭房间「${room.name}」？`)) return;
    btn.disabled = true;
    try {
      await deleteRoom(room.id);
      window.location.hash = '#/rooms';
    } catch (err) {
      alert(err.message || '关闭失败');
      btn.disabled = false;
    }
  });

  const editWrap = container.querySelector('#room-detail-edit-wrap');
  container.querySelector('#room-detail-modify').addEventListener('click', () => {
    editWrap.classList.toggle('room-detail__edit-wrap--hidden');
  });

  const sidebarStatus = container.querySelector('#room-detail-sidebar-status');
  const setSidebarStatus = (text, isError) => {
    if (!sidebarStatus) return;
    sidebarStatus.textContent = text;
    sidebarStatus.className = 'room-detail__sidebar-status' + (isError ? ' room-detail__sidebar-status--error' : '');
    if (text) setTimeout(() => { sidebarStatus.textContent = ''; }, 3000);
  };

  container.querySelector('#room-detail-players-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.room-detail__player-btn');
    if (!btn || !onKick || !onTransferOwner) return;
    const userId = parseInt(btn.getAttribute('data-user-id'), 10);
    const action = btn.getAttribute('data-action');
    if (action === 'kick') {
      if (!confirm(`确定将玩家 ID:${userId} 移出房间？`)) return;
      btn.disabled = true;
      onKick(room.id, userId).then(() => setSidebarStatus('已移出', false)).catch((err) => {
        setSidebarStatus(err.message || '移出失败', true);
        btn.disabled = false;
      });
    } else if (action === 'transfer') {
      if (!confirm(`确定将 ID:${userId} 设为房主？`)) return;
      btn.disabled = true;
      onTransferOwner(room.id, userId).then(() => setSidebarStatus('房主已转移', false)).catch((err) => {
        setSidebarStatus(err.message || '转移失败', true);
        btn.disabled = false;
      });
    }
  });

  const form = container.querySelector('#room-detail-form');
  const messageEl = container.querySelector('#room-detail-message');
  const submitBtn = container.querySelector('#room-detail-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = fd.get('name')?.toString().trim() ?? '';
    const maxPlayers = Math.min(120, Math.max(1, parseInt(fd.get('maxPlayers'), 10) || 8));
    const password = fd.get('password')?.toString().trim() ?? '';
    const chartUrl = fd.get('chartUrl')?.toString().trim() ?? '';
    const chartName = fd.get('chartName')?.toString().trim() ?? '';

    messageEl.textContent = '';
    messageEl.className = 'room-detail__message';
    submitBtn.disabled = true;

    try {
      await onSave(room.id, { name, maxPlayers, password: password || null, chartUrl, chartName });
      messageEl.textContent = '保存成功';
      messageEl.className = 'room-detail__message room-detail__message--success';
      const countEl = container.querySelector('#room-detail-count-text');
      if (countEl) countEl.textContent = String(container.querySelectorAll('.room-detail__player[data-user-id]').length);
      const maxEl = container.querySelector('#room-detail-max-text');
      if (maxEl) maxEl.textContent = String(maxPlayers);
      form.querySelector('input[name="maxPlayers"]').value = maxPlayers;
    } catch (err) {
      messageEl.textContent = err.message || '保存失败';
      messageEl.className = 'room-detail__message room-detail__message--error';
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/**
 * 追加一条实时推送并更新玩家列表
 */
export function appendRoomLiveEvent(container, msg) {
  if (!container) return;
  const liveEl = container.querySelector('#room-detail-live');
  const playersListEl = container.querySelector('#room-detail-players-list');
  const countEl = container.querySelector('#room-detail-player-count');
  const countTextEl = container.querySelector('#room-detail-count-text');
  const statusEl = container.querySelector('#room-detail-status');

  const addLiveLine = (text, type = '') => {
    if (!liveEl) return;
    const li = document.createElement('li');
    li.className = 'room-detail__live-item' + (type ? ` room-detail__live-item--${type}` : '');
    li.textContent = text;
    liveEl.appendChild(li);
    liveEl.scrollTop = liveEl.scrollHeight;
  };

  const updateCount = () => {
    if (!playersListEl) return;
    const n = playersListEl.querySelectorAll('.room-detail__player[data-user-id]').length;
    if (countEl) countEl.textContent = String(n);
    if (countTextEl) countTextEl.textContent = String(n);
  };

  switch (msg.type) {
    case 'chat/message': {
      const d = msg.data || {};
      addLiveLine(`[${escapeHtml(d.username || '?')}] ${escapeHtml(d.message || '')}`, 'chat');
      break;
    }
    case 'room/playerJoin': {
      const d = msg.data || {};
      const p = d.player;
      if (p && playersListEl) {
        const empty = playersListEl.querySelector('.room-detail__player--empty');
        const li = document.createElement('li');
        li.className = 'room-detail__player';
        li.setAttribute('data-user-id', String(p.userId));
        li.innerHTML = `${playerAvatarHtml(p)}
          <div class="room-detail__player-info">
            <span class="room-detail__player-name">${escapeHtml(p.username)}</span>
          </div>
          <div class="room-detail__player-actions">
            <button type="button" class="room-detail__player-btn room-detail__player-btn--owner" data-action="transfer" data-user-id="${p.userId}">设为房主</button>
            <button type="button" class="room-detail__player-btn room-detail__player-btn--kick" data-action="kick" data-user-id="${p.userId}">移出</button>
          </div>`;
        if (empty) playersListEl.replaceChild(li, empty);
        else playersListEl.appendChild(li);
        updateCount();
      }
      break;
    }
    case 'room/playerLeave': {
      const userId = msg.data?.userId;
      if (userId != null && playersListEl) {
        const row = playersListEl.querySelector(`[data-user-id="${userId}"]`);
        if (row) {
          row.remove();
          if (playersListEl.children.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'room-detail__player room-detail__player--empty';
            empty.textContent = '暂无玩家';
            playersListEl.appendChild(empty);
          }
          updateCount();
        }
      }
      break;
    }
    case 'room/playerReady':
      break;
    case 'room/countdown':
      break;
    case 'room/gameStart':
      if (statusEl) statusEl.textContent = '游戏中';
      break;
    case 'room/gameEnd':
      if (statusEl) statusEl.textContent = '等待中';
      break;
    case 'room/sync':
      break;
    default:
      break;
  }
}
