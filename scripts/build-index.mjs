#!/usr/bin/env node
/**
 * 万卷 · 索引构建管线
 *
 * 流程：扫描 content/ → gray-matter 解析 → zod 必填字段校验 → 谓词白名单校验
 *      → Intl.Segmenter 分词 → pinyin-pro 全拼/首字母 → 统计 → 知识图谱（nodes/links）
 *      → 写出 6 个 JSON 至 site/public/indexes/
 *
 * 产物契约见 docs/data-model.md §5：
 *   search.json / poems.json / idioms.json / quotes.json / graph.json / stats.json
 *   硬性要求：每条索引记录必须含 srcPath；校验失败必须以错误日志退出非零码。
 *
 * 用法：node scripts/build-index.mjs [--verbose]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fg from 'fast-glob'
import matter from 'gray-matter'
import { pinyin } from 'pinyin-pro'
import { z } from 'zod'
import { createLogger } from './lib/logger.mjs'

// ─────────────────────────── 常量与路径 ───────────────────────────

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const CONTENT_DIR = path.join(ROOT, 'content')
const OUT_DIR = path.join(ROOT, 'site', 'public', 'indexes')

/** 关系谓词白名单（docs/data-model.md §3，共 15 条） */
const PREDICATES = new Set([
  '创作', '属朝代', '属体裁', '属题材', '含意象', '用典', '师承', '交游',
  '近义', '反义', '出处', '主题', '对比', '化用', '学段',
])

/** 学段代码 → 中文名 */
const STAGE_LABEL = { primary: '小学', junior: '初中', senior: '高中' }

const ENTITY_TYPES = ['poems', 'idioms', 'quotes', 'authors', 'imagery']
const ENTITY_TYPE_NAME = { poems: '作品', idioms: '成语', quotes: '名句', authors: '作者', imagery: '意象' }

const verbose = process.argv.includes('--verbose')
const log = createLogger({ verbose })

// ─────────────────────────── zod 模式 ───────────────────────────

const curriculumSchema = z.object({
  stage: z.enum(['primary', 'junior', 'senior'], { errorMap: () => ({ message: '学段取值不合法（应为 primary/junior/senior）' }) }),
  grade: z.number({ invalid_type_error: '年级必须是数字' }).int('年级必须是整数').min(1).max(12),
  semester: z.enum(['上', '下']).nullish(),
  recitation: z.boolean().default(false),
  task_group: z.string().nullish(),
})

const linkSchema = z.object({
  rel: z.string({ required_error: 'links[].rel 必填' }),
  to: z.string({ required_error: 'links[].to 必填' }),
})

const poemSchema = z.object({
  id: z.string({ required_error: '必填字段缺失' }).min(1),
  title: z.string({ required_error: '必填字段缺失' }).min(1),
  title_pinyin: z.string().nullish(),
  author: z.string({ required_error: '必填字段缺失' }).min(1),
  dynasty: z.string({ required_error: '必填字段缺失' }).min(1),
  form: z.string({ required_error: '必填字段缺失' }).min(1),
  tune: z.string().nullish(),
  genre: z.string({ required_error: '必填字段缺失' }).min(1),
  imagery: z.array(z.string()).default([]),
  allusions: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  curriculum: curriculumSchema,
  source: z.object({ anthology: z.string().nullish(), year: z.union([z.number(), z.string()]).nullish() }).nullish(),
  links: z.array(linkSchema).default([]),
  notes: z.object({ annotated: z.boolean().nullish(), translated: z.boolean().nullish() }).nullish(),
}).passthrough()

const idiomSchema = z.object({
  id: z.string({ required_error: '必填字段缺失' }).min(1),
  word: z.string({ required_error: '必填字段缺失' }).min(1),
  pinyin: z.string({ required_error: '必填字段缺失' }).min(1),
  pinyin_plain: z.string({ required_error: '必填字段缺失' }).min(1),
  first: z.string({ required_error: '必填字段缺失' }).min(1),
  last: z.string({ required_error: '必填字段缺失' }).min(1),
  meaning: z.string({ required_error: '必填字段缺失' }).min(1),
  origin: z.string().nullish(),
  origin_link: z.string().nullish(),
  semantic_field: z.string().nullish(),
  synonyms: z.array(z.string()).default([]),
  antonyms: z.array(z.string()).default([]),
  curriculum: curriculumSchema,
  tags: z.array(z.string()).default([]),
}).passthrough()

