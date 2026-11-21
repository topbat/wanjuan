# 万卷数据模型规范（v1.0）

> 本文是整个知识库的**数据契约**：所有 `content/` 下的 Markdown 文件、构建脚本 `scripts/`、
> 前端站点 `site/` 都必须遵循本规范。修改本规范属于破坏性变更，需在提交说明中标注 `schema!`。

## 1. 核心原则

1. **一文件一实体**：一首诗 / 一条成语 / 一句名句 / 一位作者 / 一个意象 = 一个 `.md` 文件。
2. **frontmatter 即数据库**：所有结构化数据（元数据、关系边、标签）写在 YAML frontmatter，正文是人类阅读的内容。
3. **一切可回源**：索引中每条记录保留 `srcPath`（相对仓库根的源文件路径）；图谱节点携带 `source_anchor`。
4. **公版与增值分离**：`## 原文` 区块必须为公版内容；注释、译文等自研增值内容单独分块并标注 `> 仅供参考`。

## 2. frontmatter 字段规范

### 2.1 作品（content/poems/）

```yaml
---
id: tang-libai-jingyesi          # 全局唯一：{朝代}-{作者}-{篇名拼音}
title: 静夜思
title_pinyin: jing ye si          # 构建期可自动生成，手写优先
author: 李白
dynasty: 唐                       # 先秦|汉|魏晋|南北朝|唐|宋|元|明|清|近现代
form: 五言绝句                    # 体裁：乐府|诗|词|曲|文（词须另有 tune 词牌）
tune:                             # 词牌，仅词填写，如"水调歌头"
genre: 思乡                       # 题材：思乡|送别|田园|边塞|咏物|咏史|哲理|家国|爱情|四季…
imagery: [月, 霜]                 # 意象标签，须对应 content/imagery/ 中已有实体
allusions: []                     # 用典，对应典故名
tags: [唐诗三百首, 小学必背]       # 文学本体标签（自由扩展）
curriculum:                       # 课标双轨标签（对齐教育部课标）
  stage: primary                   # primary|junior|senior
  grade: 1                         # 小学 1-6；初中 7-9；高中 10-12
  semester: 上                     # 上|下（可空）
  recitation: true                 # 是否课标推荐背诵篇目
  task_group: 语言文字积累与梳理    # 学习任务群（可空）
source:                            # 出处
  anthology: 李太白集              # 总集/别集
  year:                            # 创作年份（可空，逐步补全）
links:                             # 关系边（谓词白名单见 §3）
  - rel: 属朝代
    to: 唐
  - rel: 含意象
    to: 月
notes:                             # 自研增值内容标记
  annotated: true                  # 是否已有人工校对的注释
  translated: false
---
```

### 2.2 成语（content/idioms/）

```yaml
---
id: idiom-qingmeizhuma
word: 青梅竹马
pinyin: qīng méi zhú mǎ
pinyin_plain: qing mei zhu ma     # 无声调，接龙/检索用
first: q                          # 首字拼音（接龙）
last: a                           # 尾字拼音（接龙）
meaning: 形容男女小时候天真无邪，一起玩耍。
origin: 唐·李白《长干行》："郎骑竹马来，绕床弄青梅。同居长干里，两小无嫌猜。"
origin_link: tang-libai-changganxing   # 溯源到本库作品 id（若有）
semantic_field: 爱情·童年          # 语义场：口才|勇气|勤奋|诚信|谋略|爱情|童年…
synonyms: [两小无猜, 总角之交]
antonyms: []
curriculum: { stage: primary, grade: 5, recitation: false }
tags: [出自诗词]
---
```

### 2.3 名句（content/quotes/）

```yaml
---
id: quote-tiansheng-wocai
text: 天生我材必有用
author: 李白
work: 将进酒                        # 源作品 id
theme: [自信, 豁达]                 # 适用主题（作文引用场景）
dynasty: 唐
curriculum: { stage: junior, grade: 9, recitation: true }
tags: [作文素材]
---
```

### 2.4 作者（content/authors/）

```yaml
---
id: author-libai
name: 李白
courtesy: 太白                      # 字
pseudonym: 青莲居士                 # 号
birth: 701                          # 年份（公元前加负号）
death: 762
dynasty: 唐
wikidata: Q4333                     # Wikidata QID（对齐外部知识库）
cbdb: 33923                        # CBDB 人物 ID（若有）
school: 浪漫主义                    # 流派
masters: []                        # 师承（作者 id 列表）
friends: [杜甫, 高适, 孟浩然]        # 交游
famous_forms: [乐府, 绝句]
tags: [诗仙]
---
```

### 2.5 意象（content/imagery/）

```yaml
---
id: imagery-yue
name: 月
senses:                            # 一象多情
  - sense: 思乡怀人
    weight: 0.6                    # 常见度权重（构建期统计可校正）
  - sense: 永恒之叹
    weight: 0.2
  - sense: 孤高澄澈
    weight: 0.2
representative:                    # 高频例句（构建期自动统计，手写起步）
  - work: tang-libai-jingyesi
    line: 床前明月光
tags: [核心意象]
---
```

## 3. 关系谓词白名单（15 条）

图谱的边类型**只能**使用以下谓词，新增谓词需修改本规范：

| 谓词 | 主体 → 客体 | 说明 |
|---|---|---|
| 创作 | 作者 → 作品 | |
| 属朝代 | 作者/作品 → 朝代 | |
| 属体裁 | 作品 → 体裁 | |
| 属题材 | 作品 → 题材 | |
| 含意象 | 作品 → 意象 | |
| 用典 | 作品 → 典故 | |
| 师承 | 作者 → 作者 | |
| 交游 | 作者 ↔ 作者 | 无向 |
| 近义 | 成语 ↔ 成语 | 无向 |
| 反义 | 成语 ↔ 成语 | 无向 |
| 出处 | 成语/名句 → 作品/事件 | |
| 主题 | 名句 → 主题标签 | |
| 对比 | 作品 ↔ 作品 | 同题材异写 |
| 化用 | 作品 → 作品 | 袭句/点化 |
| 学段 | 作品 → 学段 | 课标对齐 |

## 4. 双轨标签体系

- **文学本体轨**：体裁 / 题材 / 意象 / 流派 / 选本（自由扩展，用于文学研究视角）
- **课标轨**：`curriculum.*`（学段、年级、必背、任务群）——字段值以教育部课标为准，不自由发挥

两轨叠加自动生成"课标覆盖进度"统计。

## 5. 构建产物契约（scripts → site）

`scripts/build-index.mjs` 产出（输出至 `site/public/indexes/`）：

| 文件 | 内容 |
|---|---|
| `search.json` | 全量检索索引（含分词 tokens、拼音、首字母） |
| `poems.json` / `idioms.json` / `quotes.json` | 分类列表（每条含 `srcPath`） |
| `graph.json` | `{nodes: [{id, label, type, degree, anchor}], links: [{source, target, rel}]}` |
| `stats.json` | 标签计数、词频、高频人物、意象分布、课标覆盖 |

硬性要求：

1. 每条索引记录必须含 `srcPath`（回源跳转的唯一依据）。
2. 构建脚本全流程输出**中文结构化日志**（见 `scripts/lib/logger.mjs`）。
3. 校验失败（缺必填字段、谓词不在白名单）必须以错误日志退出非零码，不得静默跳过。
