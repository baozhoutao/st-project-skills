#!/usr/bin/env node
/**
 * acceptance-history.cjs — 用例 → 历轮验收结果反查(派生视图)
 * 单一真值永远在「验收记录」issue 的 results.json;本脚本只做按需汇总,不落任何台账文件。
 *
 * 轮次模型(与 acceptance-report.cjs 互为解析契约,改一边必须同步另一边):
 *   同一验收 issue 可含多轮——正文 <details> 的 results.json = 最新轮;复测归档的
 *   「历史轮」标记评论(report --archive-prev 产出)= 旧轮,按轮合并出逐轮序列;
 *   正文不带 rounds = 单轮 issue,不翻评论找历史轮(省配额,旧格式行为不变)。
 *
 * 用法: node scripts/acceptance-history.cjs [caseId ...] [选项]
 *   无 caseId   全量视图:每个用例的轮次数 + 最近一轮结果;末尾列「最近一轮非 pass」清单
 *   给 caseId   输出这些用例的完整历史(逐轮 issue/日期/verdict/平台版本/commit;
 *               同一 issue 多轮时先给一行跨轮演进,如「第1轮 ❌ → 第2轮 ✅」)
 * 选项:
 *   --repo owner/name   仓库(默认从 git remote 读)
 *   --label <名>        验收 issue 标签(默认 验收记录)
 *   --cases <目录>      用例文件目录(如 docs/验收测试用例);给了就额外列「从未测过」的用例
 *   --json              机读输出
 * 走 REST(gh api),避开 GraphQL 配额。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
function opt(name, dflt) { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : dflt; }
function flag(name) { const i = args.indexOf('--' + name); if (i >= 0) { args.splice(i, 1); return true; } return false; }
const asJson = flag('json');
const label = opt('label', '验收记录');
const casesDir = opt('cases', null);
let repo = opt('repo', null);
if (!repo) {
  try {
    const m = execSync('git remote get-url origin', { encoding: 'utf8' }).trim().match(/github\.com[:/]+([^/]+\/[^/.]+)/);
    repo = m && m[1];
  } catch (_) {}
}
if (!repo) { console.error('无法识别仓库:用 --repo owner/name 指定'); process.exit(1); }
const wanted = args.slice();

/* ---- 拉全部验收 issue(REST,--paginate 输出多个数组,拼接归一) ---- */
function restAll(p) {
  const raw = execSync(`gh api "${p}" --paginate`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse('[' + raw.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/\]\s*\[/g, ',') + ']');
}
const issues = restAll(`repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100`);

/* ---- 从 issue 正文 <details> 里抠 results.json ---- */
function extractResults(body) {
  if (!body) return null;
  for (const f of body.matchAll(/```json\s*\n([\s\S]*?)```/g)) {
    try { const j = JSON.parse(f[1]); if (j && Array.isArray(j.cases)) return j; } catch (_) {}
  }
  return null;
}

/* ---- 逐 issue 抽取(轮次模型):正文 = 最新轮;「历史轮」标记评论 = 旧轮 ---- */
const HIST_MARK = /历史轮/;
const maxRound = (r) => (r && Array.isArray(r.rounds) && r.rounds.length)
  ? r.rounds.reduce((m, x) => Math.max(m, x.round || 1), 1) : 1;

const history = new Map(); // caseId -> rows[](row 含 round)
const unparsed = [];
for (const is of issues) {
  if (is.pull_request) continue;
  let latest = extractResults(is.body);
  let comments = null;
  // 只在两种情况翻评论:正文没 JSON(超长拆分兜底)/ 正文带 rounds(复测过,评论区有历史轮归档)
  const retested = (r) => r && Array.isArray(r.rounds) && r.rounds.length > 0;
  if (!latest || retested(latest)) comments = restAll(`repos/${repo}/issues/${is.number}/comments?per_page=100`);
  if (!latest && comments) {
    for (const c of comments) {
      if (HIST_MARK.test(c.body || '')) continue; // 历史轮归档不是最新轮
      latest = extractResults(c.body);
      if (latest) break;
    }
    if (retested(latest) === false) comments = null; // 拆分评论里的最新轮无 rounds → 单轮,不再扫历史轮
  }
  if (!latest) { unparsed.push(is.number); continue; }
  // 按轮收集:最新轮 + 历史轮归档;同轮号以最新正文为准(防误归档当前轮)
  const byRound = new Map([[maxRound(latest), latest]]);
  if (comments && retested(latest)) {
    for (const c of comments) {
      if (!HIST_MARK.test(c.body || '')) continue;
      const r = extractResults(c.body);
      if (!r) continue;
      const m = (c.body || '').match(/第\s*(\d+)\s*轮/);
      const rn = m ? parseInt(m[1], 10) : maxRound(r);
      if (!byRound.has(rn)) byRound.set(rn, r);
    }
  }
  for (const [rn, r] of byRound) {
    const fp = r.fingerprint || {};
    for (const c of r.cases || []) {
      if (!c.id) continue;
      if (!history.has(c.id)) history.set(c.id, []);
      history.get(c.id).push({
        issue: is.number,
        round: rn,
        date: r.date || (is.created_at || '').slice(0, 10),
        verdict: c.verdict || '?',
        platform: fp.platform || '?',
        commit: (fp.commit || '').slice(0, 8),
        summary: c.summary || '',
      });
    }
  }
}
for (const rows of history.values())
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.issue - a.issue || (b.round || 1) - (a.round || 1));

