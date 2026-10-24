/**
 * 管理员账号工具：把已注册用户提升为管理员，或直接建一个管理员账号。
 *
 * 为什么需要它：管理端（3005 端口 /management 页）沿用 authService.login，
 * 要求 role >= 2。全新数据库里所有用户都是 role = 1，没有任何管理员，
 * 于是管理端登录必然失败。这个脚本是唯一的开号入口。
 *
 * 用法：
 *   node scripts/make-admin.mjs list                 列出所有用户与角色
 *   node scripts/make-admin.mjs promote <账号>       把已有用户升为管理员(role=2)
 *   node scripts/make-admin.mjs demote  <账号>       降回普通用户(role=1)
 *   node scripts/make-admin.mjs create  <账号> <密码> 新建管理员账号
 *
 * 注意：
 *  - 必须带 --env-file 或先 export 环境变量，否则会连到默认的 ./data/rdonline.db
 *    而不是生产库。推荐：node --env-file=.env scripts/make-admin.mjs list
 *  - 密码只从命令行读一次，不回显、不落盘；写库前用与业务相同的
 *    bcrypt(10) 哈希，因此与游戏端登录完全兼容。
 *  - 直接改库，不经过 WebSocket，服务不用重启（每次登录都实时查库）。
 */
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 复用编译产物里的建表与密码工具，避免两套实现走偏
const { initSchema } = require(path.join(__dirname, '..', 'dist', 'db', 'schema.js'));
const { db } = require(path.join(__dirname, '..', 'dist', 'db', 'sqlite.js'));
const { hashPassword } = require(path.join(__dirname, '..', 'dist', 'utils', 'password.js'));

const ROLE_USER = 1;
const ROLE_ADMIN = 2;

function usage() {
  console.log(
    [
      '用法：',
      '  node --env-file=.env scripts/make-admin.mjs list',
      '  node --env-file=.env scripts/make-admin.mjs promote <账号>',
      '  node --env-file=.env scripts/make-admin.mjs demote  <账号>',
      '  node --env-file=.env scripts/make-admin.mjs create  <账号> <密码>',
      '',
      '账号可以是用户名，也可以是邮箱。'
    ].join('\n')
  );
}

/** 按用户名或邮箱找用户；找不到返回 undefined */
function findUser(account) {
  const rows = db
    .prepare('SELECT id, username, email, role FROM users WHERE username = ? OR email = ? LIMIT 1')
    .all(account, account);
  return rows[0];
}

function setRole(account, role) {
  const user = findUser(account);
  if (!user) {
    console.error(`找不到账号：${account}`);
    process.exitCode = 1;
    return;
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  const label = role >= ROLE_ADMIN ? '管理员' : '普通用户';
  console.log(`已把 ${user.username}（ID ${user.id}）设为${label}（role=${role}）`);
}

function listUsers() {
  const rows = db
    .prepare('SELECT id, username, email, role, created_at FROM users ORDER BY id')
    .all();
  if (rows.length === 0) {
    console.log('数据库里还没有任何用户。先让一个账号在游戏端注册，再用 promote 提升。');
    return;
  }
  console.log('ID\t角色\t用户名\t邮箱');
  for (const r of rows) {
    const roleText = r.role >= ROLE_ADMIN ? `管理员(${r.role})` : `用户(${r.role})`;
    console.log(`${r.id}\t${roleText}\t${r.username}\t${r.email ?? '-'}`);
  }
  console.log('');
  console.log(`共 ${rows.length} 个账号，其中管理员 ${rows.filter((r) => r.role >= ROLE_ADMIN).length} 个。`);
}

async function createAdmin(account, password) {
  if (!/^[A-Za-z0-9_]{2,32}$/.test(account)) {
    console.error('账号需为 2-32 位字母、数字或下划线');
    process.exitCode = 1;
    return;
  }
  if (!password || password.length < 6) {
    console.error('密码至少 6 位');
    process.exitCode = 1;
    return;
  }
  if (findUser(account)) {
    console.error(`账号 ${account} 已存在，请改用 promote 提升`);
    process.exitCode = 1;
    return;
  }

  const hash = await hashPassword(password);
  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(
    account,
    hash,
    ROLE_ADMIN
  );
  console.log(`已创建管理员账号 ${account}（role=${ROLE_ADMIN}）`);
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);

  // 建表幂等：空库也能直接跑 list
  initSchema();

  switch (cmd) {
    case 'list':
      listUsers();
      break;
    case 'promote':
      if (!a) return usage();
      setRole(a, ROLE_ADMIN);
      break;
    case 'demote':
      if (!a) return usage();
      setRole(a, ROLE_USER);
      break;
    case 'create':
      if (!a || !b) return usage();
      await createAdmin(a, b);
      break;
    default:
      usage();
  }
}

main().catch((err) => {
  console.error('执行失败：', err?.message || err);
  process.exitCode = 1;
});
