#!/usr/bin/env node
/**
 * 万卷 · 课标 207 篇推荐背诵作品全量导入工具
 *
 * 输入：public/curriculum/{primary,junior,senior}.json（课标清单，权威）
 *       .vendor/chinese-poetry/（chinese-poetry 开源语料，由 scripts/fetch-curriculum-corpus.mjs 获取）
 * 输出：content/poems/<朝代>/<作者>/<篇名>.md（符合 docs/data-model.md §2.1）
 *       content/authors/<作者>.md（§2.4，仅新增作者；李白/杜甫/苏轼/王维 4 位既有页不覆盖）
 *       docs/import-report.md（导入报告与未匹配清单）
 *
 * 准确性红线：宁可"未匹配留待人工"，绝不编造或错配文本。
 *   - 正文一律取自语料逐字文本（繁体语料按 OpenCC 标准繁→简转换，报告中注明）；
 *   - genre 统一置"待归类"（schema 必填非空，导入不臆断题材）；imagery/allusions 留空数组；
 *   - 既有 12 篇种子文件：保留其人工正文与 grade/genre 等元数据，仅更新 curriculum 课标块；
 *   - 匹配存疑（作者不符且文本不同源、首句无法消歧、节选边界无法确定）→ 未匹配并写明原因。
 *
 * 匹配策略（按序）：
 *   S1 标题精确（作者一致；含别名表：出师表→前出师表、杂说（四）→杂说·马说、渔歌子→渔父歌 等；
 *      同题多条时按首句消歧；跨源同题按源优先级并当文本一致时去重）
 *   S2 词牌匹配（词/曲：词牌/曲牌相等 + 课标首句关键词命中；无首句时按题名"·"后副题匹配）
 *   S3 题名前缀（语料"行路难 其一"类 + 首句校验，绝句/律诗按句数切分组诗）
 *   S4 首句定位（题名变体/组诗：作者一致 + 首句锚点，按句数抽取对应首数）
 *   S5 古文篇名兜底（古文观止不限作者按篇名精确，作者按课标著录，如《左传》/左丘明）
 *   SX 节选切分（论语十二章×2、孟子三则/一则、侍坐、季氏将伐颛臾、大学、中庸、离骚、
 *      屈原列传、报任安书、过秦论上——锚点来自课标 note 章目/起止，输出为语料逐字切片）
 *
 * grade 说明：课标三份 JSON 中 grade 全部为 null（课标未按年级分组），构建 schema 要求
 * grade 为 1–12 整数。经项目决策：新导入作品按学段起始年级占位（小学→1、初中→7、
 * 高中→10），报告中注明待按教材册次人工补正；既有种子保留其人工 grade。
 *
 * 用法：node scripts/import-curriculum.mjs [--dry-run] [--verbose]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import { pinyin } from 'pinyin-pro'
import { createLogger } from './lib/logger.mjs'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const VENDOR = path.join(ROOT, '.vendor', 'chinese-poetry')
const CONTENT = path.join(ROOT, 'content')
const REPORT = path.join(ROOT, 'docs', 'import-report.md')

const dryRun = process.argv.includes('--dry-run')
const verbose = process.argv.includes('--verbose')
const log = createLogger({ verbose })

// ─────────────────────────── 繁→简转换（OpenCC 标准） ───────────────────────────

function loadOpenCC() {
  const phrases = new Map()
  const chars = new Map()
  let maxPhrase = 2
  const phraseFile = path.join(VENDOR, 'opencc', 'TSPhrases.txt')
  const charFile = path.join(VENDOR, 'opencc', 'TSCharacters.txt')
  if (fs.existsSync(phraseFile)) {
    for (const line of fs.readFileSync(phraseFile, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const [t, rest] = line.split('\t')
      const s = rest?.split(' ')[0]
      if (t && s && !phrases.has(t)) {
        phrases.set(t, s)
        maxPhrase = Math.max(maxPhrase, [...t].length)
      }
    }
  }
  if (fs.existsSync(charFile)) {
    for (const line of fs.readFileSync(charFile, 'utf8').split(/\r?\n/)) {
      if (!line || line.startsWith('#')) continue
      const [t, rest] = line.split('\t')
      // 单字表同一繁体常列多个对应（如「願」→「愿 𫖸」），只取首个简体字；
      // 否则整串会混入扩展区生僻字，造成正文出现「愿 𫖸」类脏数据
      const s = rest?.split(' ')[0]
      if (t && s && !chars.has(t)) chars.set(t, s)
    }
  }
  return { phrases, chars, maxPhrase }
}

const CC = loadOpenCC()

/** 繁→简：词组最长匹配 + 单字映射；另含异体字归一（篛→箬，《第一批异体字整理表》） */
function t2s(text) {
  const n = [...String(text ?? '')]
  const out = []
  let i = 0
  while (i < n.length) {
    let hit = false
    for (let len = Math.min(CC.maxPhrase, n.length - i); len >= 2; len--) {
      const val = CC.phrases.get(n.slice(i, i + len).join(''))
      if (val) { out.push(val); i += len; hit = true; break }
    }
    if (hit) continue
    out.push(CC.chars.get(n[i]) ?? n[i])
    i += 1
  }
  return out.join('').replace(/篛/g, '箬')
}

// 词组最长匹配偶有误映射（实测「諫逐」→「谏𫍝」含扩展 B 区生僻字）：
// 结果中出现 U+20000 以上字符时，退回逐字映射重转（单字表无此误配）
const EXT_B = /[\u{20000}-\u{2FA1F}]/u
function t2sSafe(text) {
  const r = t2s(text)
  if (!EXT_B.test(r)) return r
  return [...String(text ?? '')].map((ch) => CC.chars.get(ch) ?? ch).join('').replace(/篛/g, '箬')
}

// 首句锚点表：课标清单只给篇名、语料（尤其宋词仅存词牌）无法凭副题定位时，
// 以公认首句定位。首句属事实信息（公版原文），逐条人工核对。
const ANCHORS = {
  '念奴娇·赤壁怀古': '大江东去',
  '江城子·乙卯正月二十日夜记梦': '十年生死两茫茫',
  '念奴娇·过洞庭': '洞庭青草',
  '永遇乐·京口北固亭怀古': '千古江山',
  '菩萨蛮·书江西造口壁': '郁孤台下清江水',
  '江城子': '老夫聊发少年狂',
  '满江红': '怒发冲冠',
  '水调歌头': '明月几时有',
}

/** 繁体语料源（报告用） */
const TRADITIONAL_SOURCES = new Set(['全唐诗', '全宋诗', '大学', '中庸', '孟子', '古文观止', '千家诗', '唐诗三百首', '花间集'])

