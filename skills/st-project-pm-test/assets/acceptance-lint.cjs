#!/usr/bin/env node
/**
 * acceptance-lint.cjs — PM 验收测试用例文件门禁(严格单一格式,不做别名兼容)
 * 用法: node scripts/acceptance-lint.cjs [--draft] <cases.md>
 *   --draft  起草模式(st-project-pm-case 用):【待确认】/缺账号映射 只警告;
 *            默认(正式门禁,st-project-pm-test 用):两者均为错误
 * 退出码: 0=通过(允许警告) 1=有错误(错误用例不得进执行队列)
 * 格式约定见 .claude/skills/st-project-pm-case/case-template.md:
 *   - 用例标题: "## <ID>:标题",ID 形如 AC-001 / S01-001(场景前缀式)
 *   - 用例字段: "- **字段**:值" 单一写法
 *   - 文件头可声明: "账号映射:角色=账号;…"、"默认关联 Issue:#n|无"、用例清单总表
 *   - 外来格式文件由 st-project-pm-case 转换成本格式后再入库,lint 不迁就外来格式
 */
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
const draft = argv.includes('--draft');
const file = argv.find((a) => a !== '--draft');
if (!file || !fs.existsSync(file)) {
  console.error('用法: node scripts/acceptance-lint.cjs [--draft] <cases.md>');
  process.exit(1);
}
const text = fs.readFileSync(file, 'utf8');

const VAGUE = /(功能正常|一切正常|没问题|无异常|符合预期|运行正常|测试通过)/;
const SEP = /[::→|]/;
const ID_SRC = '[A-Z][A-Z0-9]*-\\d+'; // 前缀-序号
const CASE_HEAD = new RegExp(`^##\\s+(${ID_SRC})\\s*[::]\\s*(.*)$`);
const TYPES = ['主流程', '边界', '异常', '权限', '联动', '专项'];

// ---- 切块:仅认 "## <ID>:标题";其他 ##/### 标题视为章节,忽略 ----
const lines = text.split('\n');
const cases = [];
let headerEnd = lines.length;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(CASE_HEAD);
  if (!m) continue;
  if (cases.length === 0) headerEnd = i;
  else cases[cases.length - 1].end = i;
  cases.push({ id: m[1], title: m[2].trim(), start: i + 1, end: lines.length });
}
for (const c of cases) c.body = lines.slice(c.start, c.end).join('\n');
const header = lines.slice(0, headerEnd).join('\n');

// ---- 文件头:账号映射 / 默认关联 Issue / 用例清单总表 ----
const accountMap = {};
const am = header.match(/账号映射[*\s]*[::]\s*(.+)/);
if (am) for (const pair of am[1].split(/[;;]/)) {
  const kv = pair.match(/^\s*(.+?)\s*[==]\s*(.+?)\s*$/);
  if (kv) accountMap[kv[1]] = kv[2];
}
const di = header.match(/默认关联\s*Issue[*\s]*[::]\s*(.+)/);
const defaultIssue = di ? di[1].trim() : null;
const tocIds = [...header.matchAll(new RegExp(`\\|\\s*(${ID_SRC})\\s*\\|`, 'g'))].map((m) => m[1]);

let errorCount = 0, warnCount = 0;
const globalReport = [], report = [];
const err = (msg) => { errorCount++; report.push(`  [错误] ${msg}`); };
const warn = (msg) => { warnCount++; report.push(`  [警告] ${msg}`); };
const gate = (msg) => (draft ? warn(`${msg}(--draft 暂放行,正式门禁为错误)`) : err(msg));
const gerr = (msg) => { errorCount++; globalReport.push(`[错误] ${msg}`); };
const gwarn = (msg) => { warnCount++; globalReport.push(`[警告] ${msg}`); };

