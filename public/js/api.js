/**
 * 管理端 API 请求封装
 * 所有请求相对当前页面的 origin，与 Node 管理端同源，需携带管理员 token
 */

import { getToken, clearToken } from './auth.js';

const BASE = '';

/**
 * 统一请求（自动带 Authorization，401 时清除 token 并触发登出）
 * @param {string} path
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const url = `${BASE}${path}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('admin:logout'));
    throw new Error(data.message || data.error || '登录已失效');
  }
  if (!res.ok) {
    throw new Error(data.message || data.error || `请求失败 ${res.status}`);
  }
  return data;
}

/**
 * 获取概览数据（在线数、房间数、大厅人数）
 * @returns {Promise<{ onlineCount: number, roomCount: number, lobbyCount: number }>}
 */
export async function getOverview() {
  return request('/api/overview');
}

/**
 * 获取房间列表
 */
export async function getRooms() {
  return request('/api/rooms');
}

/**
 * 管理员创建房间
 * @param {{ name: string, maxPlayers?: number, password?: string|null, chartUrl: string, chartName: string }} body
 * @returns {Promise<{ roomId: string, room: object }>}
 */
export async function createRoom(body) {
  return request('/api/rooms', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * 获取房间详情（含玩家列表）
 * @param {string} roomId
 * @returns {Promise<{ room: object, players: Array<{ userId: number, username: string, avatar: string|null, avatarFrame: string|null, ready?: boolean }> }>}
 */
export async function getRoom(roomId) {
  return request(`/api/rooms/${encodeURIComponent(roomId)}`);
}

/**
 * 更新房间信息
 */
export async function updateRoom(roomId, body) {
  return request(`/api/rooms/${encodeURIComponent(roomId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/**
 * 管理员踢出房间内玩家
 * @param {string} roomId
 * @param {number} userId
 */
export async function kickPlayer(roomId, userId) {
  return request(`/api/rooms/${encodeURIComponent(roomId)}/kick`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

/**
 * 管理员转移房主
 * @param {string} roomId
 * @param {number} userId
 */
export async function transferOwner(roomId, userId) {
  return request(`/api/rooms/${encodeURIComponent(roomId)}/transfer-owner`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

/**
 * 带 token 取二进制并触发浏览器下载。
 *
 * 不能用 <a href> 直接链过去：下载端点要 Authorization 头，而链接带不了。
 * 先 fetch 成 Blob 再点一个临时链接，是唯一能同时带上鉴权的做法。
 */
export async function downloadBinary(path, filename) {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || data.error || `下载失败 ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download.bin';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立即 revoke 会让部分浏览器的下载中断，留几秒
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------------- 谱面库 ----------------

export async function getCharts() {
  return request('/api/charts');
}

/** 原始字节上传，文件名走查询串（与游戏内上传同一套服务端规则） */
export async function uploadChart(file) {
  return request(`/api/charts/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
}

export async function deleteChart(name) {
  return request(`/api/charts/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function downloadChart(name) {
  return downloadBinary(`/api/charts/${encodeURIComponent(name)}/download`, name);
}

// ---------------- 社区谱面 ----------------

export async function getLevels({ page = 1, perPage = 20, q = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (q) params.set('q', q);
  return request(`/api/levels?${params.toString()}`);
}

export async function searchUpstreamLevels({ page = 1, perPage = 20, q = '' } = {}) {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (q) params.set('q', q);
  return request(`/api/levels/search?${params.toString()}`);
}

/** 发布：{ chartName } 或 { upstreamId }，其余为元数据 */
export async function publishLevel(body) {
  return request('/api/levels/publish', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function deleteLevel(id, purgeFile = false) {
  const suffix = purgeFile ? '?purgeFile=1' : '';
  return request(`/api/levels/${encodeURIComponent(id)}${suffix}`, { method: 'DELETE' });
}

export async function downloadLevel(id) {
  return downloadBinary(`/api/levels/${encodeURIComponent(id)}/download`, `${id}.rdzip`);
}

export async function downloadUpstreamLevel(id) {
  return downloadBinary(`/api/levels/upstream/${encodeURIComponent(id)}/download`, `${id}.rdzip`);
}

// ---------------- Mod 发布 ----------------

export async function getMods() {
  return request('/api/mods');
}

export async function publishMod(file, { release = '', clientVersion = '', announcement = '', force = false, activate = true } = {}) {
  const params = new URLSearchParams({
    clientVersion,
    announcement,
    force: force ? '1' : '0',
    activate: activate ? '1' : '0',
  });
  if (release) params.set('release', release);
  return request(`/api/mods/publish?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
}

export async function activateMod(release) {
  return request(`/api/mods/activate?release=${encodeURIComponent(release)}`, { method: 'POST' });
}

export async function previewMod(release = '') {
  const params = new URLSearchParams();
  if (release) params.set('release', release);
  return request(`/api/mods/preview?${params.toString()}`);
}

export async function deleteMod(release) {
  return request(`/api/mods/${encodeURIComponent(release)}`, { method: 'DELETE' });
}