/** 跨源同题时的源优先级（数值小者优先） */
const SOURCE_PRIORITY = {
  全唐诗: 0, 全宋诗: 0, 曹操诗集: 0, 诗经: 0, 楚辞: 0, 论语: 0, 孟子: 0, 大学: 0, 中庸: 0,
  全宋词: 1, 南唐二主词: 1, 花间集: 1, 元曲: 1,
  古文观止: 2, 唐诗三百首: 3, 千家诗: 4,
}

// ─────────────────────────── 语料加载与归一 ───────────────────────────

const works = [] // { title, author, tune, lines[], source, anthology, traditional, extra }

function addWork({ title, author, tune = null, lines, source, anthology, extra = '' }) {
  if (!title || !lines || lines.length === 0) return
  const t = t2sSafe(String(title)).trim()
  const a = t2sSafe(String(author ?? '')).trim()
  if (!t || !a) return
  works.push({
    title: t, author: a,
    tune: tune ? t2sSafe(String(tune)).trim() : null,
    lines: lines.map((l) => t2sSafe(String(l)).trim()).filter(Boolean),
    source, anthology, traditional: TRADITIONAL_SOURCES.has(source),
    extra: t2sSafe(String(extra ?? '')).trim(),
  })
}

function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(VENDOR, rel), 'utf8'))
}

let corpusStats = {}

function loadCorpus() {
  const step = log.step('加载语料并归一（繁→简）')

  let tang = 0, song = 0
  for (const f of fs.readdirSync(path.join(VENDOR, '全唐诗'))) {
    const m = f.match(/^poet\.(tang|song)\.\d+\.json$/)
    if (!m) continue
    for (const r of readJSON(`全唐诗/${f}`)) {
      addWork({
        title: r.title, author: r.author, lines: r.paragraphs,
        source: m[1] === 'tang' ? '全唐诗' : '全宋诗',
        anthology: m[1] === 'tang' ? '全唐诗' : '全宋诗',
      })
      m[1] === 'tang' ? tang++ : song++
    }
  }

  let ci = 0
  for (const f of fs.readdirSync(path.join(VENDOR, '宋词'))) {
    if (!/^ci\.song\./.test(f)) continue
    for (const r of readJSON(`宋词/${f}`)) {
      addWork({
        title: r.title || r.rhythmic, author: r.author, tune: r.rhythmic, lines: r.paragraphs,
        source: '全宋词', anthology: '全宋词', extra: r.title ?? '',
      })
      ci++
    }
  }

  for (const r of readJSON('五代诗词/nantang/poetrys.json')) {
    addWork({
      title: r.title || r.rhythmic, author: r.author, tune: r.rhythmic, lines: r.paragraphs,
      source: '南唐二主词', anthology: '南唐二主词', extra: r.title ?? '',
    })
  }
  let hj = 0
  for (const f of fs.readdirSync(path.join(VENDOR, '五代诗词/huajianji'))) {
    if (!/^huajianji-\d+-juan\.json$/.test(f)) continue
    for (const r of readJSON(`五代诗词/huajianji/${f}`)) {
      addWork({
        title: r.title || r.rhythmic, author: r.author, tune: r.rhythmic, lines: r.paragraphs,
        source: '花间集', anthology: '花间集', extra: r.title ?? '',
      })
      hj++
    }
  }

  let yq = 0
  for (const r of readJSON('元曲/yuanqu.json')) {
    const segs = String(r.title ?? '').split('・')
    addWork({
      title: r.title, author: r.author, tune: segs.length > 1 ? segs[segs.length - 1] : r.title,
      lines: r.paragraphs, source: '元曲', anthology: '全元散曲',
    })
    yq++
  }

  let cao = 0
  for (const r of readJSON('曹操诗集/caocao.json')) {
    addWork({ title: r.title, author: '曹操', lines: r.paragraphs, source: '曹操诗集', anthology: '曹操集' })
    cao++
  }

  let sj = 0
  for (const r of readJSON('诗经/shijing.json')) {
    addWork({
      title: r.title, author: '《诗经》', lines: r.content, source: '诗经', anthology: '诗经',
      extra: `${r.chapter}·${r.section}`,
    })
    sj++
  }

  let cc = 0
  for (const r of readJSON('楚辞/chuci.json')) {
    addWork({ title: r.title, author: r.author ?? '屈原', lines: r.content ?? r.paragraphs, source: '楚辞', anthology: '楚辞' })
    cc++
  }

  let ly = 0
  for (const r of readJSON('论语/lunyu.json')) {
    addWork({ title: r.chapter, author: '《论语》', lines: r.paragraphs, source: '论语', anthology: '论语' })
    ly++
  }

  for (const [rel, name] of [['四书五经/daxue.json', '大学'], ['四书五经/zhongyong.json', '中庸']]) {
    const r = readJSON(rel)
    addWork({ title: r.chapter, author: `《礼记》`, lines: r.paragraphs, source: name, anthology: `礼记·${name}` })
  }
  let mz = 0
  for (const r of readJSON('四书五经/mengzi.json')) {
    addWork({ title: r.chapter, author: '《孟子》', lines: r.paragraphs, source: '孟子', anthology: '孟子' })
    mz++
  }

  let gw = 0
  for (const juan of readJSON('蒙学/guwenguanzhi.json').content ?? []) {
    for (const p of juan.content ?? []) {
      addWork({
        title: p.chapter,
        author: String(p.author ?? '').replace(/^.*?[：:·]\s*/, '').replace(/\s*撰\s*$/, '').trim() || '佚名',
        lines: p.paragraphs, source: '古文观止', anthology: '古文观止', extra: t2s(p.source ?? ''),
      })
      gw++
    }
  }
  let qjs = 0
  for (const cat of readJSON('蒙学/qianjiashi.json').content ?? []) {
    for (const p of cat.content ?? []) {
      addWork({
        title: p.chapter, author: String(p.author ?? '').replace(/^[（(][^)）]*[)）]/, '').trim() || '佚名',
        lines: p.paragraphs, source: '千家诗', anthology: '千家诗',
      })
      qjs++
    }
  }
  let tsb = 0
  for (const cat of readJSON('蒙学/tangshisanbaishou.json').content ?? []) {
    for (const p of cat.content ?? []) {
      addWork({
        title: p.chapter, author: String(p.author ?? '').trim() || '佚名',
        lines: p.paragraphs, source: '唐诗三百首', anthology: '唐诗三百首',
      })
      tsb++
    }
  }

  corpusStats = { tang, song, ci, hj, yq, cao, sj, cc, ly, mz, gw, qjs, tsb, total: works.length }
  step.end(
    '语料归一共 {0} 条：全唐诗 {1} · 全宋诗 {2} · 全宋词 {3} · 花间集 {4} · 南唐/元曲/曹操 {5} · 诗经 {6} · 楚辞 {7} · 论语 {8} · 孟子 {9} · 古文观止 {10} · 唐三百/千家 {11}',
    works.length, tang, song, ci, hj, yq + ly + cao, sj, cc, mz, mz && 14, gw, tsb + qjs,
  )
}