if (cases.length === 0) gerr('未解析到任何用例(标题须为「## AC-001:标题」/「## S01-001:标题」形式)');
const seen = new Set();
for (const c of cases) {
  if (seen.has(c.id)) gerr(`用例编号重复: ${c.id}`);
  seen.add(c.id);
}
if (tocIds.length) {
  for (const id of tocIds) if (!seen.has(id)) gerr(`清单表列出 ${id} 但无详情`);
  for (const id of seen) if (!tocIds.includes(id)) gwarn(`详情有 ${id} 但清单表未列`);
}
const groups = {};
for (const id of seen) { const [p, n] = id.split(/-(?=\d+$)/); (groups[p] ||= []).push(+n); }
for (const [p, ns] of Object.entries(groups)) {
  ns.sort((a, b) => a - b);
  for (let i = 1; i < ns.length; i++) if (ns[i] - ns[i - 1] > 1)
    gwarn(`${p} 编号断号:${p}-${ns[i - 1]} 之后跳到 ${p}-${ns[i]}(确认是有意删除)`);
}
if (defaultIssue && !/^#\d+/.test(defaultIssue) && !/无/.test(defaultIssue))
  gerr(`「默认关联 Issue」须为 #数字 或 无,实际: "${defaultIssue}"`);

function field(body, name) {
  const m = body.match(new RegExp(`\\*\\*${name}\\*\\*\\s*[::]\\s*(.+)`));
  return m ? m[1].trim() : null;
}
function numberedItems(body, name) {
  const items = [];
  let inSection = false;
  for (const line of body.split('\n')) {
    if (new RegExp(`\\*\\*${name}\\*\\*`).test(line)) { inSection = true; continue; }
    if (inSection) {
      const it = line.match(/^\s*\d+[.、]\s*(.+)$/);
      if (it) { items.push(it[1].trim()); continue; }
      if (/^\s*-?\s*\*\*.+\*\*/.test(line) || /^#{2,3}\s/.test(line)) inSection = false;
    }
  }
  return items;
}

for (const c of cases) {
  report.push(`${c.id}:${c.title || '(无标题)'}`);
  if (!c.title) err('标题为空');

  const pending = (c.body.match(/【待确认】/g) || []).length;
  if (pending > 0) gate(`含 ${pending} 处【待确认】——PM 拍板清零后方可进入验收执行`);

  const type = field(c.body, '类型');
  if (type == null) warn('未写「类型」(主流程|边界|异常|权限|专项),按 主流程 处理');
  else if (!TYPES.some((t) => type.includes(t))) err(`「类型」须为 ${TYPES.join('|')},实际: "${type}"`);

  const issue = field(c.body, '关联\\s*Issue') || defaultIssue;
  if (issue == null) err('缺「关联 Issue」(用例级写,或文件头声明「默认关联 Issue:#n/无」)');
  else if (!/^#\d+/.test(issue) && !/无/.test(issue)) err(`「关联 Issue」须为 #数字 或 无,实际: "${issue}"`);

  const pri = field(c.body, '优先级');
  if (pri == null) warn('未写「优先级」,按 P1 处理');
  else if (!/P[012]/.test(pri)) err(`「优先级」须为 P0/P1/P2,实际: "${pri}"`);

  const side = field(c.body, '端');
  if (!side) err('缺「端」(Console(PC) | H5)');
  else if (!/(Console|H5|PC)/i.test(side)) err(`「端」须含 Console/PC/H5,实际: "${side}"`);

  const acct = field(c.body, '角色');
  if (!acct) err('缺「角色」');
  else {
    const hasAccount = /@/.test(acct) || Object.keys(accountMap).some((r) => acct.includes(r));
    if (!hasAccount) gate(`角色「${acct}」解析不出账号——在文件头「账号映射:角色=账号;…」声明,或角色行直写账号`);
    if (/admin|管理员/i.test(acct)) warn(`角色含 admin/管理员("${acct}")——确认业务角色确实是管理员(admin 跑通不算通过)`);
  }

  if (field(c.body, '前置条件') == null) err('缺「前置条件」(无特殊前置就写「无」;文件级数据在文件头声明,此处只写特殊项/依赖的前序用例)');

  const steps = numberedItems(c.body, '操作步骤');
  if (steps.length === 0) err('「操作步骤」无编号条目');
  steps.forEach((s, i) => { if (s.length < 4) err(`步骤${i + 1} 过于简略: "${s}"`); });

  const exps = numberedItems(c.body, '预期结果');
  if (exps.length === 0) err('「预期结果」无编号条目');
  exps.forEach((e, i) => {
    if (VAGUE.test(e)) err(`预期${i + 1} 含不可判定表述: "${e}"`);
    else if (e.length < 8) err(`预期${i + 1} 过于笼统(不足8字): "${e}"`);
    else if (!SEP.test(e)) warn(`预期${i + 1} 建议写成「在哪里看:看到什么」: "${e}"`);
  });
}

console.log([...globalReport, ...report].join('\n'));
console.log(`\n共 ${cases.length} 用例:错误 ${errorCount},警告 ${warnCount}${draft ? '(--draft 起草模式)' : ''}`);
if (errorCount > 0) {
  console.log('结论:门禁不通过 —— 有错误的用例标 ⚠️ 无法执行退回 PM,其余用例可测。');
  process.exit(1);
}
console.log('结论:门禁通过,可开测。');
