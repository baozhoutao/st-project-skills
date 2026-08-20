/* scripts/acceptance/lib.cjs — 验收测试 UI 驱动公共库(框架层)
 * 供 st-project-pm-test 执行时引用;场景层脚本放同目录 <与用例文件同名>.cjs。
 * 约定见 .claude/skills/st-project-pm-test/SKILL.md「UI 驱动脚本:沉淀复用」。
 * 环境:OS_BASE(默认 http://localhost:3000);账号密码走项目测试基线。
 * 2026-08-08 首版,内容为 S01 首轮磨合实测验证过的部分。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = process.env.OS_BASE || 'http://localhost:3000';
const PASS = process.env.OS_TEST_PASS || 'Tianshun123!';
const ADMIN = { email: 'admin@objectos.ai', password: process.env.OS_ADMIN_PASS || 'admin123' };
// Console 应用路由名(2026-08-08 实测:meta/apps 首项;换环境用 listApps() 核实)
const APP = process.env.OS_APP || 'os_tianshun_ehr_production';

/* ---- playwright(全局安装 + chromium 缓存,e2e-* 系列同款) ---- */
const { chromium } = require('/Users/baozhoutao/.nvm/versions/node/v22.22.2/lib/node_modules/playwright');
const _pwRoot = '/Users/baozhoutao/Library/Caches/ms-playwright';
const EXE = (() => {
  for (const d of fs.readdirSync(_pwRoot).filter((x) => x.startsWith('chromium-')).sort().reverse()) {
    for (const c of ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
                     'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = `${_pwRoot}/${d}/${c}`;
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('no playwright chromium found');
})();

async function withPage(fn, opts = {}) {
  const { browser, page } = await launchBrowser(opts);
  try { return await fn(page); } finally { await browser.close(); }
}

/* 浏览器启动器(框架层):调用方自己 close。
 * opts.mobile=true → H5 视口 390×1180 + dsf 2(截图规范);opts.args → chromium 启动参数
 * (如假摄像头 --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<y4m>);
 * opts.contextOpts → 透传 newContext(permissions / acceptDownloads / downloadsPath 等)。
 * 2026-08-08 S01 第二轮实测验证(Console 桌面 + H5 假摄像头扫码均走此入口)。 */
async function launchBrowser(opts = {}) {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: opts.headless !== false,
    args: opts.args || [],
  });
  const ctx = await browser.newContext({
    viewport: opts.viewport || (opts.mobile ? { width: 390, height: 1180 } : { width: 1440, height: 900 }),
    deviceScaleFactor: opts.mobile ? 2 : 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    ...(opts.contextOpts || {}),
  });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(60000);
  return { browser, ctx, page };
}

const wait = (p, ms) => p.waitForTimeout(ms);

/* 截图落盘器:makeShot(evidenceDir) → shot(page, 'S01-001-1-list') */
function makeShot(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  return async (page, name) => {
    const f = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: f, fullPage: false });
    console.log('📸', `${name}.png`);
    return f;
  };
}

/* ---- Console 登录(e2e-676 同款,实测可用) ---- */
async function loginConsole(page, email, pass = PASS) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/_console/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (_) {} });
  await page.goto(`${BASE}/_console/login`, { waitUntil: 'domcontentloaded' });
  await wait(page, 2200);
  await page.locator('input[type="text"], input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(pass);
  await page.getByRole('button', { name: '登录' }).first().click();
  await wait(page, 3600);
}

const listUrl = (obj, app = APP) => `${BASE}/_console/apps/${app}/${obj}`;