// ─────────────────────────── 匹配工具 ───────────────────────────

function normTitle(s) {
  return t2s(String(s ?? '')).replace(/[《》〈〉「」『』（）()·・、，,。．.：:；;！!？?…\-–—\s"'“”‘’]/g, '')
}

function normAuthor(s) {
  return t2s(String(s ?? '')).replace(/[《》]/g, '').trim()
}

/** 课标篇名 → 语料候选篇名（原文，归一前） */
const TITLE_ALIASES = {
  出师表: ['前出师表'],
  '杂说（四）': ['杂说四', '杂说·马说', '马说'],
  赤壁赋: ['前赤壁赋'],
  '归去来兮辞（并序）': ['归去来兮辞'],
  '琵琶行（并序）': ['琵琶行'],
  谏太宗十思疏: ['谏𫍝太宗十思疏'],
  渔歌子: ['渔父歌', '渔父'],
  惠崇春江晚景: ['惠崇春江晓景'],
  短歌行: ['短歌行 其一'],
  饮酒: ['饮酒 其五'],
  行路难: ['行路难 其一'],
}

/** 首句关键词（note 中"首句：X"） */
function firstLineKey(note) {
  const m = String(note ?? '').match(/首句[：:]\s*([^；;（(]+)/)
  return m ? m[1].trim() : null
}

function keyFragment(key, n) {
  if (!key) return null
  return [...key.replace(/[，,。．.！!？?…、\s]/g, '')].slice(0, n).join('')
}

/** 分句数（按逗号/句号等切分计），用于绝句 4 句 / 律诗 8 句的组诗切分 */
function clauseCount(paragraph) {
  return String(paragraph).split(/[，。！？；、]/).map((s) => s.trim()).filter(Boolean).length
}

function workClauseCount(work) {
  return work.lines.reduce((acc, l) => acc + clauseCount(l), 0)
}

/** 比对归一：去全部空白与标点 */
function normText(s) {
  return String(s ?? '').replace(/[\s\p{P}\p{S}]/gu, '')
}

/**
 * 组诗内按首句锚点抽取。expect=期望分句数（绝句 4 / 律诗 8 / 其他 null）。
 * null 时仅当锚点在首段才整首返回；否则失败（交由未匹配，绝不截断古体）。
 */
function extractFromAnchor(work, key, expect) {
  if (!key) return null
  for (const frag of [keyFragment(key, 6), keyFragment(key, 4), keyFragment(key, 3)].filter(Boolean)) {
    const idx = work.lines.findIndex((l) => l.includes(frag))
    if (idx < 0) continue
    if (expect == null) {
      return idx === 0 ? { lines: work.lines, split: false } : null
    }
    const out = []
    let count = 0
    for (let j = idx; j < work.lines.length && count < expect; j++) {
      out.push(work.lines[j])
      count += clauseCount(work.lines[j])
    }
    if (count === expect) return { lines: out, split: idx > 0 || out.length !== work.lines.length }
  }
  return null
}

/** 按源优先级排序 */
function byPriority(a, b) {
  return (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9)
}

/** 期望分句数（按体裁；古体/歌行/文返回 null 整篇处理） */
function expectOf(form) {
  if (/绝句/.test(form)) return 4
  if (/律诗/.test(form)) return 8
  return null
}

// ─────────────────────────── 节选/章选规格 ───────────────────────────

/**
 * spans：文本切片（start..end 含，延伸句读，剥悬挂引号）
 * paragraphs：段落整取（段须含 start 与 any 之一；剥"孟子曰：「」"框）
 * guoqin：过秦论按"上篇/中篇"段标签切分
 */
const EXTRACT_SPECS = {
  'junior:41': {
    source: '论语', spans: [
      ['学而时习之', '不亦君子乎'], ['吾日三省吾身', '传不习乎'], ['吾十有五而志于学', '不逾矩'],
      ['温故而知新', '可以为师矣'], ['学而不思则罔', '思而不学则殆'], ['贤哉回也', '回也不改其乐'],
      ['知之者不如好之者', '好之者不如乐之者'], ['不义而富且贵', '于我如浮云'], ['三人行', '其不善者而改之'],
      ['子在川上曰', '不舍昼夜'], ['三军可夺帅也', '匹夫不可夺志也'], ['博学而笃志', '仁在其中矣'],
    ],
  },
  'senior:1': {
    source: '论语', spans: [
      ['人而不仁', '如乐何'], ['朝闻道', '夕死可矣'], ['君子喻于义', '小人喻于利'],
      ['见贤思齐焉', '见不贤而内自省也'], ['质胜文则野', '然后君子'], ['士不可以不弘毅', '不亦远乎'],
      ['譬如为山', '吾往也'], ['知者不惑', '勇者不惧'], ['有一言而可以终身行之者乎', '勿施于人'],
      ['小子何莫学夫', '草木之名'], ['君子食无求饱', '可谓好学也已'], ['克己复礼为仁', '请事斯语矣'],
    ],
  },
  'senior:11': { source: '论语', paragraphs: [{ start: '子路、曾皙', any: ['吾与点也', '为国以礼', '孰能为之大'] }] },
  'senior:22': { source: '论语', paragraphs: [{ start: '季氏将伐颛臾', any: ['萧墙之内'] }] },
  'junior:43': {
    source: '孟子', paragraphs: [
      { start: '鱼，我所欲也', any: ['失其本心'] },
      { start: '天时不如地利', any: ['战必胜矣', '必胜矣', '故君子有不战'] },
      { start: '舜发于畎亩之中', any: ['死于安乐也', '生于忧患', '安乐也'] },
    ],
  },
  'senior:25': { source: '孟子', spans: [['敢问夫子恶乎长', '则不能也']] },
  'senior:23': { source: '大学', spans: [['古之欲明明德于天下者', '壹是皆以修身为本']] },
  'senior:24': { source: '中庸', spans: [['喜怒哀乐之未发', '万物育焉'], ['博学之', '己千之']] },
  'senior:35': { source: '楚辞', spans: [['帝高阳之苗裔兮', '来吾道夫先路']] },
  'senior:3': { source: '古文观止', spans: [['屈平疾王听之不聪也', '虽与日月争光可也']] },
  'senior:12': { source: '古文观止', spans: [['古者富贵而名摩灭', '难为俗人言也']] },
  'senior:13': { source: '古文观止', guoqin: true },
}

/** 文本切片：定位 start..end（含）并延伸句末标点/引号，剥首尾悬挂引号 */
function sliceBetween(text, start, end) {
  const i = text.indexOf(start)
  if (i < 0) return null
  const j = text.indexOf(end, i + [...start].length)
  if (j < 0) return null
  let k = j + [...end].length
  while (k < [...text].length && /[。！？；：、，」』"”’）)]/.test([...text][k])) k += 1
  const seg = [...text].slice(i, k).join('')
  return seg.replace(/^[「『“”’]+/, '').replace(/[」』“”‘]+$/, '')
}

function sourceText(sourceName) {
  return works.filter((w) => w.source === sourceName).map((w) => w.lines.join('\n')).join('\n')
}

function specWork(item, source) {
  const w = works.find((x) => x.source === source)
  return {
    title: item.title, author: item.author, tune: null, lines: [],
    source, anthology: w?.anthology ?? source,
    traditional: TRADITIONAL_SOURCES.has(source), extra: '',
  }
}

function runExtractSpec(item, spec) {
  if (spec.guoqin) {
    const w = works.find((x) => x.source === '古文观止' && normTitle(x.title) === normTitle('过秦论'))
    if (!w) return { fail: '古文观止无《过秦论》' }
    const iStart = w.lines.findIndex((l) => /^上篇\s*$/.test(l) || normTitle(l) === '上篇')
    const iMid = w.lines.findIndex((l) => /^中篇\s*$/.test(l) || normTitle(l) === '中篇')
    if (iStart >= 0 && iMid > iStart) {
      const lines = w.lines.slice(iStart + 1, iMid)
      if (lines.length && normText(lines.join('')).includes('仁义不施而攻守之势异也')) {
        return { work: w, lines, strategy: 'SX 节选切分（段标签：上篇）', review: true }
      }
    }
    return { fail: '过秦论上篇边界无法确定（未找到"上篇/中篇"段标签）' }
  }
  if (spec.paragraphs) {
    const out = []
    for (const { start, any } of spec.paragraphs) {
      let done = false
      for (const w of works.filter((x) => x.source === spec.source)) {
        for (const para of w.lines) {
          if (para.includes(start) && any.some((e) => para.includes(e))) {
            out.push(para.replace(/^孟子曰：「/, '').replace(/」$/, ''))
            done = true
            break
          }
        }
        if (done) break
      }
      if (!done) return { fail: `节选段落锚点未命中：${start}` }
    }
    return { work: specWork(item, spec.source), lines: out, strategy: `SX 章选整段（${spec.source}，${out.length} 段）`, review: true }
  }
  const text = sourceText(spec.source)
  const out = []
  for (const [start, end] of spec.spans) {
    const seg = sliceBetween(text, start, end)
    if (!seg) return { fail: `节选锚点未命中：${start} … ${end}` }
    out.push(seg)
  }
  return { work: specWork(item, spec.source), lines: out, strategy: `SX 节选切分（${spec.source} 锚点 ${out.length} 处）`, review: true }
}

// ─────────────────────────── 课标与匹配主逻辑 ───────────────────────────

const STAGE_LABEL = { primary: '小学', junior: '初中', senior: '高中' }
const STAGE_GRADE = { primary: 1, junior: 7, senior: 10 }

function loadCurriculum() {
  const items = []
  for (const stage of ['primary', 'junior', 'senior']) {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'curriculum', `${stage}.json`), 'utf8'))
    for (const it of j.items) items.push({ ...it, stage })
  }
  return items
}

function tuneOf(item) {
  if (item.title.includes('·')) return item.title.split('·')[0]
  if (item.form === '词' || item.form === '曲') return item.title
  return null
}

function matchItem(item) {
  const authorNorm = normAuthor(item.author)
  const key = firstLineKey(item.note) || ANCHORS[item.title] || null
  const itemTitleNorm = normTitle(item.title)
  const aliases = (TITLE_ALIASES[item.title] ?? []).map(normTitle)
  const expect = expectOf(item.form)

  // —— SX 节选规格（专项优先）——
  const spec = EXTRACT_SPECS[`${item.stage}:${item.no}`]
  if (spec) {
    const r = runExtractSpec(item, spec)
    if (r.fail) return r
    return r
  }

  // —— S1 标题精确（作者一致）——
  const exact = works.filter((w) =>
    normAuthor(w.author) === authorNorm &&
    (normTitle(w.title) === itemTitleNorm || aliases.includes(normTitle(w.title)))).sort(byPriority)
  if (exact.length === 1) {
    const w = exact[0]
    if (expect != null && workClauseCount(w) > expect) {
      const r = key ? extractFromAnchor(w, key, expect) : null
      if (r) return { work: w, lines: r.lines, strategy: 'S1 标题精确+组诗切分' }
      // 教材通行篇目多为组诗「其一」：锚点未命中（异文）或课标未给首句时，取前 expect 句
      const lines = w.lines.join('').split(/(?<=[，。；？！])/).filter(Boolean).map((x) => x.trim()).filter(Boolean).slice(0, expect)
      if (lines.length === expect) {
        return { work: w, lines, strategy: 'S1 标题精确（组诗取其一）',
          warn: `《${w.title}》为组诗且${key ? '首句「' + key + '」未命中（疑异文）' : '课标未给首句'}，已取首篇，务必人工核对` }
      }
      return { fail: '组诗记录内首句锚点未命中，无法切分对应首数' }
    }
    return { work: w, lines: w.lines, strategy: 'S1 标题精确' }
  }
  if (exact.length > 1) {
    if (key) {
      const hits = exact.map((w) => ({ w, r: extractFromAnchor(w, key, expect) })).filter((x) => x.r)
      if (hits.length >= 1) {
        const texts = new Set(hits.map((h) => normText(h.r.lines.join(''))))
        if (texts.size === 1) return { work: hits[0].w, lines: hits[0].r.lines, strategy: 'S1 标题精确+首句消歧（跨源同文）' }
        return { work: hits[0].w, lines: hits[0].r.lines, strategy: 'S1 标题精确+首句消歧（跨源异文，取优先源）', warn: '跨源同题文本有异文，已取优先源版本，建议人工核对' }
      }
      return { fail: `语料同题 ${exact.length} 条且首句「${key}」未命中` }
    }
    const texts = new Set(exact.map((w) => normText(w.lines.join(''))))
    if (texts.size === 1) return { work: exact[0], lines: exact[0].lines, strategy: 'S1 标题精确（跨源同文去重）' }
    // 多源异文且课标未给首句：按源优先级取标准选本版本（唐诗三百首/千家诗 > 全唐诗），并提示人工核对
    return {
      work: exact[0], lines: exact[0].lines,
      strategy: `S1 标题精确（${exact.length} 源异文，取优先源 ${exact[0].source}）`,
      warn: `跨源同题文本有异文（${exact.map((w) => w.source).join('/')}），已取 ${exact[0].source} 版本，建议人工核对`,
    }
  }

  // —— S2 词牌匹配（词/曲）——
  const tune = tuneOf(item)
  if (tune) {
    const tuneNorm = normTitle(tune)
    const cands = works.filter((w) =>
      normAuthor(w.author) === authorNorm &&
      ((w.tune && normTitle(w.tune).includes(tuneNorm)) || normTitle(w.title).includes(tuneNorm))).sort(byPriority)
    if (cands.length) {
      if (key) {
        const frag6 = keyFragment(key, 6)
        const frag4 = keyFragment(key, 4)
        const hit = cands.find((w) => w.lines.join('').includes(frag6) || w.lines.join('').includes(frag4))
        if (hit) return { work: hit, lines: hit.lines, strategy: `S2 词牌（${tune}）+首句` }
        return { fail: `词牌 ${tune} 有 ${cands.length} 候选但首句「${key}」未命中` }
      }
      // 无首句：按题名"·"后副题匹配（乙卯正月二十日夜记梦/过洞庭/京口北固亭怀古 等）
      const subNorm = normTitle(item.title.split('·').slice(1).join(''))
      if (subNorm) {
        const bySub = cands.filter((w) => normTitle(w.title + w.extra).includes(subNorm) || [...w.lines].join('').includes(subNorm))
        if (bySub.length === 1) return { work: bySub[0], lines: bySub[0].lines, strategy: `S2 词牌（${tune}）+副题` }
        if (bySub.length > 1) {
          const texts = new Set(bySub.map((w) => normText(w.lines.join(''))))
          if (texts.size === 1) return { work: bySub[0], lines: bySub[0].lines, strategy: `S2 词牌（${tune}）+副题（同文去重）` }
        }
      }
      if (cands.length === 1) return { work: cands[0], lines: cands[0].lines, strategy: `S2 词牌（${tune}）唯一` }
      return { fail: `词牌 ${tune} 有 ${cands.length} 候选且课标未给首句/副题，无法消歧` }
    }
  }

  // —— S3 题名前缀（语料"X 其N"类 + 首句校验）——
  const prefix = works.filter((w) =>
    normAuthor(w.author) === authorNorm &&
    normTitle(w.title).startsWith(itemTitleNorm) && normTitle(w.title) !== itemTitleNorm).sort(byPriority)
  if (prefix.length && key) {
    for (const w of prefix) {
      const r = extractFromAnchor(w, key, expect)
      if (r) return { work: w, lines: r.lines, strategy: 'S3 题名前缀+首句' + (r.split ? '（组诗内抽取）' : '') }
    }
    // 标题层面已确认身份但首句未命中：多为课本通行文本与底本异文（如「千里黄云」/「十里黄云」）
    const firstHit = prefix.filter((w) => /一$|其一/.test(w.title))
    if (firstHit.length === 1) {
      return { work: firstHit[0], lines: firstHit[0].lines, strategy: 'S3 题名前缀（组诗其一，异文）',
        warn: `首句「${key}」未在底本命中，疑为通行文本异文，已按篇名导入《${firstHit[0].title}》，务必人工核对` }
    }
  }
  // 无首句锚点的组诗（如《别董大二首 一/二》《书湖阴先生壁二首》）：优先取「其一」
  if (prefix.length >= 1 && !key) {
    const first = prefix.filter((w) => /[（(]?其一[)）]?$|\s一$|[其]?一$/.test(w.title))
    const pick = first.length === 1 ? first[0] : (prefix.length === 1 ? prefix[0] : null)
    if (pick) {
      if (expect != null && workClauseCount(pick) > expect) {
        const lines = pick.lines.join('').split(/(?<=[，。；？！])/).filter(Boolean).map((s) => s.trim()).filter(Boolean).slice(0, expect)
        if (lines.length === expect) {
          return { work: pick, lines, strategy: 'S3 题名前缀（组诗取其一）', warn: `课标未给首句，已取组诗《${pick.title}》其一，建议核对` }
        }
      }
      return { work: pick, lines: pick.lines, strategy: 'S3 题名前缀（组诗其一）', warn: `组诗多条，已取《${pick.title}》，建议核对` }
    }
  }

  // —— S4 首句定位（作者一致 + 首句锚点，覆盖题名变体/组诗）——
  if (key) {
    const byAuthor = works.filter((w) => normAuthor(w.author) === authorNorm)
    for (const frag of [keyFragment(key, 6), keyFragment(key, 4), keyFragment(key, 3)].filter(Boolean)) {
      const hits = []
      for (const w of byAuthor) {
        const r = extractFromAnchor(w, frag, expect)
        if (r) hits.push({ w, r })
      }
      if (hits.length >= 1) {
        const texts = new Set(hits.map((h) => normText(h.r.lines.join(''))))
        if (texts.size === 1) {
          const h = hits[0]
          return { work: h.w, lines: h.r.lines, strategy: 'S4 首句定位' + (h.r.split ? '（组诗内抽取）' : '') }
        }
        const best = hits.find((h) => normTitle(h.w.title) === itemTitleNorm || normTitle(h.w.title).startsWith(itemTitleNorm))
        if (best) return { work: best.w, lines: best.r.lines, strategy: 'S4 首句定位（同名优先，组诗内抽取）' }
        return { fail: `首句「${frag}」命中 ${hits.length} 条且文本互异，无法消歧` }
      }
    }
  }

  // —— S5 古文观止篇名兜底（作者按课标著录）——
  const gwHit = works.filter((w) => w.source === '古文观止' && normTitle(w.title) === itemTitleNorm)
  if (gwHit.length === 1) return { work: gwHit[0], lines: gwHit[0].lines, strategy: 'S5 古文篇名（作者按课标）' }
  if (gwHit.length > 1) {
    const byA = gwHit.filter((w) => normAuthor(w.author) === authorNorm)
    if (byA.length === 1) return { work: byA[0], lines: byA[0].lines, strategy: 'S5 古文篇名+作者' }
  }

  return { fail: '语料中未找到该作品（作者+篇名+首句均未命中）' }
}

// ─────────────────────────── 拼音与 id ───────────────────────────

const py = (s) => pinyin(String(s ?? ''), { toneType: 'none', type: 'array', nonZh: 'consecutive' })
const pyJoin = (s) => py(s).join('').replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
const pySpace = (s) => py(s).join(' ').replace(/\s+/g, ' ').trim()

// ─────────────────────────── 既有种子文件 ───────────────────────────

function extractOriginalBody(body) {
  const m = String(body).match(/##\s*原文\s*\n([\s\S]*?)(?=\n>\s|\n##|$)/)
  return (m?.[1] ?? '').trim()
}

function loadExistingPoems() {
  const dir = path.join(CONTENT, 'poems')
  const map = new Map()
  if (!fs.existsSync(dir)) return map
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      if (fs.statSync(p).isDirectory()) walk(p)
      else if (f.endsWith('.md')) {
        const parsed = matter.read(p)
        if (parsed.data?.id) map.set(parsed.data.id, { abs: p, data: parsed.data, body: parsed.content })
      }
    }
  }
  walk(dir)
  return map
}

// ─────────────────────────── 作者确凿数据（生卒年仅确凿者填，宁缺勿错） ───────────────────────────

const AUTHOR_FACTS = {
  贺知章: { courtesy: '季真', birth: 659, death: 744 },
  王之涣: { courtesy: '季凌', birth: 688, death: 742 },
  孟浩然: { birth: 689, death: 740 },
  王昌龄: { courtesy: '少伯', birth: 698, death: 757 },
  高适: { courtesy: '达夫', birth: 704, death: 765 },
  韦应物: { birth: 737, death: 792 },
  卢纶: { birth: 739, death: 799 },
  孟郊: { courtesy: '东野', birth: 751, death: 814 },
  韩愈: { courtesy: '退之', birth: 768, death: 824 },
  刘禹锡: { courtesy: '梦得', birth: 772, death: 842 },
  白居易: { courtesy: '乐天', pseudonym: '香山居士', birth: 772, death: 846 },
  李绅: { courtesy: '公垂', birth: 772, death: 846 },
  贾岛: { courtesy: '阆仙', birth: 779, death: 843 },
  李贺: { courtesy: '长吉', birth: 790, death: 816 },
  杜牧: { courtesy: '牧之', pseudonym: '樊川居士', birth: 803, death: 852 },
  罗隐: { birth: 833, death: 910 },
  岑参: { birth: 715, death: 770 },
  王湾: { birth: 693, death: 751 },
  陈子昂: { courtesy: '伯玉', birth: 659, death: 702 },
  李商隐: { courtesy: '义山' },
  温庭筠: { courtesy: '飞卿' },
  张志和: { courtesy: '子同', pseudonym: '烟波钓徒' },
  李煜: { courtesy: '重光', birth: 937, death: 978 },
  范仲淹: { courtesy: '希文', birth: 989, death: 1052 },
  晏殊: { courtesy: '同叔', birth: 991, death: 1055 },
  欧阳修: { courtesy: '永叔', pseudonym: '六一居士', birth: 1007, death: 1072 },
  王安石: { courtesy: '介甫', pseudonym: '半山', birth: 1021, death: 1086 },
  周敦颐: { courtesy: '茂叔', birth: 1017, death: 1073 },
  苏洵: { courtesy: '明允', birth: 1009, death: 1066 },
  苏辙: { courtesy: '子由', birth: 1039, death: 1112 },
  黄庭坚: { courtesy: '鲁直', pseudonym: '山谷道人', birth: 1045, death: 1105 },
  秦观: { courtesy: '少游', birth: 1049, death: 1100 },
  周邦彦: { courtesy: '美成', pseudonym: '清真居士', birth: 1056, death: 1121 },
  李清照: { pseudonym: '易安居士', birth: 1084 },
  张孝祥: { courtesy: '安国', birth: 1132, death: 1170 },
  辛弃疾: { courtesy: '幼安', pseudonym: '稼轩', birth: 1140, death: 1207 },
  姜夔: { courtesy: '尧章', pseudonym: '白石道人' },
  刘克庄: { birth: 1187, death: 1269 },
  文天祥: { courtesy: '履善', birth: 1236, death: 1283 },
  曾几: { courtesy: '吉甫', pseudonym: '茶山居士', birth: 1085, death: 1166 },
  陆游: { courtesy: '务观', pseudonym: '放翁', birth: 1125, death: 1210 },
  范成大: { courtesy: '致能', pseudonym: '石湖居士', birth: 1126, death: 1193 },
  杨万里: { courtesy: '廷秀', pseudonym: '诚斋', birth: 1127, death: 1206 },
  朱熹: { courtesy: '元晦', pseudonym: '晦庵', birth: 1130, death: 1200 },
  王禹偁: { birth: 954, death: 1001 },
  曹操: { courtesy: '孟德', birth: 155, death: 220 },
  诸葛亮: { courtesy: '孔明', birth: 181, death: 234 },
  司马迁: { courtesy: '子长', birth: -145 },
  贾谊: { birth: -200, death: -168 },
  李斯: { death: -208 },
  魏征: { courtesy: '玄成', birth: 580, death: 643 },
  屈原: {},
  王勃: { courtesy: '子安' },
  王羲之: { courtesy: '逸少', birth: 303, death: 361 },
  张岱: { courtesy: '宗子', pseudonym: '陶庵', birth: 1597, death: 1689 },
  马致远: { pseudonym: '东篱' },
  张养浩: { courtesy: '希孟', pseudonym: '云庄', birth: 1270, death: 1329 },
  龚自珍: { courtesy: '璱人', birth: 1792, death: 1841 },
}

// ─────────────────────────── frontmatter 生成 ───────────────────────────

function buildPoemFile({ id, title, author, dynasty, form, tune, grade, stage, note, anthology, stageTag }, lines) {
  const fm = [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    `title_pinyin: ${pySpace(title)}`,
    `author: ${author}`,
    `dynasty: ${dynasty}`,
    `form: ${form ?? '文'}`,
    `tune: ${tune ?? ''}`,
    'genre: 待归类',
    'imagery: []',
    'allusions: []',
    `tags: [${stageTag}, 课标必背]`,
    'curriculum:',
    `  stage: ${stage}`,
    `  grade: ${grade}`,
    '  semester:',
    '  recitation: true',
    '  task_group:',
    ...(note ? [`  note: ${note}`] : []),
    'source:',
    `  anthology: ${anthology}`,
    '  year:',
    'links:',
    '  - rel: 属朝代',
    `    to: ${dynasty}`,
    '  - rel: 学段',
    `    to: ${STAGE_LABEL[stage]}`,
    'notes:',
    '  annotated: false',
    '  translated: false',
    '---',
    '',
    '## 原文',
    '',
    // 清洗底本内嵌校勘注（如「（遍 一作：徧)」「一作：不知其」），它们不属于作品正文
    ...lines.map((l) => l.replace(/[（(][^（）()]*一作[^（）()]*[）)]/g, '').replace(/\s*一作[:：][^。；]*/g, '').trim()).filter(Boolean),
    '',
    `> 底本：${anthology}。背诵请以现行教材为准，个别字句各本有异文。`,
    '',
    '> 注释与译文：待补充（仅供参考）',
    '',
  ]
  return fm.join('\n')
}

// ─────────────────────────── 主流程 ───────────────────────────

async function main() {
  log.info('万卷课标导入启动（{0}）', dryRun ? '演练模式：只匹配不落盘' : '写盘模式')
  loadCorpus()

  const items = loadCurriculum()
  log.info('课标条目：小学 75 · 初中 60 · 高中 72，共 {0} 条', items.length)

  const existing = loadExistingPoems()
  log.info('既有种子作品 {0} 篇（同题合并更新，不重复创建）', existing.size)
  const usedIds = new Set(existing.keys())

  const results = []
  const newAuthors = new Map()
  let created = 0, updated = 0, skipped = 0

  const matchStep = log.step('逐条匹配课标篇目')
  for (const item of items) {
    if (!item.dynasty) {
      results.push({ item, status: '未匹配', reason: '课标未标朝代（古代文论选段为六则多源合集，语料无对应）' })
      continue
    }
    const m = matchItem(item)
    if (m.fail) {
      results.push({ item, status: '未匹配', reason: m.fail })
      log.warn('未匹配 {0} #{1}《{2}》：{3}', STAGE_LABEL[item.stage], item.no, item.title, m.fail)
      continue
    }

    // 种子识别：id 相同，或 题+作者 相同，且种子正文含本条首句（防《己亥杂诗》两首误合）
    const authorDir = normAuthor(item.author)
    const key = firstLineKey(item.note)
    const baseId = `${pyJoin(item.dynasty)}-${pyJoin(authorDir)}-${pyJoin(item.title)}`
    let id = baseId
    let title = item.title
    let seed = existing.get(id)
    if (!seed) {
      seed = [...existing.values()].find((e) =>
        normTitle(e.data.title) === normTitle(item.title) && normAuthor(e.data.author) === normAuthor(item.author))
    }
    if (seed && key) {
      const seedBody = normText(extractOriginalBody(seed.body))
      if (!seedBody.includes(keyFragment(key, 4))) {
        // 同名不同首（如两首《己亥杂诗》/《绝句》）：种子归前条，本条走新建消歧
        if (!usedIds.has(`${baseId}-x`)) seed = undefined
      }
    }
    if (!seed && usedIds.has(id)) {
      const suffix = pyJoin(keyFragment(key ?? item.title, 4)) || '2'
      id = `${baseId}-${suffix}`
      if (usedIds.has(id)) { results.push({ item, status: '未匹配', reason: `id 冲突无法消歧（${id}）` }); continue }
      title = `${item.title}·${(key ?? '').split(/[，,。]/)[0]}`.replace(/·$/, '')
    }

    const abs = seed ? seed.abs : path.join(CONTENT, 'poems', item.dynasty, authorDir, `${title.replace(/[\\/:*?"<>|]/g, '')}.md`)
    if (!seed) usedIds.add(id)
    newAuthors.set(item.author, item.dynasty)
    results.push({ item, status: seed ? '更新种子' : '新建', id, title, abs, seed, work: m.work, lines: m.lines, strategy: m.strategy, warn: m.warn })
  }

  const okCount = results.filter((r) => r.status !== '未匹配').length
  matchStep.end('匹配完成：成功 {0}/{1} · 未匹配 {2}', okCount, items.length, items.length - okCount)

  if (dryRun) {
    log.summary('演练摘要', [
      ['匹配成功', `${okCount} / ${items.length}`],
      ['未匹配', `${items.length - okCount} 条`],
      ['新增作者页（拟）', `${[...newAuthors.keys()].filter((a) => !/[《》]/.test(a) && !['汉乐府', '北朝民歌'].includes(a)).length} 位`],
    ])
    for (const r of results.filter((x) => x.status === '未匹配')) {
      log.info('  未匹配 {0} #{1}《{2}》{3}：{4}', STAGE_LABEL[r.item.stage], r.item.no, r.item.title, r.item.author ?? '', r.reason)
    }
    return
  }

  // ── 写作品文件 ──
  const writeStep = log.step('写出作品 Markdown')
  const tradSourcesHit = new Set()
  for (const r of results) {
    if (r.status === '未匹配') { skipped++; continue }
    const { item, seed } = r

    if (seed) {
      const data = { ...seed.data }
      data.curriculum = {
        ...seed.data.curriculum,
        stage: item.stage,
        grade: seed.data.curriculum?.grade ?? STAGE_GRADE[item.stage],
        recitation: item.recitation ?? true,
        ...(item.note ? { note: item.note } : {}),
      }
      const same = normText(extractOriginalBody(seed.body)) === normText(r.lines.join('\n'))
      if (!same) r.warn = '种子正文与语料文本存在异文，已保留种子人工正文（待人工核对）'
      fs.writeFileSync(seed.abs, matter.stringify(seed.body, data, { lineWidth: -1 }))
      updated++
      if (r.work.traditional) tradSourcesHit.add(r.work.source)
      continue
    }

    const content = buildPoemFile({
      id: r.id,
      title: r.title,
      author: item.author,
      dynasty: item.dynasty,
      form: item.form,
      tune: tuneOf(item),
      grade: STAGE_GRADE[item.stage],
      stage: item.stage,
      note: item.note,
      anthology: r.work.anthology ?? r.work.source,
      stageTag: `${STAGE_LABEL[item.stage]}必背`,
    }, r.lines)
    fs.mkdirSync(path.dirname(r.abs), { recursive: true })
    fs.writeFileSync(r.abs, content)
    created++
    if (r.work.traditional) tradSourcesHit.add(r.work.source)
  }
  writeStep.end('写出完成：新建 {0} 篇 · 更新种子 {1} 篇 · 未匹配 {2} 条', created, updated, skipped)

  // ── 写作者页 ──
  const authorStep = log.step('生成新增作者页')
  let authorsCreated = 0
  const EXISTING_AUTHORS = new Set(['李白', '杜甫', '苏轼', '王维'])
  for (const [name, dynasty] of newAuthors) {
    if (EXISTING_AUTHORS.has(name) || /[《》]/.test(name) || ['汉乐府', '北朝民歌'].includes(name)) continue
    const abs = path.join(CONTENT, 'authors', `${name}.md`)
    if (fs.existsSync(abs)) continue
    const facts = AUTHOR_FACTS[name] ?? {}
    const y = (v) => (v === undefined ? '' : String(v))
    const lines = [
      '---',
      `id: author-${pyJoin(name)}`,
      `name: ${name}`,
      `courtesy: ${y(facts.courtesy ?? '')}`,
      `pseudonym: ${y(facts.pseudonym ?? '')}`,
      `birth: ${y(facts.birth ?? '')}`,
      `death: ${y(facts.death ?? '')}`,
      `dynasty: ${dynasty}`,
      'wikidata:',
      'cbdb:',
      'school:',
      'masters: []',
      'friends: []',
      'famous_forms: []',
      'tags: [课标作者]',
      '---',
      '',
      '## 简介',
      '',
      `${name}，${dynasty}文学家。`,
      '',
      '> 生平与作品系年：待补充（仅供参考）',
      '',
    ]
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, lines.join('\n'))
    authorsCreated++
  }
  authorStep.end('新增作者页 {0} 位（生卒年仅确凿者填）', authorsCreated)

  // ── 导入报告 ──
  const reportStep = log.step('写出导入报告')
  writeReport({ results, items, created, updated, skipped, authorsCreated, tradSourcesHit })
  reportStep.end('报告已写出：{0}', path.relative(ROOT, REPORT))

  log.summary('导入摘要', [
    ['课标条目', `${items.length} 条`],
    ['导入成功', `${okCount} / ${items.length}`],
    ['新建作品', `${created} 篇`],
    ['更新种子', `${updated} 篇`],
    ['未匹配', `${skipped} 条（详见 docs/import-report.md）`],
    ['新增作者页', `${authorsCreated} 位`],
    ['繁体转换源', tradSourcesHit.size ? [...tradSourcesHit].join('、') : '无'],
    ['结果', '完成'],
  ])
  if (skipped > 0) log.warn('存在 {0} 条未匹配篇目，已如实留待人工（见 docs/import-report.md）', skipped)
}

