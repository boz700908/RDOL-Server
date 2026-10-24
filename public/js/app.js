/**
 * 管理端入口：登录后一条 WebSocket 接收全 Node 实时数据，无轮询
 */

import { getToken, setToken, clearToken, login, loginWithToken, getRemember, setRemember, clearRemember } from './auth.js';
import { getOverview, getRooms, getRoom, updateRoom, kickPlayer, transferOwner, createRoom } from './api.js';
import { toggleView, setActiveNav } from './utils.js';
import { renderRoomList, bindRoomListRefresh } from './room-list.js';
import { renderRoomDetail, appendRoomLiveEvent } from './room-detail.js';
import { wsAdmin } from './ws-admin.js';
import { renderCharts } from './charts.js';
import { renderLevels } from './levels.js';
import { renderMods } from './mods.js';
import { renderUsers } from './users.js';

const LOGIN_VIEW = 'login-view';
const APP_SHELL = 'app-shell';
const VIEW_OVERVIEW = 'overview-view';
const VIEW_ROOM_LIST = 'room-list-view';
const VIEW_USERS = 'users-view';
const VIEW_ROOM_DETAIL = 'room-detail-view';
const VIEW_CHARTS = 'charts-view';
const VIEW_LEVELS = 'levels-view';
const VIEW_MODS = 'mods-view';

/** 当前房间列表（由 WS admin/roomList 与 room/created|destroyed|updated 维护） */
let currentRooms = [];

function showLogin() {
  const loginEl = document.getElementById(LOGIN_VIEW);
  const shellEl = document.getElementById(APP_SHELL);
  if (loginEl) loginEl.classList.remove('login-view--hidden');
  if (shellEl) shellEl.classList.add('app-shell--hidden');
}

function showApp() {
  const loginEl = document.getElementById(LOGIN_VIEW);
  const shellEl = document.getElementById(APP_SHELL);
  if (loginEl) loginEl.classList.add('login-view--hidden');
  if (shellEl) shellEl.classList.remove('app-shell--hidden');
}

function initLoginForm() {
  const form = document.getElementById('login-form');
  const accountEl = document.getElementById('login-account');
  const passwordEl = document.getElementById('login-password');
  const rememberEl = document.getElementById('login-remember');
  const tokenEl = document.getElementById('login-token');
  const messageEl = document.getElementById('login-message');
  const submitEl = document.getElementById('login-submit');
  const accountFields = document.getElementById('login-account-fields');
  const tokenFields = document.getElementById('login-token-fields');
  const modeEls = document.querySelectorAll('input[name="login-mode"]');

  /** 当前选的登录方式：account 走账号密码，token 走服务端 API_TOKEN */
  const currentMode = () => {
    const checked = document.querySelector('input[name="login-mode"]:checked');
    return checked ? checked.value : 'account';
  };

  const syncMode = () => {
    const tokenMode = currentMode() === 'token';
    if (accountFields) accountFields.hidden = tokenMode;
    if (tokenFields) tokenFields.hidden = !tokenMode;
    // 切换方式时清掉上一条错误提示，避免误导
    if (messageEl) {
      messageEl.textContent = '';
      messageEl.className = 'login-form__message';
    }
  };
  modeEls.forEach((el) => el.addEventListener('change', syncMode));
  syncMode();

  const saved = getRemember();
  if (saved) {
    if (accountEl) accountEl.value = saved.account;
    if (passwordEl) passwordEl.value = saved.password;
    if (rememberEl) rememberEl.checked = true;
  }

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tokenMode = currentMode() === 'token';
    const account = accountEl?.value?.trim() ?? '';
    const password = passwordEl?.value ?? '';
    const rawToken = tokenEl?.value ?? '';
    const remember = rememberEl?.checked ?? false;

    if (!messageEl) return;
    messageEl.textContent = '';
    messageEl.className = 'login-form__message';
    if (submitEl) submitEl.disabled = true;

    try {
      const result = tokenMode ? await loginWithToken(rawToken) : await login(account, password);
      if (result.success && result.data?.token) {
        setToken(result.data.token);
        // 令牌模式不写「记住我」：那是给账号密码自动填充用的
        if (!tokenMode) {
          if (remember) setRemember(account, password);
          else clearRemember();
        }
        if (tokenEl) tokenEl.value = '';
        showApp();
        wsAdmin.connect(result.data.token);
        wsAdmin.setOnAdminMessage(handleAdminMessage);
        render();
      } else {
        messageEl.textContent = result.message || '登录失败';
        messageEl.className = 'login-form__message login-form__message--error';
      }
    } catch (err) {
      messageEl.textContent = err.message || '登录失败';
      messageEl.className = 'login-form__message login-form__message--error';
    } finally {
      if (submitEl) submitEl.disabled = false;
    }
  });
}

