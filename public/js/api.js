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