const quoteSchema = z.object({
  id: z.string({ required_error: '必填字段缺失' }).min(1),
  text: z.string({ required_error: '必填字段缺失' }).min(1),
  author: z.string({ required_error: '必填字段缺失' }).min(1),
  work: z.string().nullish(),
  theme: z.array(z.string()).default([]),
  dynasty: z.string({ required_error: '必填字段缺失' }).min(1),
  curriculum: curriculumSchema,
  tags: z.array(z.string()).default([]),
}).passthrough()

const authorSchema = z.object({
  id: z.string({ required_error: '必填字段缺失' }).min(1),
  name: z.string({ required_error: '必填字段缺失' }).min(1),
  courtesy: z.string().nullish(),
  pseudonym: z.string().nullish(),
  birth: z.number({ invalid_type_error: '生年必须是数字（公元前用负数）' }).nullish(),
  death: z.number({ invalid_type_error: '卒年必须是数字（公元前用负数）' }).nullish(),
  dynasty: z.string({ required_error: '必填字段缺失' }).min(1),
  wikidata: z.string().nullish(),
  cbdb: z.union([z.string(), z.number()]).nullish(),
  school: z.string().nullish(),
  masters: z.array(z.string()).default([]),
  friends: z.array(z.string()).default([]),
  famous_forms: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
}).passthrough()

const imagerySchema = z.object({
  id: z.string({ required_error: '必填字段缺失' }).min(1),
  name: z.string({ required_error: '必填字段缺失' }).min(1),
  senses: z.array(z.object({ sense: z.string(), weight: z.number().min(0).max(1).default(0) })).default([]),
  representative: z.array(z.object({ work: z.string().nullish(), line: z.string() })).default([]),
  tags: z.array(z.string()).default([]),
}).passthrough()

const SCHEMAS = { poems: poemSchema, idioms: idiomSchema, quotes: quoteSchema, authors: authorSchema, imagery: imagerySchema }

// ─────────────────────────── 工具函数 ───────────────────────────

/** 仓库根相对路径（正斜杠），作为 srcPath / anchor */
function toSrcPath(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/')
}