function getRoute() {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);
  if (parts[0] === 'rooms' && parts[1]) {
    return { page: 'room-detail', roomId: parts[1] };
  }
  if (parts[0] === 'rooms') {
    return { page: 'rooms' };
  }
  if (parts[0] === 'users') {
    return { page: 'users' };
  }
  if (parts[0] === 'charts') {
    return { page: 'charts' };
  }
  if (parts[0] === 'levels') {
    return { page: 'levels' };
  }
  if (parts[0] === 'mods') {
    return { page: 'mods' };
  }
  return { page: 'overview' };
}

function setFooterStatus(connected) {
  const el = document.getElementById('footer-status');
  if (!el) return;
  el.textContent = connected ? '已连接' : '未连接';
  el.classList.toggle('sidebar__status--connected', connected);
}

function updateOverviewDOM(data) {
  const container = document.getElementById(VIEW_OVERVIEW);
  if (!container || !container.querySelector('.overview')) return;
  const cards = container.querySelectorAll('.overview__value');
  if (cards.length >= 3) {
    cards[0].textContent = String(data.onlineCount ?? 0);
    cards[1].textContent = String(data.roomCount ?? 0);
    cards[2].textContent = String(data.lobbyCount ?? 0);
  }
}

function refreshRoomListDOM() {
  const route = getRoute();
  if (route.page !== 'rooms') return;
  const container = document.getElementById(VIEW_ROOM_LIST);
  if (!container) return;
  renderRoomList(container, currentRooms, (roomId) => {
    window.location.hash = `#/rooms/${roomId}`;
  }, async (data) => createRoom(data));
  bindRoomListRefresh(container, () => {
    getRooms().then((rooms) => {
      currentRooms = rooms;
      refreshRoomListDOM();
    });
  });
}

function handleAdminMessage(msg) {
  if (msg.type === 'admin/overview') {
    updateOverviewDOM(msg.data || {});
    return;
  }
  if (msg.type === 'admin/roomList') {
    currentRooms = msg.data?.rooms ?? [];
    refreshRoomListDOM();
    return;
  }
  if (msg.type === 'room/created') {
    const room = msg.data?.room;
    if (room && !currentRooms.some((r) => r.id === room.id)) {
      currentRooms = [...currentRooms, { ...room, playerCount: room.playerCount ?? 0 }];
      refreshRoomListDOM();
    }
    return;
  }
  if (msg.type === 'room/destroyed') {
    const roomId = msg.data?.roomId;
    if (roomId) {
      currentRooms = currentRooms.filter((r) => r.id !== roomId);
      refreshRoomListDOM();
      const route = getRoute();
      if (route.page === 'room-detail' && route.roomId === roomId) {
        window.location.hash = '#/rooms';
      }
    }
    return;
  }
  if (msg.type === 'room/updated') {
    const d = msg.data || {};
    const roomId = d.roomId;
    if (!roomId) return;
    const idx = currentRooms.findIndex((r) => r.id === roomId);
    if (idx >= 0) {
      currentRooms = currentRooms.slice();
      currentRooms[idx] = { ...currentRooms[idx], ...d, id: roomId };
      refreshRoomListDOM();
    }
  }
}

