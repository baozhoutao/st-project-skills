# assets — pm-test 配套脚本(加速器,非门槛)

**定位(2026-08-08 拍板):这些脚本是加速器,不是开工前置。** 项目里没有它们,PM 验收照样开工——skill 正文的检查与产出约定都可以手工等价执行,脚本只是把机械动作固化省时。**任何情况下不得以「设施未就位」为由推迟验收开工。**

| 文件 | 用途 | 缺位时的等价手工路径 |
|---|---|---|
| `acceptance-lint.cjs` | 用例文件门禁(格式/可判定性,`--draft` 起草模式) | 按 case-template.md 要素逐条人工核对,不齐的案例标 ⚠️ 退回 |
| `acceptance-report.cjs` | results.json → 验收 issue 正文+明细评论(含图链/证据一致性校验);❌ 按 `disposition[].class` 分档拆子表并在处置清单里按档标路由;复测批次渲染 `rounds` 轮次说明小节,`--archive-prev <上一轮results.json>` 产出「历史轮」标记归档评论(修正正文前先贴) | 按 SKILL.md ⑤ 的 results.json 结构与图链规范手写 issue 正文,❌ 按 ⑥ 的档位分组 |
| `lib.cjs` | UI 驱动框架层(Console/H5 登录、截图落盘、导入向导、环境探针、账号基线) | 执行子 agent 用浏览器工具直接操作;磨合出的能力回填成脚本 |
| `acceptance-history.cjs` | 用例→历轮验收结果反查(派生视图:issue/时间/verdict/平台版本;含「最近非 pass」「从未测过」清单;只读,走 REST)。同一 issue 多轮时按轮合并出逐轮序列:正文=最新轮,「历史轮」标记评论=旧轮,单用例明细给跨轮演进行(第1轮 ❌ → 第2轮 ✅) | `gh search issues "<用例id>" --label 验收记录` |

## 启用方式

复制进项目(路径按 skill 正文约定):

```bash
cp assets/acceptance-lint.cjs assets/acceptance-report.cjs <项目>/scripts/
mkdir -p <项目>/scripts/acceptance && cp assets/lib.cjs <项目>/scripts/acceptance/lib.cjs
```

`lib.cjs` 环境变量(项目专属值不入库,一律走 env):

| 变量 | 必填 | 说明 |
|---|---|---|
| `OS_BASE` | 否 | 服务地址,默认 `http://localhost:3000` |
| `OS_TEST_PASS` | **是** | 测试账号统一密码(登录/建号时校验,缺了报错提示) |
| `OS_APP` | **是** | Console 应用路由名(用 `listApps()` 核实后设置) |
| `OS_ADMIN_EMAIL` / `OS_ADMIN_PASS` | 否 | 平台管理员,默认 `admin@objectos.ai` / `admin123` |
| `PLAYWRIGHT_MODULE` | 否 | playwright 模块路径(项目本地已 `npm i -D playwright` 则不用设) |
| `PLAYWRIGHT_BROWSERS_PATH` | 否 | 浏览器缓存目录,默认按平台惯例探测 |

## 与源项目版本的差异

- `lib.cjs` 做了通用化:测试密码与 Console 应用名从项目默认值改为必填 env;playwright 模块与浏览器可执行文件从写死的机器路径改为自动探测(项目本地安装优先,env 兜底);其余逻辑与源项目实测版一致。
- `acceptance-lint.cjs` / `acceptance-report.cjs` 为原样副本(零项目私货,仓库名自动从 git remote 读取);report 的 `rounds` 渲染与 `--archive-prev` 归档为库内增强(2026-08-08 首个落地项目 PM 拍板:同批次复测修正原验收 issue,不开新 issue)。
- `acceptance-history.cjs` 为库内新增(2026-08-08),源项目尚无。

## report ↔ history 解析契约(改一边必须同步另一边)

history 的机读历史完全建立在 report 的发布结构上,契约共三点:

1. **正文 `<details>` 里的 ```json 围栏** = 该 issue 的最新轮 results.json(正文超长时拆到单独评论);
2. **`rounds` 顶层数组** = 「该 issue 复测过」的唯一信号——history 只在正文 JSON 带 `rounds` 时才翻评论找历史轮(无 rounds = 单轮,不翻评论,旧格式行为与配额都不变);
3. **「历史轮」标记归档评论**(`--archive-prev` 产出,summary 含「历史轮 … 第 N 轮」)= 旧轮数据源——复测修正正文前必须先贴,漏归档 = 机读历史断轮(history 会在单用例明细里把「轮号 >1 但只剩一轮」的 issue 标出来)。

改 `<details>`/围栏/历史轮标记/`rounds` 语义中的任何一个,两脚本必须同步改,并跑一遍两轮样例自检(首轮渲染 → 复测渲染+归档 → history 逐轮解析)。