/* ---- 可选:对照用例目录找「从未测过」 ---- */
let neverTested = null;
if (casesDir) {
  neverTested = [];
  for (const f of fs.readdirSync(casesDir).filter((x) => x.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(casesDir, f), 'utf8');
    for (const m of text.matchAll(/^##\s+([A-Z][A-Z0-9]*-\d+)\s*[::]/gm)) {
      if (!history.has(m[1])) neverTested.push({ id: m[1], file: f });
    }
  }
}

/* ---- 输出 ---- */
const MARK = { pass: '✅', fail: '❌', blocked: '⛔', not_run: '⚠️', inconclusive: '❓' };
const mk = (v) => `${MARK[v] || '·'} ${v}`;

if (asJson) {
  console.log(JSON.stringify({
    repo, label,
    cases: Object.fromEntries(history),
    never_tested: neverTested,
    unparsed_issues: unparsed,
  }, null, 2));
  process.exit(0);
}

if (wanted.length) {
  for (const id of wanted) {
    const rows = history.get(id);
    console.log(`\n${id} 历史(${rows ? rows.length : 0} 轮):`);
    if (!rows) { console.log('  (无记录——从未出现在任何验收 issue 中)'); continue; }
    // 按 issue 分组(保持新→旧序);同一 issue 多轮时先给一行跨轮演进,再逐轮明细
    const byIssue = new Map();
    for (const r of rows) { if (!byIssue.has(r.issue)) byIssue.set(r.issue, []); byIssue.get(r.issue).push(r); }
    for (const [no, rs] of byIssue) {
      const asc = [...rs].sort((a, b) => (a.round || 1) - (b.round || 1));
      const multi = asc.length > 1 || (asc[0].round || 1) > 1; // 轮号>1 但只剩一轮 = 历史轮漏归档,也标出来
      if (multi) console.log(`  #${no} 跨轮演进:${asc.map((r) => `第${r.round}轮 ${MARK[r.verdict] || '·'}`).join(' → ')}`);
      for (const r of asc)
        console.log(`  #${r.issue}${multi ? ` 第${r.round}轮` : ''}  ${r.date}  ${mk(r.verdict)}  ${r.platform}  ${r.commit}${r.summary ? '  ' + r.summary : ''}`);
    }
  }
} else {
  const ids = [...history.keys()].sort();
  console.log(`用例 × 历轮验收(${ids.length} 个用例,${issues.length} 个「${label}」issue):\n`);
  for (const id of ids) {
    const rows = history.get(id);
    const last = rows[0];
    const roundTag = (last.round || 1) > 1 ? ` 第${last.round}轮` : '';
    console.log(`${id.padEnd(12)} ${String(rows.length).padStart(2)} 轮  最近:#${last.issue}${roundTag} ${last.date} ${mk(last.verdict)} ${last.platform}`);
  }
  const bad = ids.filter((id) => history.get(id)[0].verdict !== 'pass');
  if (bad.length) {
    console.log(`\n⚠️ 最近一轮非 pass(${bad.length}):`);
    for (const id of bad) {
      const l = history.get(id)[0];
      console.log(`  ${id}  #${l.issue}${(l.round || 1) > 1 ? ` 第${l.round}轮` : ''} ${l.date} ${mk(l.verdict)}${l.summary ? '  ' + l.summary : ''}`);
    }
  }
}
if (neverTested && neverTested.length) {
  console.log(`\n🕳 从未测过(${neverTested.length}):`);
  for (const n of neverTested) console.log(`  ${n.id}  (${n.file})`);
}
if (unparsed.length) console.log(`\n(注:${unparsed.length} 个带该标签的 issue 未解析出 results.json,已跳过:#${unparsed.join(' #')})`);