/* ---- REST(仅供环境探针/基线修复,不作判定证据) ---- */
async function api(method, p, body, token) {
  const r = await fetch(BASE + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (_) {}
  return { status: r.status, body: j };
}
async function tokenOf(email, pass = PASS) {
  const r = await api('POST', '/api/v1/auth/sign-in/email', { email, password: pass });
  return { status: r.status, token: r.body && (r.body.token || (r.body.data && r.body.data.token)) };
}
async function adminToken() { return (await tokenOf(ADMIN.email, ADMIN.password)).token; }

async function listApps(token) {
  const r = await api('GET', '/api/v1/meta/apps', null, token);
  return ((r.body && r.body.items) || []).map((a) => a.name);
}

/* 环境探针:账号可登 + 对象记录数 + 测试编号无残留(打印观察,不下结论) */
async function probeAccounts(accounts) {
  for (const [role, [email, pass]] of Object.entries(accounts)) {
    const r = await tokenOf(email, pass || PASS);
    console.log(`login ${role} (${email}): ${r.status}${r.token ? ' ✓' : ''}`);
  }
}
async function probeResidue(token, obj, codes) {
  const r = await api('GET', `/api/v1/data/${obj}?limit=200`, null, token);
  const recs = (r.body && (r.body.records || r.body.data)) || [];
  console.log(`${obj} 记录数: ${recs.length} (status ${r.status})`);
  for (const code of codes) {
    const hit = recs.find((x) => JSON.stringify(x).includes(code));
    console.log(`残留检查 ${code}: ${hit ? '❗存在(需清理)' : '无'}`);
  }
  return recs;
}

/* 账号基线修复:确保账号存在+密码正确+绑权限集(create-user 带 mustChangePassword:false 防 403 坑) */
async function ensureAccounts(token, need /* [[email,name,permissionSetName]] */) {
  const users = await api('GET', '/api/v1/data/sys_user?limit=500', null, token);
  const byEmail = new Map((users.body.records || []).map((r) => [r.email, r.id]));
  const psList = await api('GET', '/api/v1/data/sys_permission_set?limit=100', null, token);
  const psByName = new Map((psList.body.records || []).map((r) => [r.name, r.id]));
  for (const [email, name, ps] of need) {
    let id = byEmail.get(email);
    if (!id) {
      const r = await api('POST', '/api/v1/auth/admin/create-user', { email, password: PASS, name, mustChangePassword: false }, token);
      id = r.body?.data?.user?.id;
      console.log(`${id ? '+' : '!'} 建号 ${email} (${r.status})`);
    } else console.log(`= 账号已存在 ${email}`);
    if (!id) continue;
    await api('POST', '/api/v1/auth/admin/set-user-password', { userId: id, newPassword: PASS, mustChangePassword: false }, token);
    const pid = psByName.get(ps);
    if (!pid) { console.log(`  ! 权限集不存在 ${ps}`); continue; }
    const asg = await api('GET', `/api/v1/data/sys_user_permission_set?filter=${encodeURIComponent(JSON.stringify({ user_id: id }))}`, null, token);
    if (!(asg.body.records || []).some((x) => x.permission_set_id === pid)) {
      const r = await api('POST', '/api/v1/data/sys_user_permission_set', { user_id: id, permission_set_id: pid }, token);
      console.log(`  绑权限集 ${ps}: ${r.status}`);
    } else console.log(`  = 已绑 ${ps}`);
    const v = await tokenOf(email);
    console.log(`  复验登录 ${email}: ${v.status}${v.token ? ' ✓' : ''}`);
  }
}

module.exports = {
  BASE, PASS, APP, EXE,
  withPage, launchBrowser, wait, makeShot,
  loginConsole, listUrl,
  api, tokenOf, adminToken, listApps,
  probeAccounts, probeResidue, ensureAccounts,
};

/* ---- 以下两项配方源自 e2e-676.cjs(该脚本多轮实测使用过);本库封装后未单独复验,首用时留意 ---- */

/* H5 登录(H5 站点地址由调用方传,如 http://localhost:5173) */
async function loginH5(page, h5Base, email, pass = PASS) {
  await page.context().clearCookies();
  await page.goto(`${h5Base}/login`, { waitUntil: 'domcontentloaded' });
  await wait(page, 1600);
  await page.locator('input[placeholder="手机号 / 邮箱"]').fill(email);
  await page.locator('input[type="password"]').fill(pass);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  await wait(page, 3000);
}

/* 导入向导驱动:在对象列表页调用——点【导入】→ 传文件 → 一路 下一步/执行 → 返回结果弹窗文本。
 * opts.alreadyOpen=true 表示向导已打开(跳过点导入按钮)。 */
async function importViaWizard(page, filePath, shotFn, tag, opts = {}) {
  if (!opts.alreadyOpen) {
    await page.getByRole('button', { name: /导入/ }).first().click();
    await wait(page, 2000);
  }
  await page.locator('input[type="file"]').first().setInputFiles(filePath);
  await wait(page, 2600);
  for (let s = 0; s < 6; s++) {
    const b = page.getByRole('button', { name: /^(下一步|执行|开始导入|确认|完成|导入\s*\d+\s*行)$/ }).last();
    if (await b.count() === 0 || await b.isDisabled().catch(() => false)) break;
    const t = (await b.textContent().catch(() => '')) || '';
    await b.click().catch(() => {});
    await wait(page, 3000);
    if (/导入\s*\d+\s*行|开始导入/.test(t)) { await wait(page, 2500); break; }
  }
  const resultText = await page.evaluate(() => {
    const x = document.querySelector('[role="dialog"]');
    return x ? x.innerText.replace(/\s+/g, ' ').slice(0, 300) : '(无结果弹窗)';
  });
  if (shotFn) await shotFn(page, tag || 'import-result');
  await page.getByRole('button', { name: '关闭' }).first().click().catch(() => {});
  await wait(page, 900);
  return resultText;
}

module.exports.loginH5 = loginH5;
module.exports.importViaWizard = importViaWizard;