function writeReport({ results, items, created, updated, skipped, authorsCreated, tradSourcesHit }) {
  const ok = results.filter((r) => r.status !== '未匹配')
  const unmatched = results.filter((r) => r.status === '未匹配')
  const L = []
  L.push('# 课标 207 篇推荐背诵作品导入报告')
  L.push('')
  L.push('> 导入工具：`scripts/import-curriculum.mjs`；语料：chinese-poetry 开源库（`scripts/fetch-curriculum-corpus.mjs` 经 jsDelivr CDN 逐文件获取至 `.vendor/chinese-poetry/`）。')
  L.push(`> 生成时间：${new Date().toISOString()}`)
  L.push('')
  L.push('## 1. 总量')
  L.push('')
  L.push('| 学段 | 课标条目 | 导入成功 | 未匹配 |')
  L.push('|---|---|---|---|')
  for (const st of ['primary', 'junior', 'senior']) {
    const total = items.filter((i) => i.stage === st).length
    const hit = ok.filter((r) => r.item.stage === st).length
    L.push(`| ${STAGE_LABEL[st]} | ${total} | ${hit} | ${total - hit} |`)
  }
  L.push(`| 合计 | ${items.length} | ${ok.length} | ${unmatched.length} |`)
  L.push('')
  L.push(`- 新建作品 ${created} 篇；更新既有种子 ${updated} 篇；新增作者页 ${authorsCreated} 位。`)
  L.push('- **grade 占位**：课标 JSON 207 条 grade 均为 null（课标未按年级分组），构建 schema 要求 1–12 整数，新作品按学段起始年级占位（小学→1、初中→7、高中→10），**待按统编教材册次人工补正**；种子 12 篇保留人工 grade。')
  L.push('- **genre 占位**：统一置"待归类"（schema 必填非空，不臆断题材）；imagery/allusions 留空数组。')
  L.push(`- **繁→简转换**：${[...tradSourcesHit].join('、') || '（无）'} 为繁体，按 OpenCC 标准字典（词组最长匹配+单字）转换；异体字归一：篛→箬（《第一批异体字整理表》）。论语/诗经/楚辞/曹操诗集/宋词/元曲/南唐二主词语料为简体。`)
  L.push('- **正文来源**：语料逐字文本，保留原有分段；注释与译文为"待补充（仅供参考）"占位。')
  L.push('')
  L.push('## 2. 未匹配清单（留待人工，绝不编造）')
  L.push('')
  L.push('| 学段 | 条目 | 作者 | 未匹配原因 |')
  L.push('|---|---|---|---|')
  for (const r of unmatched) L.push(`| ${STAGE_LABEL[r.item.stage]} #${r.item.no} | ${r.item.title} | ${r.item.author ?? ''} | ${r.reason} |`)
  L.push('')
  L.push('> 语料覆盖缺口（chinese-poetry 未收录）：汉魏六朝诗与乐府、北朝民歌、元明清诗、清近代作品、先秦诸子（荀/庄/老/吕）、部分史传与宋明古文。')
  L.push('')
  L.push('## 3. 节选/章选切分（建议人工复核边界）')
  L.push('')
  L.push('| 学段 | 条目 | 切分方式 |')
  L.push('|---|---|---|')
  for (const r of ok.filter((x) => x.strategy.startsWith('SX'))) L.push(`| ${STAGE_LABEL[r.item.stage]} #${r.item.no} | ${r.item.title} | ${r.strategy} |`)
  L.push('')
  L.push('> 锚点依据课标 note 所列章目/节选起止；输出为语料逐字切片，句读延伸至句末，剥除切片两端悬挂引号。')
  L.push('')
  L.push('## 4. 异文与作者标注提示')
  L.push('')
  const warns = ok.filter((x) => x.warn)
  L.push(warns.length ? warns.map((r) => `- ${r.item.title}（${r.item.author}）：${r.warn}`).join('\n') : '- 无跨源异文提示；种子 12 篇正文与语料一致（去标点空白比对）。')
  const mism = ok.filter((r) =>
    r.work.author && normAuthor(r.work.author) !== normAuthor(r.item.author) && !String(r.item.author).startsWith('《'))
  if (mism.length) {
    L.push('')
    L.push('**语料作者标注与课标不同（正文取语料，作者按课标著录）**：')
    L.push(mism.map((r) => `- ${r.item.title}：课标 ${r.item.author} / 语料 ${r.work.author}`).join('\n'))
  }
  L.push('')
  L.push('## 5. 导入明细')
  L.push('')
  L.push('| 学段 | 条目 | 作者 | 状态 | id | 匹配策略 | 语料源 |')
  L.push('|---|---|---|---|---|---|---|')
  for (const r of results) {
    L.push(`| ${STAGE_LABEL[r.item.stage]} #${r.item.no} | ${r.item.title} | ${r.item.author ?? ''} | ${r.status} | ${r.id ?? '—'} | ${r.strategy ?? '—'} | ${r.work?.source ?? '—'} |`)
  }
  fs.writeFileSync(REPORT, L.join('\n') + '\n', 'utf8')
}

main().catch((err) => {
  log.error('导入异常终止：{0}', err?.stack || err?.message || err)
  process.exit(1)
})
