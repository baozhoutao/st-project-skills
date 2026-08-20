# st-project-skills

steedos 平台([steedos-platform](https://github.com/steedos/steedos-platform))项目交付 skill 库:目前覆盖 **需求 → 开发 → 调度/验收 → 规范横切** 的可复用流程资产,源自 [os-project-skills](https://github.com/baozhoutao/os-project-skills) 的同名 skill 改造而来。

> 定位:**skill 全是给 AI 岗位用的,人只在闸门上消费 skill 的产出物做决策。**

## 命名规则

```
st-project-<阶段标识>-<功能标识>
```

- 全小写、连字符分隔,禁大写
- **阶段标识是封闭集合**(沿用 os-project-skills 的九段划分:pre / req / dev / impl / pilot / pm / std / kb / meta),本库当前落地 `req` / `dev` / `pm` / `std` 四段
- 功能标识:单个名词,一眼见义
- 一个 skill 只固化一道工序;TRIGGER(何时用)/ SKIP(何时不用)必须写进 frontmatter description

## Skill 总表(15 个)

> 建设状态:全部 **可用(未实战)**——从 os-project-skills 迁移改造,尚未在 steedos 真实项目跑通;「可用 → 已验证」的升级以真实项目跑通为准(pm-case / pm-test 的流程本身在上游 os 项目已实战验证过,steedos 项目上仍按未实战对待)。

### 需求 `req`
| skill | 职责 | 防什么错 |
|---|---|---|
| [st-project-req-research](skills/st-project-req-research/SKILL.md) | 调研:访谈提纲、纪要→结构化需求、疑点选择题 | 调研变闲聊;开会发散不收敛 |
| [st-project-req-baseline](skills/st-project-req-baseline/SKILL.md) | SRS+验收标准成唯一基准;差异登记与变更流程 | 代码和文档各说各话;验收扯皮;范围蔓延 |
| [st-project-req-refine](skills/st-project-req-refine/SKILL.md) | 工作项细化七要素 + DoR 就绪门禁 | 模糊需求进开发——最贵的返工源头 |

### 开发 `dev`
| skill | 职责 | 防什么错 |
|---|---|---|
| [st-project-dev-blueprint](skills/st-project-dev-blueprint/SKILL.md) | 总体方案蓝图:SRS→steedos 能力映射全景清单、对象模型总表、集成接口台账、模块依赖 | 能力使用面无全景统计;接口无正式台账;dev-design 判影响面没有地图 |
| [st-project-dev-design](skills/st-project-dev-design/SKILL.md) | 方案分级:纯新增自主干/改已有先报方案 | AI 自作主张动老功能 |
| [st-project-dev-issue](skills/st-project-dev-issue/SKILL.md) | 开发闭环:隔离分支→实现→自测→PR→状态流转 | 污染主干;"做完了"没证据 |
| [st-project-dev-test](skills/st-project-dev-test/SKILL.md) | 测试:从需求推计划、真机实测、证据报告 | 自证偏误;拿代码当功能证据 |
| [st-project-dev-regression](skills/st-project-dev-regression/SKILL.md) | 夜间回归:活清单维护+失败自动立缺陷单 | 新功能悄悄弄坏老功能 |
| [st-project-dev-inventory](skills/st-project-dev-inventory/SKILL.md) | 平台配置清单派生:从 steedos 元数据导出对象×字段/权限矩阵/触发器/定时任务/页面/接口全景视图;只派生禁回写 | 配置全景无账可查;手工维护的详细设计漂移成第二真值 |
| [st-project-dev-review](skills/st-project-dev-review/SKILL.md) | 合并前 AI 独立代码评审:通用质量走内置 `/code-review`,叠加改动面越界等专属核查 | 自主合并链路上无人读代码 |

### 管理/验收横切 `pm`
| skill | 职责 | 防什么错 |
|---|---|---|
| [st-project-pm-dispatch](skills/st-project-pm-dispatch/SKILL.md) | 批量调度:拉就绪项→并行派发→收报告→看板;单项也按「1 项的批」走 | 串行浪费;吞吐上不去;主会话亲自开发失去隔离 |
| [st-project-pm-case](skills/st-project-pm-case/SKILL.md) | 验收用例起草:AI 起草→PR→PM merge 即定稿;预期只来自需求,推断显式标记 | 用实现验证实现;AI 理解冒充需求 |
| [st-project-pm-test](skills/st-project-pm-test/SKILL.md) | PM 验收测试:主 agent 只调度,执行与盲审全部下沉独立子 agent,五态结论 | 边测边下结论;无证据判定;基线污染;重复报 issue |

### 规范横切 `std`
| skill | 职责 |
|---|---|
| [st-project-std-git](skills/st-project-std-git/SKILL.md) | 分支/PR/状态标签流转;绝不动主干 |
| [st-project-std-evidence](skills/st-project-std-evidence/SKILL.md) | 证据规范:证据三性、截图标准、图链四禁令、证据存放模式、报告可复核 |

## 收录边界:只收需求、开发、测试三段

本库**明确不收**文档类与其他阶段的 skill,遇到正文引用按下表处理:

| 引用到的 skill | 处理 |
|---|---|
| `st-project-std-docs`(Word 模板/排版)、`st-project-pm-accept`(验收文档包) | **不收录(文档类)**——引用处涉及交付格式的,按项目自己的文档约定执行,或直接以 markdown 挂 issue 为准 |
| `st-project-pre-*`(售前)、`st-project-pilot-ops`(试运行) | **不收录(阶段外)**——有需要时再从 os-project-skills 迁移 |
| `st-project-meta-retro`(经验闭环) | **暂缺(待建)**——迁入前按「两条铁律」第 2 条手工执行 |

## 平台知识边界

- **平台知识 skill(`steedos-*` 族,如 `steedos-project-package`)不入本库。** 那是平台方资产,随平台版本走;`st-project-` 命名空间只留给自己沉淀的流程资产。
- 涉及 steedos 元数据(objects / triggers / pages / permissions 等)的语义细节,一律引用 steedos 平台 skill 或官方文档,本库 skill 里不复读。

## 使用方式

项目仓库通过 **复制或 symlink** 引用本库的 skill 到项目的 `.claude/skills/` 下:

```bash
# 方式一:symlink(推荐,本库更新即时生效)
ln -s ~/GitHub/st-project-skills/skills/st-project-dev-issue <项目仓库>/.claude/skills/st-project-dev-issue

# 方式二:复制(需要按项目微调时)
cp -r ~/GitHub/st-project-skills/skills/st-project-dev-issue <项目仓库>/.claude/skills/
```

## 两条铁律

1. **skill 里只写约定,不写项目具体内容。** 客户名、环境地址、仓库名、业务参数一律放项目仓库自己的配置/CLAUDE.md;仓库名等上下文让 skill 从 `git remote` 自动识别。
2. **一处纠错,skill 同步更新。** 每次人工纠错后回答"哪个 skill 该更新才能让这个错不再犯",当场更新(meta-retro 工序未迁入前手工执行)。

## 维护纪律

- skill 的 TRIGGER/SKIP 写不清 = 不许合入。
- 每个 skill 头部标注建设状态:`骨架` → `可用` → `已验证`(在真实 steedos 项目跑通一单才算已验证)。
- 与上游 os-project-skills 的关系:**单向借鉴,不做同步义务**;上游有好改进按需手工搬运。