/** 中文分词（Intl.Segmenter，词级，仅保留"词"片段） */
const segmenter = new Intl.Segmenter('zh-Hans', { granularity: 'word' })
// 文言/现代汉语高频虚词与功能词：不承载意象与题旨，词云与检索均无信息量
const STOPWORDS = new Set([
  // 文言虚词
  '之', '其', '而', '以', '于', '也', '不', '无', '有', '为', '与', '者', '曰', '兮', '何', '如',
  '若', '此', '彼', '所', '则', '乃', '且', '但', '又', '已', '未', '莫', '相', '皆', '焉', '哉',
  '乎', '矣', '耳', '尔', '汝', '吾', '夫', '故', '因', '遂', '亦', '复', '更', '却', '还', '只',
  '共', '同', '各', '每', '诸', '等', '或', '然', '故', '是', '非', '得', '能', '可', '自', '从',
  '来', '去', '上', '下', '中', '里', '外', '时', '处', '地', '天', '人', '一', '二', '三', '四',
  '五', '六', '七', '八', '九', '十', '千', '万', '不', '知', '不能', '可以', '不知', '然后',
  '于是', '所以', '因为', '因此', '然而', '虽然', '如果', '就是', '不是', '没有', '什么', '怎么',
  '之间', '之中', '之后', '之前', '以为', '所谓', '于是', '而已', '奈何', '如此', '若此', '其',
  '何如', '何以', '是以', '是故', '然则', '且夫', '若夫', '嗟乎', '呜呼', '已矣', '乎哉', '矣哉',
])
function tokenize(text, { keepStopwords = false } = {}) {
  const clean = String(text ?? '')
    .replace(/^>.*$/gm, '')   // 去引用块（注释占位等）
    .replace(/^#+\s*/gm, '')  // 去标题标记
    .replace(/[|*`_\-]+/g, '')
  const out = []
  for (const seg of segmenter.segment(clean)) {
    if (!seg.isWordLike) continue
    const w = seg.segment
    if (!keepStopwords && STOPWORDS.has(w)) continue
    out.push(w)
  }
  return out
}

const IMAGERY_LEXICON = [
  '明月', '月', '江', '山', '风', '雨', '雪', '云', '花', '柳', '雁', '舟', '酒', '剑', '琴', '灯',
  '窗', '楼', '关', '亭', '夜', '秋', '春', '夏', '冬', '草', '松', '竹', '梅', '莲', '菊', '鸟',
  '猿', '马', '沙', '霜', '露', '烟', '海', '川', '泉', '石', '林', '寺', '钟', '笛', '箫', '客',
  '梦', '愁', '泪', '故乡', '天涯', '白发', '青山', '流水', '斜阳', '孤舟', '长安', '江南', '夕阳',
]
/** 返回正文命中的意象（去重，供意象枢纽按意象反查作品） */
function imageryHits(body) {
  const text = String(body ?? '')
  return IMAGERY_LEXICON.filter((w) => text.includes(w))
}

/** 全拼（无声调、空格分隔），例：静夜思 → jing ye si */
function pinyinFull(text) {
  return pinyin(String(text ?? ''), { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join(' ')
}

/** 首字母串（无声调），例：静夜思 → jys */
function pinyinFirst(text) {
  return pinyin(String(text ?? ''), { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('')
}

/** 从正文提取「## 原文」之后的诗句文本（用于词频与摘要；止于引用块或下一个标题） */
function extractBody(content) {
  const lines = String(content ?? '').split(/\r?\n/)
  const idx = lines.findIndex((l) => /^##\s*原文\s*$/.test(l.trim()))
  const slice = idx >= 0 ? lines.slice(idx + 1) : lines
  const out = []
  for (const line of slice) {
    if (/^##\s/.test(line) || line.startsWith('>')) break
    out.push(line)
  }
  return out.join('\n').trim()
}

function firstLine(text, max = 40) {
  const line = String(text ?? '').split('\n').map((s) => s.trim()).filter(Boolean)[0] ?? ''
  return line.length > max ? line.slice(0, max) + '…' : line
}

function roundKb(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB'
}

function countBy(items, keyFn) {
  const map = new Map()
  for (const item of items) {
    const key = keyFn(item)
    if (key == null || key === '') continue
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  log.info('万卷索引构建启动（content → site/public/indexes）')
  if (verbose) log.debug('仓库根：{0}', ROOT)

  // 1. 扫描
  const scanStep = log.step('扫描内容目录')
  const files = await fg(
    ENTITY_TYPES.map((t) => `content/${t}/**/*.md`),
    { cwd: ROOT, absolute: true, dot: false },
  )
  const byType = { poems: [], idioms: [], quotes: [], authors: [], imagery: [] }
  for (const abs of files) {
    const rel = toSrcPath(abs)
    const seg = rel.split('/')
    if (seg.length < 3) {
      log.warn('跳过位置异常的文件：{0}', rel)
      continue
    }
    const type = seg[1]
    if (!byType[type]) { log.warn('未知实体类型，跳过：{0}', rel); continue }
    byType[type].push(abs)
  }
  scanStep.end(
    '扫描完成：作品 {0} · 成语 {1} · 名句 {2} · 作者 {3} · 意象 {4}',
    byType.poems.length, byType.idioms.length, byType.quotes.length, byType.authors.length, byType.imagery.length,
  )

  // 2. 解析 + 字段校验
  const parseStep = log.step('解析并校验 frontmatter')
  const entities = { poems: [], idioms: [], quotes: [], authors: [], imagery: [] }
  const parseFailed = { poems: 0, idioms: 0, quotes: 0, authors: 0, imagery: 0 }
  for (const type of ENTITY_TYPES) {
    for (const abs of byType[type]) {
      const srcPath = toSrcPath(abs)
      let parsed
      try {
        parsed = matter.read(abs)
      } catch (err) {
        log.error('解析失败 {0}：YAML 语法错误（{1}）', srcPath, err.message)
        parseFailed[type] += 1
        continue
      }
      const result = SCHEMAS[type].safeParse(parsed.data)
      if (!result.success) {
        const issues = result.error.issues
          .map((iss) => (iss.path.length ? `${iss.path.join('.')} - ${iss.message}` : iss.message))
          .join('；')
        log.error('校验失败 {0}：{1}', srcPath, issues)
        parseFailed[type] += 1
        continue
      }
      entities[type].push({ ...result.data, __srcPath: srcPath, __body: parsed.content })
    }
  }
  parseStep.end(
    '解析作品 {0} 篇 · 成语 {1} 条 · 名句 {2} 句 · 作者 {3} 人 · 意象 {4} 个',
    entities.poems.length, entities.idioms.length, entities.quotes.length, entities.authors.length, entities.imagery.length,
  )

  // 3. id 唯一性校验
  const allRecords = ENTITY_TYPES.flatMap((t) => entities[t])
  const idSeen = new Map()
  for (const rec of allRecords) {
    if (idSeen.has(rec.id)) {
      log.error('id 重复：{0}（{1} 与 {2}）', rec.id, idSeen.get(rec.id), rec.__srcPath)
    } else {
      idSeen.set(rec.id, rec.__srcPath)
    }
  }

  // 4. 谓词白名单校验
  const predStep = log.step('校验关系谓词白名单')
  let linkCount = 0
  let badPredicate = 0
  for (const rec of entities.poems) {
    for (const link of rec.links ?? []) {
      linkCount += 1
      if (!PREDICATES.has(link.rel)) {
        log.error('谓词不在白名单：{0} 使用了「{1}」（合法谓词共 {2} 条）', rec.__srcPath, link.rel, PREDICATES.size)
        badPredicate += 1
      }
    }
  }
  predStep.end('校验关系边 {0} 条，白名单外谓词 {1} 个', linkCount, badPredicate)

  // 5. 引用完整性（警告级）
  const poemIdSet = new Set(entities.poems.map((p) => p.id))
  const idiomWordSet = new Set(entities.idioms.map((i) => i.word))
  const imageryNameSet = new Set(entities.imagery.map((i) => i.name))
  for (const p of entities.poems) {
    for (const img of p.imagery) {
      if (!imageryNameSet.has(img)) log.warn('作品 {0} 的意象「{1}」未在 content/imagery/ 中收录', p.title, img)
    }
  }
  for (const q of entities.quotes) {
    if (q.work && !poemIdSet.has(q.work)) log.warn('名句「{0}」的 work 引用不存在：{1}', q.text, q.work)
  }
  for (const idm of entities.idioms) {
    if (idm.origin_link && !poemIdSet.has(idm.origin_link)) log.warn('成语「{0}」的 origin_link 引用不存在：{1}', idm.word, idm.origin_link)
  }

  // 校验失败则不再产出索引（非零退出已由 error 日志置位）
  if (log.errorCount > 0) {
    log.summary('构建失败', [
      ['实体总数', `${allRecords.length} 个`],
      ['校验错误', `${log.errorCount} 个`],
      ['警告', `${log.warnCount} 条`],
      ['结果', '存在校验错误，未写出索引文件'],
    ])
    process.exitCode = 1
    return
  }

  // 6. 分词与拼音
  const segStep = log.step('分词与拼音生成')
  const searchItems = []
  const tokenFreq = new Map()
  for (const p of entities.poems) {
    const body = extractBody(p.__body)
    const tokens = tokenize([p.title, p.author, p.dynasty, p.genre, ...(p.tags ?? []), body].join(' '))
    for (const t of tokenize(body)) tokenFreq.set(t, (tokenFreq.get(t) ?? 0) + 1)
    const titlePinyin = p.title_pinyin?.trim() || pinyinFull(p.title)
    searchItems.push({
      type: 'poem',
      id: p.id,
      title: p.title,
      subtitle: `${p.dynasty} · ${p.author} · ${p.form === '词' || p.form === '曲' ? (p.tune ? `${p.tune}·` : '') + p.form : p.form}`,
      tokens,
      pinyin: `${titlePinyin} ${pinyinFull(p.author)}`.trim(),
      pinyinFirst: pinyinFirst(p.title + p.author),
      excerpt: firstLine(body),
      srcPath: p.__srcPath,
    })
  }
  for (const i of entities.idioms) {
    const tokens = tokenize([i.word, i.meaning ?? '', i.semantic_field ?? '', ...(i.tags ?? [])].join(' '))
    searchItems.push({
      type: 'idiom',
      id: i.id,
      title: i.word,
      subtitle: i.semantic_field ? `成语 · ${i.semantic_field}` : '成语',
      tokens,
      pinyin: i.pinyin_plain,
      pinyinFirst: pinyinFirst(i.word),
      excerpt: firstLine(i.meaning, 50),
      srcPath: i.__srcPath,
    })
  }
  for (const q of entities.quotes) {
    const tokens = tokenize([q.text, q.author, q.dynasty, ...(q.theme ?? []), ...(q.tags ?? [])].join(' '))
    searchItems.push({
      type: 'quote',
      id: q.id,
      title: q.text,
      subtitle: `${q.dynasty} · ${q.author}`,
      tokens,
      pinyin: pinyinFull(q.text),
      pinyinFirst: pinyinFirst(q.text),
      excerpt: q.theme?.length ? `适用主题：${q.theme.join('、')}` : '',
      srcPath: q.__srcPath,
    })
  }
  for (const a of entities.authors) {
    const tokens = tokenize([a.name, a.courtesy ?? '', a.pseudonym ?? '', a.school ?? '', a.dynasty, ...(a.tags ?? [])].join(' '))
    searchItems.push({
      type: 'author',
      id: a.id,
      title: a.name,
      subtitle: `${a.dynasty} · ${a.school || '文学家'}${a.birth ? `（${a.birth}–${a.death ?? '?'}）` : ''}`,
      tokens,
      pinyin: pinyinFull(a.name),
      pinyinFirst: pinyinFirst(a.name),
      excerpt: [a.courtesy ? `字${a.courtesy}` : '', a.pseudonym ? `号${a.pseudonym}` : ''].filter(Boolean).join(' · '),
      srcPath: a.__srcPath,
    })
  }
  for (const m of entities.imagery) {
    const tokens = tokenize([m.name, ...(m.senses?.map((s) => s.sense) ?? []), ...(m.tags ?? [])].join(' '))
    searchItems.push({
      type: 'imagery',
      id: m.id,
      title: m.name,
      subtitle: `意象 · ${(m.senses ?? []).map((s) => s.sense).slice(0, 2).join('/') || '待梳理'}`,
      tokens,
      pinyin: pinyinFull(m.name),
      pinyinFirst: pinyinFirst(m.name),
      excerpt: (m.representative ?? []).map((r) => r.line).join(' / '),
      srcPath: m.__srcPath,
    })
  }
  segStep.end('分词完成：共 {0} 条检索记录 · 累计词元 {1} 个', searchItems.length, [...tokenFreq].length)

  // 7. 统计
  const statStep = log.step('生成统计（标签/词频/人物/意象/课标）')
  const tagCounts = new Map()
  for (const rec of allRecords) {
    for (const tag of rec.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }
  const topN = 50
  const wordFreq = [...tokenFreq.entries()]
    .filter(([w]) => w.length >= 2 || /[a-z]/i.test(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name, value]) => ({ name, value }))
  const topAuthors = [...countBy(entities.poems, (p) => p.author).entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
  // 意象词频：用经典意象词典扫描正文（frontmatter 的 imagery 标签尚待人工补全时，
  // 词云需要一个有主题意义的统计口径，而不是「而后/诸侯」这类虚词与叙事词）
  const imageryFreqMap = new Map()
  for (const p of entities.poems) {
    const body = String(p.__body ?? '')
    for (const w of IMAGERY_LEXICON) {
      let idx = 0, n = 0
      while ((idx = body.indexOf(w, idx)) !== -1) { n++; idx += w.length }
      if (n > 0) imageryFreqMap.set(w, (imageryFreqMap.get(w) ?? 0) + n)
    }
  }
  const imageryFreq = [...imageryFreqMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 60)
  const imageryDist = entities.poems.flatMap((p) => p.imagery ?? [])
    .reduce((acc, name) => { const it = acc.find((x) => x.name === name); it ? it.value += 1 : acc.push({ name, value: 1 }); return acc }, [])
    .sort((a, b) => b.value - a.value)
  const genreDist = [...countBy(entities.poems, (p) => p.genre).entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const formDist = [...countBy(entities.poems, (p) => p.form).entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const dynastyDist = [...countBy(entities.poems, (p) => p.dynasty).entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const quoteThemeDist = entities.quotes.flatMap((q) => q.theme ?? [])
    .reduce((acc, name) => { const it = acc.find((x) => x.name === name); it ? it.value += 1 : acc.push({ name, value: 1 }); return acc }, [])
    .sort((a, b) => b.value - a.value)
  const curriculum = {
    byStage: Object.fromEntries(Object.entries(STAGE_LABEL).map(([code, label]) => [label, entities.poems.filter((p) => p.curriculum.stage === code).length])),
    recitationByStage: Object.fromEntries(Object.entries(STAGE_LABEL).map(([code, label]) => [label, entities.poems.filter((p) => p.curriculum.stage === code && p.curriculum.recitation).length])),
    byGrade: [...countBy(entities.poems, (p) => `${STAGE_LABEL[p.curriculum.stage]}${p.curriculum.grade}年级`).entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
  }
  statStep.end('统计完成：标签 {0} 类 · 词频 Top{1} · 高频人物 {2} 位', tagCounts.size, topN, topAuthors.length)

  // 8. 知识图谱
  const graphStep = log.step('构建知识图谱（nodes/links）')
  const nodes = new Map()
  const links = []
  const linkKeys = new Set()

  function upsertNode(id, label, type, anchor = null) {
    if (!nodes.has(id)) nodes.set(id, { id, label, type, degree: 0, anchor })
    return nodes.get(id)
  }
  function addLink(source, target, rel) {
    if (!source || !target || source === target) return
    const key = `${source}\u0000${target}\u0000${rel}`
    const keyRev = `${target}\u0000${source}\u0000${rel}`
    if (linkKeys.has(key) || linkKeys.has(keyRev)) return
    linkKeys.add(key)
    links.push({ source, target, rel })
  }

  // 实体节点
  const authorByName = new Map(entities.authors.map((a) => [a.name, a]))
  const imageryByName = new Map(entities.imagery.map((m) => [m.name, m]))
  const idiomByWord = new Map(entities.idioms.map((i) => [i.word, i]))
  const poemById = new Map(entities.poems.map((p) => [p.id, p]))

  for (const p of entities.poems) upsertNode(p.id, p.title, 'poem', p.__srcPath)
  for (const i of entities.idioms) upsertNode(i.id, i.word, 'idiom', i.__srcPath)
  for (const q of entities.quotes) upsertNode(q.id, q.text, 'quote', q.__srcPath)
  for (const a of entities.authors) upsertNode(a.id, a.name, 'author', a.__srcPath)
  for (const m of entities.imagery) upsertNode(m.id, m.name, 'imagery', m.__srcPath)

  /** 作者名 → 节点 id（库内作者用其文件 id；未收录作者生成占位节点，anchor 为空） */
  function authorNodeId(name) {
    const known = authorByName.get(name)
    if (known) return known.id
    const stubId = `author:${name}`
    upsertNode(stubId, name, 'author', null)
    return stubId
  }
  function imageryNodeId(name) {
    const known = imageryByName.get(name)
    if (known) return known.id
    const stubId = `imagery:${name}`
    upsertNode(stubId, name, 'imagery', null)
    return stubId
  }

  /** frontmatter links[].to 的解析目标节点 id（按谓词推断节点类型） */
  function resolveLinkTarget(rel, to) {
    if (poemById.has(to) || nodes.has(to)) return to
    switch (rel) {
      case '属朝代': return upsertNode(`dynasty:${to}`, to, 'dynasty').id
      case '属体裁': return upsertNode(`form:${to}`, to, 'form').id
      case '属题材': return upsertNode(`genre:${to}`, to, 'genre').id
      case '含意象': return imageryNodeId(to)
      case '用典': return upsertNode(`allusion:${to}`, to, 'allusion').id
      case '学段': {
        const label = STAGE_LABEL[to] ?? to
        return upsertNode(`stage:${label}`, label, 'stage').id
      }
      case '交游':
      case '师承': return authorNodeId(to)
      case '主题': return upsertNode(`theme:${to}`, to, 'theme').id
      default: return upsertNode(`concept:${to}`, to, 'concept').id
    }
  }

  // 作品派生边
  for (const p of entities.poems) {
    addLink(authorNodeId(p.author), p.id, '创作')
    addLink(p.id, resolveLinkTarget('属朝代', p.dynasty), '属朝代')
    addLink(p.id, resolveLinkTarget('属体裁', p.form), '属体裁')
    addLink(p.id, resolveLinkTarget('属题材', p.genre), '属题材')
    for (const img of p.imagery ?? []) addLink(p.id, imageryNodeId(img), '含意象')
    for (const allu of p.allusions ?? []) addLink(p.id, resolveLinkTarget('用典', allu), '用典')
    addLink(p.id, resolveLinkTarget('学段', p.curriculum.stage), '学段')
    for (const link of p.links ?? []) {
      addLink(p.id, resolveLinkTarget(link.rel, link.to), link.rel)
    }
  }
  // 作者派生边
  for (const a of entities.authors) {
    addLink(a.id, resolveLinkTarget('属朝代', a.dynasty), '属朝代')
    for (const master of a.masters ?? []) {
      const target = authorByName.get(master)?.id ?? (poemById.has(master) ? master : null)
      if (target) addLink(a.id, target, '师承')
      else log.debug('师承引用未收录，跳过：{0} → {1}', a.name, master)
    }
    for (const friend of a.friends ?? []) {
      addLink(a.id, authorNodeId(friend), '交游')
    }
  }
  // 成语派生边（近义/反义仅在库内成语之间建边，避免占位节点泛滥）
  for (const i of entities.idioms) {
    for (const syn of i.synonyms ?? []) {
      const target = idiomByWord.get(syn)
      if (target) addLink(i.id, target.id, '近义')
      else log.debug('近义成语未收录，跳过：{0} → {1}', i.word, syn)
    }
    for (const ant of i.antonyms ?? []) {
      const target = idiomByWord.get(ant)
      if (target) addLink(i.id, target.id, '反义')
      else log.debug('反义成语未收录，跳过：{0} → {1}', i.word, ant)
    }
    if (i.origin_link && poemById.has(i.origin_link)) addLink(i.id, i.origin_link, '出处')
  }
  // 名句派生边
  for (const q of entities.quotes) {
    if (q.work && poemById.has(q.work)) addLink(q.id, q.work, '出处')
    for (const t of q.theme ?? []) addLink(q.id, resolveLinkTarget('主题', t), '主题')
  }
  // 度数统计
  for (const link of links) {
    nodes.get(link.source).degree += 1
    if (nodes.has(link.target)) nodes.get(link.target).degree += 1
  }
  const graph = {
    generatedAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    links,
  }
  graphStep.end('图谱构建完成：节点 {0} 个 · 关系边 {1} 条', graph.nodes.length, graph.links.length)

  // 9. 写出索引
  const writeStep = log.step('写出索引文件')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const generatedAt = new Date().toISOString()
  const outputs = {
    'search.json': { generatedAt, count: searchItems.length, items: searchItems },
    'poems.json': {
      generatedAt,
      count: entities.poems.length,
      items: entities.poems.map((p) => ({
        id: p.id, title: p.title, titlePinyin: p.title_pinyin || pinyinFull(p.title), author: p.author,
        dynasty: p.dynasty, form: p.form, tune: p.tune ?? null, genre: p.genre, imagery: p.imagery ?? [],
        tags: p.tags ?? [], curriculum: p.curriculum, srcPath: p.__srcPath, imageryHits: imageryHits(p.__body), firstLine: firstLine(p.__body),
      })),
    },
    'idioms.json': {
      generatedAt,
      count: entities.idioms.length,
      items: entities.idioms.map((i) => ({
        id: i.id, word: i.word, pinyin: i.pinyin, pinyinPlain: i.pinyin_plain, first: i.first, last: i.last,
        meaning: i.meaning, origin: i.origin ?? null, originLink: i.origin_link ?? null,
        semanticField: i.semantic_field ?? null, synonyms: i.synonyms ?? [], antonyms: i.antonyms ?? [],
        tags: i.tags ?? [], curriculum: i.curriculum, srcPath: i.__srcPath,
      })),
    },
    'quotes.json': {
      generatedAt,
      count: entities.quotes.length,
      items: entities.quotes.map((q) => ({
        id: q.id, text: q.text, author: q.author, work: q.work ?? null, theme: q.theme ?? [],
        dynasty: q.dynasty, tags: q.tags ?? [], curriculum: q.curriculum, srcPath: q.__srcPath,
        // 名句来源分层：古诗文 / 近现代名家 / 演讲语录（缺省按古诗文处理）
        sourceType: q.source_type ?? 'classical',
        citation: q.source_citation ?? null,
        verified: q.verified ?? null,
        excerpt: q.__body ? String(q.__body).replace(/^#.*$/gm, '').replace(/^>.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 120) : '',
      })),
    },
    'graph.json': graph,
    'stats.json': {
      generatedAt,
      totals: {
        poems: entities.poems.length,
        idioms: entities.idioms.length,
        quotes: entities.quotes.length,
        authors: entities.authors.length,
        imagery: entities.imagery.length,
      },
      tagCounts: Object.fromEntries([...tagCounts.entries()].sort((a, b) => b[1] - a[1])),
      wordFreq,
      topAuthors,
      imageryDist,
      imageryFreq,
      genreDist,
      formDist,
      dynastyDist,
      quoteThemeDist,
      curriculum,
    },
  }
  const sizes = []
  let totalBytes = 0
  for (const [name, data] of Object.entries(outputs)) {
    const buf = Buffer.from(JSON.stringify(data, null, 2), 'utf8')
    fs.writeFileSync(path.join(OUT_DIR, name), buf)
    totalBytes += buf.length
    sizes.push([name, `${roundKb(buf.length)}`])
    log.debug('写出 {0}（{1}）', name, roundKb(buf.length))
  }
  writeStep.end('已写出 {0} 个索引文件至 site/public/indexes/（合计 {1}）', Object.keys(outputs).length, roundKb(totalBytes))

  // 10. 汇总
  log.summary('构建摘要', [
    ['作品', `${entities.poems.length} 篇`],
    ['成语', `${entities.idioms.length} 条`],
    ['名句', `${entities.quotes.length} 句`],
    ['作者', `${entities.authors.length} 人`],
    ['意象', `${entities.imagery.length} 个`],
    ['检索记录', `${searchItems.length} 条`],
    ['图谱节点', `${graph.nodes.length} 个`],
    ['关系边', `${graph.links.length} 条`],
    ['索引总体积', roundKb(totalBytes)],
    ['校验错误', `${log.errorCount} 个`],
    ['警告', `${log.warnCount} 条`],
    ['输出目录', 'site/public/indexes/'],
  ])
  log.ok('万卷索引构建完成{0}', verbose ? '（--verbose 详细日志已开启）' : '')
}

main().catch((err) => {
  log.error('构建管线异常终止：{0}', err?.stack || err?.message || err)
  process.exit(1)
})