async function showOverview() {
  const container = document.getElementById(VIEW_OVERVIEW);
  if (!container) return;

  setActiveNav('overview');
  container.innerHTML = '<p class="loading">加载中…</p>';

  try {
    const data = await getOverview();
    container.innerHTML = `
      <div class="overview">
        <div class="overview__card">
          <div class="overview__label">当前在线</div>
          <div class="overview__value">${data.onlineCount ?? 0}</div>
        </div>
        <div class="overview__card">
          <div class="overview__label">房间数</div>
          <div class="overview__value">${data.roomCount ?? 0}</div>
        </div>
        <div class="overview__card">
          <div class="overview__label">大厅人数</div>
          <div class="overview__value">${data.lobbyCount ?? 0}</div>
        </div>
      </div>
      <p class="overview__hint">实时推送</p>
    `;
  } catch (err) {
    container.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

async function showRoomList() {
  const container = document.getElementById(VIEW_ROOM_LIST);
  if (!container) return;

  setActiveNav('rooms');
  container.innerHTML = '<p class="loading">加载中…</p>';

  try {
    const rooms = await getRooms();
    currentRooms = rooms;
    renderRoomList(container, rooms, (roomId) => {
      window.location.hash = `#/rooms/${roomId}`;
    }, async (data) => createRoom(data));
    bindRoomListRefresh(container, () => {
      getRooms().then((list) => {
        currentRooms = list;
        refreshRoomListDOM();
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

async function showRoomDetail(roomId) {
  const container = document.getElementById(VIEW_ROOM_DETAIL);
  if (!container) return;

  container.innerHTML = '<p class="loading">加载中…</p>';
  setActiveNav('room-detail');

  try {
    const data = await getRoom(roomId);
    renderRoomDetail(
      container,
      data.room,
      data.players,
      () => {
        window.location.hash = '#/rooms';
      },
      async (id, formData) => {
        await updateRoom(id, formData);
      },
      (id, userId) => kickPlayer(id, userId),
      (id, userId) => transferOwner(id, userId)
    );
  } catch (err) {
    container.innerHTML = `<div class="error">${err.message}</div>
      <a href="#/rooms" class="room-detail__back">← 返回房间列表</a>`;
    return;
  }
  wsAdmin.subscribe(roomId, (msg) => {
    appendRoomLiveEvent(container, msg);
  });
}

function render() {
  const route = getRoute();

  if (route.page !== 'room-detail') {
    wsAdmin.unsubscribe();
  }

  toggleView(VIEW_OVERVIEW, route.page === 'overview');
  toggleView(VIEW_ROOM_LIST, route.page === 'rooms');
  toggleView(VIEW_ROOM_DETAIL, route.page === 'room-detail');
  toggleView(VIEW_USERS, route.page === 'users');
  toggleView(VIEW_CHARTS, route.page === 'charts');
  toggleView(VIEW_LEVELS, route.page === 'levels');
  toggleView(VIEW_MODS, route.page === 'mods');

  if (route.page === 'overview') {
    setActiveNav('overview');
    showOverview();
  } else if (route.page === 'rooms') {
    setActiveNav('rooms');
    showRoomList();
  } else if (route.page === 'room-detail' && route.roomId) {
    setActiveNav('rooms');
    showRoomDetail(route.roomId);
  } else if (route.page === 'users') {
    setActiveNav('users');
    ensureUsers();
  } else if (route.page === 'charts') {
    setActiveNav('charts');
    // 每次进页面都重新渲染：文件可能在别处被改动
    ensureCharts();
  } else if (route.page === 'levels') {
    setActiveNav('levels');
    ensureLevels();
  } else if (route.page === 'mods') {
    setActiveNav('mods');
    ensureMods();
  }
}

/**
 * 三个新页面都自己管数据加载，这里只在第一次进入时渲染一次。
 * 反复重建 DOM 会把用户填了一半的表单清掉，所以用标记守卫。
 */
const renderedViews = new Set();

function ensureUsers() {
  const container = document.getElementById(VIEW_USERS);
  if (!container || renderedViews.has('users')) return;
  renderedViews.add('users');
  renderUsers(container);
}

function ensureCharts() {
  const container = document.getElementById(VIEW_CHARTS);
  if (!container || renderedViews.has('charts')) return;
  renderedViews.add('charts');
  renderCharts(container);
}

function ensureLevels() {
  const container = document.getElementById(VIEW_LEVELS);
  if (!container || renderedViews.has('levels')) return;
  renderedViews.add('levels');
  renderLevels(container);
}

function ensureMods() {
  const container = document.getElementById(VIEW_MODS);
  if (!container || renderedViews.has('mods')) return;
  renderedViews.add('mods');
  renderMods(container);
}

window.addEventListener('hashchange', () => {
  if (getToken()) render();
});
window.addEventListener('admin:logout', () => {
  wsAdmin.disconnect();
  showLogin();
});
window.addEventListener('admin:ws-connected', () => {
  setFooterStatus(true);
});
window.addEventListener('admin:ws-closed', () => {
  setFooterStatus(false);
});

window.addEventListener('load', () => {
  if (!getToken()) {
    showLogin();
    initLoginForm();
    return;
  }
  showApp();
  wsAdmin.connect(getToken());
  wsAdmin.setOnAdminMessage(handleAdminMessage);
  render();
  setFooterStatus(wsAdmin.isConnected());
});
