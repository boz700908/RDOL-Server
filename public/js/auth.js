/**
 * 管理端登录与 token、记住我（仅用于自动填充）
 */

const TOKEN_KEY = 'admin_token';
const REMEMBER_KEY = 'admin_remember';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

/** 获取记住的账号密码，仅用于自动填充。{ account, password } 或 null */
export function getRemember() {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.account != null ? { account: data.account, password: data.password ?? '' } : null;
  } catch {
    return null;
  }
}

/** 勾选记住我时保存，下次自动填充 */
export function setRemember(account, password) {
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({ account: account ?? '', password: password ?? '' }));
}

export function clearRemember() {
  localStorage.removeItem(REMEMBER_KEY);
}

/**
 * 管理端登录（仅管理员可成功）
 * @param {string} account
 * @param {string} password
 * @returns {Promise<{ success: boolean, message: string, data?: { token: string, user: object } }>}
 */
export async function login(account, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: (account || '').trim(), password: password ?? '' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, message: data.message || data.error || `请求失败 ${res.status}` };
  }
  return data;
}
