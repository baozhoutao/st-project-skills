#!/usr/bin/env node
/**
 * acceptance-report.cjs — results.json → 验收记录 issue 正文 + 逐案例明细评论
 * 用法: node scripts/acceptance-report.cjs <results.json> \
 *          [--evidence-dir <本地截图目录>] [--sha <证据commit 40位SHA>] \
 *          [--prefix <孤儿分支上的批次目录>] [--repo owner/name] [--out <输出目录>] \
 *          [--archive-prev <上一轮results.json>]
 * 硬校验不过 = 退出码 1,不产出(fail 案例缺 traps_checked/reruns/repro 直接拒渲;
 * disposition[].class 拼错、带 class 缺 basis、一个用例被归两个档,同样拒渲)。
 * 产出: <out>/issue-body.md + <out>/comment-<AC-XXX>.md(非 pass 案例)
 *
 * 复测更新用法(同批次第 N+1 轮,不建新 issue,修正原验收 issue):
 *   1. 以上一轮全量 results.json 为底,只更新本轮复测用例条目(未重测的保留原轮结论),
 *      fingerprint 整体换成新轮指纹,顶层追加 rounds 轮次元数据数组(每轮 round/date/commit/cases);
 *      无 rounds = 首轮,渲染行为与旧格式完全一致(向后兼容)。
 *   2. 带 --archive-prev <上一轮results.json> 渲染:额外产出 comment-history-round-N.md
 *      (「历史轮」标记归档评论,history 脚本逐轮解析的数据源)。
 *   3. 发布顺序(硬):先把归档评论贴进原 issue,再 gh issue edit 用新 issue-body.md
 *      替换正文、按新统计尾巴改标题;历史轮明细评论保留不删。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const file = args[0];
function opt(name, dflt) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt; }
if (!file || !fs.existsSync(file)) {
  console.error('用法: node scripts/acceptance-report.cjs <results.json> [--evidence-dir d] [--sha x] [--prefix p] [--repo o/r] [--out d] [--archive-prev 上一轮results.json]');
  process.exit(1);
}
const evidenceDir = opt('evidence-dir', null);
const sha = opt('sha', null);
const prefix = opt('prefix', null);
// 仓库名默认从 git remote 自动读取(skill 跨项目可移植,不硬编码)
function detectRepo() {
  try {
    const url = require('child_process').execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    const m = url.match(/github\.com[:/]+([^/]+\/[^/.]+)/);
    return m ? m[1] : null;
  } catch { return null; }
}
const repo = opt('repo', null) || detectRepo();
if (!repo) { console.error('无法从 git remote 识别仓库,请用 --repo <owner/name> 指定'); process.exit(1); }
const outDir = opt('out', path.join(path.dirname(file), 'out'));
const archivePrev = opt('archive-prev', null);

let R;
try { R = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error('results.json 解析失败: ' + e.message); process.exit(1); }

// 上一轮全量 results.json(复测归档用;产出「历史轮」标记评论,是 history 逐轮解析的数据源)
let PREV = null;
if (archivePrev) {
  if (!fs.existsSync(archivePrev)) { console.error('--archive-prev 文件不存在: ' + archivePrev); process.exit(1); }
  try { PREV = JSON.parse(fs.readFileSync(archivePrev, 'utf8')); }
  catch (e) { console.error('--archive-prev 解析失败: ' + e.message); process.exit(1); }
  if (!PREV || !Array.isArray(PREV.cases) || PREV.cases.length === 0) {
    console.error('--archive-prev 不是合法的 results.json(缺 cases)'); process.exit(1);
  }
}

const VERDICTS = { pass: '✅ 通过', fail: '❌ 不通过', blocked: '⛔ 阻塞', not_run: '⚠️ 无法执行', inconclusive: '❓ 无法判定' };
// 逐用例表的「结论」列只放图标 —— 带文字会把列撑宽、把编号和说明挤成竖排(图例在表头上方给出)
const ICON = (v) => VERDICTS[v].split(' ')[0];
const errors = [], warns = [];
const E = (m) => errors.push(m), W = (m) => warns.push(m);

// ---- 硬校验 ----
if (!R.batch) E('缺 batch');
if (!R.title) E('缺 title');
if (!R.date) E('缺 date');
const fp = R.fingerprint || {};
if (!/^[0-9a-f]{40}$/i.test(fp.commit || '')) E('fingerprint.commit 须为 40 位 SHA(没有指纹的结果无效)');
if (!fp.server || !fp.server.verified_by) E('fingerprint.server.verified_by 缺失(须注明 lsof/重启核验方式)');
if (!fp.platform) E('fingerprint.platform 缺失');
if (!fp.accounts || Object.keys(fp.accounts).length === 0) E('fingerprint.accounts 为空(角色→账号映射)');
if (!Array.isArray(R.cases) || R.cases.length === 0) E('cases 为空');

// rounds 轮次元数据(复测批次才有;无 rounds = 首轮,以下校验整段跳过——向后兼容)
if (R.rounds !== undefined) {
  if (!Array.isArray(R.rounds) || R.rounds.length === 0) E('rounds 若存在须为非空数组(首轮直接省略整个字段)');
  else {
    const caseIds = new Set((R.cases || []).map((c) => c.id));
    R.rounds.forEach((r, i) => {
      if (!(r.round >= 1)) E(`rounds[${i}] 缺 round 轮次号(≥1 的整数)`);
      if (!r.date) E(`rounds[${i}] 缺 date`);
      if (!/^[0-9a-f]{40}$/i.test(r.commit || '')) E(`rounds[${i}] commit 须为 40 位 SHA(每轮各自的基线指纹)`);
      if (!Array.isArray(r.cases) || r.cases.length === 0) E(`rounds[${i}] 缺 cases(本轮执行/更新的用例清单;首轮可写 ["全部"])`);
      else r.cases.forEach((id) => { if (id !== '全部' && !caseIds.has(id)) W(`rounds[${i}] 引用了 cases 里不存在的用例 ${id}`); });
      if (i > 0 && !(r.round > R.rounds[i - 1].round)) E(`rounds[${i}] 轮次号须严格递增`);
    });
    const last = R.rounds[R.rounds.length - 1];
    if (last && /^[0-9a-f]{40}$/i.test(last.commit || '') && fp.commit &&
        String(last.commit).toLowerCase() !== String(fp.commit).toLowerCase())
      E('rounds 末轮 commit 与 fingerprint.commit 不一致——fingerprint 必须整体换成最新轮指纹');
  }
}

const allEvidence = new Set();
for (const c of R.cases || []) {
  const id = c.id || '(无id)';
  if (!c.id || !c.title) E(`${id}: 缺 id/title`);
  if (!VERDICTS[c.verdict]) { E(`${id}: verdict 非法 "${c.verdict}"`); continue; }
  const exps = c.expectations || [];
  // 证据条目必须是 {file, shows}:shows = AI 回看截图后写下的图内实际可见内容(渲染成图注)
  exps.forEach((x, i) => (x.evidence || []).forEach((ev, j) => {
    if (typeof ev !== 'object' || !ev.file)
      E(`${id}: 预期${x.n || i + 1} 证据${j + 1} 须为 {file, shows} 对象(截图回看确认机制)`);
    else {
      allEvidence.add(ev.file);
      if (!ev.shows || !ev.shows.trim())
        E(`${id}: 证据 ${ev.file} 缺 shows 图注——须 Read 回看截图后写下图里实际可见的内容`);
    }
  }));
  if (c.verdict === 'pass') {
    if (exps.length === 0) E(`${id}: pass 但无 expectations`);
    exps.forEach((x, i) => {
      if (!x.observed) E(`${id}: pass 但预期${i + 1} 无 observed(观察记录)`);
      if (!x.evidence || x.evidence.length === 0) E(`${id}: pass 但预期${i + 1} 无 evidence 截图`);
    });
  } else if (c.verdict === 'fail') {
    if (!c.summary) E(`${id}: fail 缺 summary 一句话`);
    if (!exps.some((x) => x.observed && (x.evidence || []).some((ev) => ev && ev.file)))
      E(`${id}: fail 须至少一条预期带 observed + evidence`);
    if (!(c.reruns >= 1)) E(`${id}: fail 须复跑≥1 次(reruns),排除 flaky 后才能定罪`);
    if (!c.traps_checked || c.traps_checked.length === 0) E(`${id}: fail 须过 traps.md 假阴性区并填 traps_checked`);
    if (!c.repro || c.repro.length === 0) E(`${id}: fail 缺 repro 复现步骤`);
  } else if (c.verdict === 'blocked') {
    if (!c.blocked_by) E(`${id}: blocked 缺 blocked_by(被哪个案例/条件卡住)`);
  } else { // not_run / inconclusive
    if (!c.notes) E(`${id}: ${c.verdict} 缺 notes(缺什么/为什么判不了)`);
    if (c.verdict === 'inconclusive' && allEvidence.size === 0) W(`${id}: inconclusive 建议附两轮观察截图`);
  }
}
(R.side_findings || []).forEach((s, i) => {
  if (!s.desc) E(`side_findings[${i}] 缺 desc`);
  (s.evidence || []).forEach((f) => allEvidence.add(f));
});

// ---- 不通过分档(disposition[].class)----
// 归类是 verdict 之外的另一个轴:verdict 判「符不符合预期」(盲审出),class 判「归到哪、走哪条路」
// (主 agent 出、PM 裁)。不分档 = 所有 ❌ 默认打回开发修代码,口径分歧会被当缺陷派下去硬改。
const CLASSES = {
  code:               { label: '要改代码',      route: '打回开发侧,进本批次收口循环' },
  'spec-divergence':  { label: '要 PM 定口径',  route: '不派发,报差异登记等拍板;拍板前该争议点冻结' },
  'case-stale':       { label: '要改用例',      route: '走用例修订 PR,PM merge 即定稿;不立缺陷单' },
  platform:           { label: '平台受限',      route: '报对应平台仓库跟踪,项目内不修' },
  undetermined:       { label: '归类待判',      route: '交 PM 定路由;不许硬塞进「要改代码」' },
};
const CLASS_ORDER = ['code', 'spec-divergence', 'case-stale', 'platform', 'undetermined'];
const classOf = {}, basisOf = {};   // 用例 id → class / 归档依据(未分档的不进表)
const caseIdSet = new Set((R.cases || []).map((c) => c.id));
(R.disposition || []).forEach((d, i) => {
  if (typeof d !== 'object' || d === null) { E(`disposition[${i}] 须为对象 {class,cases,action,target,basis}`); return; }
  if (!d.action) E(`disposition[${i}] 缺 action(建议做什么,业务语言)`);
  if (d.class === undefined) { W(`disposition[${i}] 未分档——带上 class 才进得了收口路由(枚举:${CLASS_ORDER.join('/')})`); return; }
  if (!CLASSES[d.class]) { E(`disposition[${i}] class 非法 "${d.class}"(只认 ${CLASS_ORDER.join('/')})`); return; }
  if (!d.basis || !String(d.basis).trim())
    E(`disposition[${i}] 带 class 就必须带 basis 一句话(说明书章节号/修正编号/issue 号;归类不由 AI 裁,PM 靠它拍)`);
  if (d.class === 'spec-divergence' && d.basis && !/[;;]/.test(String(d.basis)))
    W(`disposition[${i}] spec-divergence 的 basis 须写全两边说法(「说明书 §X 写……;系统实际……」),PM 才不必翻原文`);
  (d.cases || []).forEach((id) => {
    if (!caseIdSet.has(id)) { W(`disposition[${i}] 引用了 cases 里不存在的用例 ${id}`); return; }
    if (classOf[id] && classOf[id] !== d.class) E(`用例 ${id} 被归了两个档(${classOf[id]} / ${d.class})——一个用例只能有一个去向`);
    classOf[id] = d.class;
    basisOf[id] = basisOf[id] ? basisOf[id] + ';' + d.basis : d.basis;
  });
});
const unclassifiedFails = (R.cases || []).filter((c) => c.verdict === 'fail' && !classOf[c.id]).map((c) => c.id);
if (unclassifiedFails.length)
  W(`以下 ❌ 未被任何处置条目的 cases 覆盖,报告里落「归类待判」:${unclassifiedFails.join('、')}`);

// ---- 证据一致性 ----
if (evidenceDir) {
  if (!fs.existsSync(evidenceDir)) E(`--evidence-dir 不存在: ${evidenceDir}`);
  else {
    const onDisk = new Set(fs.readdirSync(evidenceDir).filter((f) => !f.startsWith('.')));
    for (const f of allEvidence) if (!onDisk.has(f)) E(`引用的证据不在盘上: ${f}`);
    for (const f of onDisk) if (!allEvidence.has(f)) W(`盘上有未被引用的孤儿证据: ${f}`);
  }
} else W('未给 --evidence-dir,跳过证据存在性校验(正式发布前必须校验)');

if (sha && !/^[0-9a-f]{40}$/i.test(sha)) E('--sha 须为 40 位 commit SHA');
if (!sha) W('未给 --sha,图链用 {{SHA}} 占位 —— 正式发布前必须用证据 commit SHA 重渲');

// fail/疑问 摘要须业务语言(给 PM 看的),技术词留在明细评论——启发式告警
const JARGON = /(hook|expand|cel|api|json|sql|http|toast|undefined|null|token|bundle|断言|水合|渲染|序列化|端点|回调|组件)/i;
for (const c of R.cases || [])
  if (c.verdict && c.verdict !== 'pass' && JARGON.test((c.summary || '') + (c.notes || '')))
    W(`${c.id}: 摘要疑似含技术词汇——结论正文须业务语言(谁/在哪/做了什么/该看到什么/实际看到什么),技术细节留在明细评论`);

warns.forEach((w) => console.log('[警告] ' + w));
if (errors.length) {
  errors.forEach((e) => console.error('[错误] ' + e));
  console.error(`\n校验不通过(${errors.length} 错误),拒绝渲染。`);
  process.exit(1);
}

// ---- 渲染 ----
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const link = (f) => `https://github.com/${repo}/blob/${sha || '{{SHA}}'}/${enc((prefix ? prefix + '/' : '') + f)}?raw=true`;
const img = (f) => `![${f}](${link(f)})`;
// 图 + 图注(shows = AI 回看确认的图内可见内容,与图并排供 PM 核验)
const imgCap = (ev) => `${img(ev.file)}\n> 图注:${ev.shows}`;

const stat = { pass: 0, fail: 0, blocked: 0, not_run: 0, inconclusive: 0 };
R.cases.forEach((c) => stat[c.verdict]++);
// 标题里只列非零态 —— 「⛔0 ❓0」这类零值占位纯属噪音,PM 一眼要看到的是通过/没通过
const statLine = [['✅', stat.pass], ['❌', stat.fail], ['⛔', stat.blocked], ['⚠️', stat.not_run], ['❓', stat.inconclusive]]
  .filter(([, n]) => n > 0).map(([e, n]) => `${e}${n}`).join(' ');
const title = `验收 | ${R.title} | ${R.date} | ${statLine}`;
const p0fails = R.cases.filter((c) => c.verdict === 'fail' && c.priority === 'P0');
const overall = stat.fail > 0 ? '❌ 不建议通过'
  : stat.inconclusive + stat.not_run + stat.blocked > 0 ? '⚠️ 无不通过案例,但存在未决项'
    : '✅ 全部通过,建议流转';
// ❌ 的分档统计:未分档的并进「归类待判」——PM 一眼要看到的是「这 N 条各该往哪走」
const failClassOf = (c) => classOf[c.id] || 'undetermined';
const failsByClass = CLASS_ORDER.map((k) => [k, R.cases.filter((c) => c.verdict === 'fail' && failClassOf(c) === k)])
  .filter(([, list]) => list.length);
const classSplit = failsByClass.map(([k, list]) => `${list.length} 条${CLASSES[k].label}`).join('、');

// 结论区排版:一句判断 + 一行数字 + 分组表格。长文进表格单元格,不堆 bullet。
const B = [];
const by = (v) => R.cases.filter((c) => c.verdict === v);
const 结论表 = (标题, 列名, 行) => { B.push(`\n### ${标题}\n`); B.push(`| 用例 | ${列名} |\n|---|---|`); 行.forEach((r) => B.push(r)); };

B.push(`# 验收测试报告:${R.title}(${R.date})`);
B.push(`\n## 结论\n\n**${overall}**` + (classSplit ? ` —— ${stat.fail} 条没通过里:${classSplit}。` : '') + '\n');
B.push(`共 ${R.cases.length} 条用例:通过 **${stat.pass}**、没通过 **${stat.fail}**` +
  (stat.not_run ? `、没测成 **${stat.not_run}**` : '') +
  (stat.inconclusive ? `、有疑问 **${stat.inconclusive}**` : '') +
  (stat.blocked ? `、被卡住 **${stat.blocked}**` : '') + '。');
if (p0fails.length) B.push(`\n主流程断点:${p0fails.map((c) => `**${c.id}** ${c.title}`).join('、')}。`);
// ❌ 按档拆子表:每档一张,多一列「依据」——不同档走完全不同的通道,混成一张表 PM 只能挨个问
failsByClass.forEach(([k, list]) => {
  B.push(`\n### ❌ 没通过 · ${CLASSES[k].label}(${list.length})\n`);
  B.push(`> ${CLASSES[k].route}\n`);
  B.push(`| 用例 | 实际看到什么 | 依据 |\n|---|---|---|`);
  list.forEach((c) => B.push(`| **${c.id}** ${c.title} | ${c.summary} | ${basisOf[c.id] || '—(未分档,待 PM 定路由)'} |`));
});
if (stat.inconclusive) 结论表(`❓ 有疑问,待人工看(${stat.inconclusive})`, '疑在哪', by('inconclusive').map((c) => `| **${c.id}** ${c.title} | ${c.notes || c.summary || ''} |`));
if (stat.not_run) 结论表(`⚠️ 没测成(${stat.not_run})`, '缺什么', by('not_run').map((c) => `| **${c.id}** ${c.title} | ${c.notes || c.summary || ''} |`));
if (stat.blocked) 结论表(`⛔ 被前面的失败卡住(${stat.blocked})`, '卡在哪', by('blocked').map((c) => `| **${c.id}** ${c.title} | ${c.blocked_by} |`));
if (stat.pass) B.push(`\n### ✅ 通过(${stat.pass})\n\n${by('pass').map((c) => c.id).join(' · ')}`);
// 轮次说明:复测批次(带 rounds)才渲染;首轮无此节,正文与旧格式逐字节一致
if (Array.isArray(R.rounds) && R.rounds.length) {
  B.push(`\n## 轮次说明(本 issue 已复测修正,当前第 ${R.rounds[R.rounds.length - 1].round} 轮)\n`);
  B.push(`| 轮 | 日期 | 基线 commit | 本轮执行/更新的用例 | 说明 |\n|---|---|---|---|---|`);
  R.rounds.forEach((r) => B.push(`| 第${r.round}轮 | ${r.date} | \`${String(r.commit || '').slice(0, 8)}\` | ${(r.cases || []).join('、')} | ${r.note || ''} |`));
  B.push(`\n> 结论区与逐用例表为**最新状态**(每用例取最新一次执行的结论,未重测的保留原轮结论);` +
    `历史轮完整 results.json 见本 issue 带「历史轮」标记的归档评论,历史轮明细评论保留不删。`);
}
B.push(`\n## 环境指纹\n`);
B.push(`| 项 | 值 |\n|---|---|`);
B.push(`| serving commit | \`${fp.commit}\`(${fp.server.verified_by}) |`);
B.push(`| 服务 | 端口 ${fp.server.port || '?'}${fp.server.cwd ? ' · ' + fp.server.cwd : ''} |`);
B.push(`| 平台 | ${fp.platform} |`);
if (fp.seeds && fp.seeds.length) B.push(`| 种子 | ${fp.seeds.join('、')} |`);
B.push(`| 账号 | ${Object.entries(fp.accounts).map(([k, v]) => `${k}=${v}`).join('、')} |`);
B.push(`\n## 逐用例结果\n`);
B.push(`✅ 通过 · ❌ 不通过 · ⛔ 阻塞 · ⚠️ 无法执行 · ❓ 无法判定\n`);
B.push(`| 编号 | 测什么 | 级 | 结论 | 关联issue | 说明 |\n|---|---|---|:---:|---|---|`);
for (const c of R.cases) {
  // ❌ 行的说明列前挂档位短标签(不新增列——加列会把编号和说明挤成竖排)
  const note = c.verdict === 'fail' ? `【${CLASSES[failClassOf(c)].label}】${c.summary || ''}`
    : c.verdict === 'blocked' ? `卡在 ${c.blocked_by}`
    : c.verdict === 'pass' ? '' : (c.notes || c.summary || '');
  B.push(`| ${c.id} | ${c.title} | ${c.priority || 'P1'} | ${ICON(c.verdict)} | ${c.issue ? '#' + c.issue : '无'} | ${note} |`);
}
B.push(`\n> 非 ✅ 案例的明细(预期 vs 实际、截图、已排除清单、复现步骤)见本 issue 评论区。`);
if ((R.side_findings || []).length) {
  B.push(`\n## 旁路发现(未立案,待 PM 定)\n`);
  R.side_findings.forEach((s, i) => B.push(`${i + 1}. ${s.desc}${(s.evidence || []).length ? '(证据:' + s.evidence.map(img).join(' ') + ')' : ''}`));
}
if ((R.env_incidents || []).length) {
  B.push(`\n## 环境异常记录(非产品缺陷)\n`);
  B.push(`| 何时 | 现象 | 判断 | 怎么处理的 | 对结论的影响 |\n|---|---|---|---|---|`);
  R.env_incidents.forEach((s) => {
    if (typeof s === 'string') { B.push(`| — | ${s} | — | — | — |`); return; }
    B.push(`| ${s.when || '—'} | ${s.symptom || '—'} | ${s.diagnosis || '—'} | ${s.fix || '—'} | ${s.impact || '—'} |`);
  });
}
B.push(`\n## 处置建议(待 PM 确认,AI 不自行执行)\n`);
if ((R.disposition || []).length) {
  // 按档分组,每档标出路由 —— 分档的意义在于路由分叉,不在于标签好看
  let n = 0;
  const 出条 = (d) => B.push(`${++n}. ${d.action}${d.target ? '(' + d.target + ')' : ''}` +
    `${(d.cases || []).length ? ' —— ' + d.cases.join('、') : ''}${d.basis ? ';依据:' + d.basis : ''}`);
  CLASS_ORDER.forEach((k) => {
    const list = (R.disposition || []).filter((d) => d && d.class === k);
    if (!list.length) return;
    B.push(`\n**${CLASSES[k].label}(${list.length})** —— ${CLASSES[k].route}\n`);
    list.forEach(出条);
  });
  const rest = (R.disposition || []).filter((d) => d && d.class === undefined);
  if (rest.length) { B.push(`\n**未分档(${rest.length})** —— 归档后才进得了收口路由\n`); rest.forEach(出条); }
} else B.push('(无)');
const json = JSON.stringify(R, null, 2);
let details = `\n<details><summary>results.json(机器数据,报告由此渲染)</summary>\n\n\`\`\`json\n${json}\n\`\`\`\n</details>\n`;
let body = B.join('\n');
let jsonSeparate = false;
if ((body + details).length > 60000) { jsonSeparate = true; W('正文超长,results.json 拆到单独评论文件 comment-results-json.md'); }
else body += '\n' + details;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'issue-body.md'), body);
const outFiles = ['issue-body.md'];
if (jsonSeparate) {
  fs.writeFileSync(path.join(outDir, 'comment-results-json.md'), details);
  outFiles.push('comment-results-json.md');
}
for (const c of R.cases.filter((x) => x.verdict !== 'pass')) {
  const C = [];
  C.push(`## ${VERDICTS[c.verdict].split(' ')[0]} ${c.id}:${c.title}`);
  C.push(`\n**结论:${VERDICTS[c.verdict]}**${c.summary ? ' —— ' + c.summary : ''}${c.issue ? '(关联 #' + c.issue + ')' : ''}\n`);
  // 归类只挂在 ❌ 上,且写明是待 PM 裁的建议 —— 与 verdict(盲审的判定)分开呈现,别让 PM 读成一回事
  if (c.verdict === 'fail')
    C.push(`**归类(建议,待 PM 裁):${CLASSES[failClassOf(c)].label}** —— ${CLASSES[failClassOf(c)].route}` +
      `${basisOf[c.id] ? `\n依据:${basisOf[c.id]}` : ''}\n`);
  (c.expectations || []).forEach((x) => {
    C.push(`**预期${x.n}**:${x.expect}`);
    if (x.observed) C.push(`**实际**:${x.observed}`);
    (x.evidence || []).forEach((ev) => C.push(imgCap(ev)));
    C.push('');
  });
  if (c.verdict === 'fail') {
    C.push(`已排除(traps):${c.traps_checked.join('、')};复跑 ${c.reruns} 次同现`);
    C.push(`\n**复现要点**:`);
    c.repro.forEach((s, i) => C.push(`${i + 1}. ${s}`));
  }
  if (c.blocked_by) C.push(`阻塞来源:${c.blocked_by}`);
  if (c.notes) C.push(`备注:${c.notes}`);
  const fn = `comment-${c.id}.md`;
  fs.writeFileSync(path.join(outDir, fn), C.join('\n'));
  outFiles.push(fn);
}

// 「历史轮」归档评论:格式与正文 <details> 同构 + summary 里的「历史轮/第 N 轮」标记,
// history 脚本靠这两点识别旧轮 —— 改这里必须同步改 acceptance-history.cjs(解析契约)
if (PREV) {
  const maxRound = (j) => (Array.isArray(j.rounds) && j.rounds.length)
    ? j.rounds.reduce((m, r) => Math.max(m, r.round || 1), 1) : 1;
  const prevRound = maxRound(PREV);
  const curRound = (Array.isArray(R.rounds) && R.rounds.length) ? maxRound(R) : prevRound + 1;
  const fn = `comment-history-round-${prevRound}.md`;
  fs.writeFileSync(path.join(outDir, fn),
    `<details><summary>历史轮 results.json:第 ${prevRound} 轮(已被第 ${curRound} 轮修正,存档供逐轮反查)</summary>\n\n` +
    `\`\`\`json\n${JSON.stringify(PREV, null, 2)}\n\`\`\`\n</details>\n`);
  outFiles.push(fn);
}

// 状态标签 = 总结论的镜像(SKILL ⑤「状态标签」条款):在这里算出来打印,发布方照贴,防手算挂错
const statusLabel = stat.fail > 0 ? '验收:不通过'
  : stat.inconclusive + stat.not_run + stat.blocked > 0 ? '验收:未决'
    : '验收:通过';
console.log(`\n建议 issue 标题:\n${title}\n`);
console.log(`建议状态标签:${statusLabel}(与「验收记录」并挂,三枚互斥,换标=摘旧贴新)\n`);
console.log(`产出(${outDir}):\n  ` + outFiles.join('\n  '));
if (!sha) console.log('\n⚠️ 图链为 {{SHA}} 占位,发布前须带 --sha 重渲。');
if (Array.isArray(R.rounds) && R.rounds.length) {
  console.log('\n复测批次:不建新 issue。先把 comment-history-round-N.md 贴进原验收 issue' +
    '(漏归档 = 机读历史断轮),再 gh issue edit 用 issue-body.md 替换正文、按上面统计尾巴改标题、' +
    '按上面建议换状态标签、摘过程标签「验收:复测中」;历史轮明细评论保留不删。');
  if (!PREV) console.log('⚠️ 本次未带 --archive-prev:确认上一轮 results.json 已归档过,否则先补归档评论再修正正文。');
}
console.log('渲染完成。');
