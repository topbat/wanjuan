/**
 * 万卷 · 问书库（/ask/）的本地检索与 Ollama 桥接
 *
 * 设计边界：
 *   - 检索完全在浏览器内完成，数据来自构建期生成的 /indexes/*.json；
 *   - 只有用户显式配置并连接本机 Ollama 时，才会把「问题 + Top 8 检索片段」发到本机；
 *   - 不内置 API Key，不请求任何第三方服务。
 *
 * 检索思路（无需模型即可用）：
 *   1. 问题清洗：去掉「有哪些 / 关于 / 形容」等提问框架词，保留实体与主题词；
 *   2. 中文分词：按连续汉字段生成「整段 + 汉字 bigram + 单字」三级词项；
 *   3. 拼音通道：ASCII 输入复用 search.json 的 pinyin / pinyinFirst 字段，
 *      并反查作者名，让「libai / lb」也能召回李白的诗句与作品；
 *   4. 主题扩展：把「思乡 / 勤奋 / 坚持」等映射到名句 theme 与常用同义词；
 *   5. 三路召回：lines.json（诗句）、quotes.json（名句）、search.json（作品/成语/名句/作者/意象），
 *      各自打分后归一化展示，合并 Top 8 作为生成式回答的 context。
 */

export type EntryType = 'poem' | 'idiom' | 'quote' | 'author' | 'imagery'

export interface SearchEntry {
  type: EntryType
  id: string
  title: string
  subtitle: string
  tokens: string[]
  pinyin: string
  pinyinFirst: string
  excerpt: string
  srcPath: string
  /** 预处理字段（小写 / 去空格） */
  _title: string
  _subtitle: string
  _excerpt: string
  _tokens: string[]
  _pinyin: string
  _pinyinFirst: string
}

export interface PoemLine {
  line: string
  poemId: string
  title: string
  author: string
  dynasty: string
  srcPath: string
  _line: string
  _title: string
  _author: string
  _dynasty: string
  _poem?: SearchEntry
  _authorEntry?: SearchEntry
}

export interface QuoteEntry {
  id: string
  text: string
  author: string
  work?: string | null
  theme: string[]
  dynasty?: string
  tags: string[]
  citation?: string | null
  sourceType?: string
  excerpt?: string
  srcPath: string
  _text: string
  _author: string
  _citation: string
  _theme: string[]
  _tags: string[]
  _entry?: SearchEntry
  _workTitle: string
}

export interface Corpus {
  entries: SearchEntry[]
  lines: PoemLine[]
  quotes: QuoteEntry[]
  poemById: Map<string, SearchEntry>
  entryById: Map<string, SearchEntry>
  authorByName: Map<string, SearchEntry>
  counts: Record<EntryType, number> & { lines: number; quotes: number }
}

export interface WeightedTerm {
  text: string
  weight: number
  kind: 'phrase' | 'bigram' | 'char' | 'extra' | 'hint' | 'ascii'
}

export interface QueryPlan {
  raw: string
  cleaned: string
  /** 清洗后的连续汉字（用于整句 / 标题精确匹配） */
  queryCompact: string
  /** 「含月」「带有月亮」这类硬性字面约束：结果必须包含该字词 */
  literalMusts: string[]
  terms: WeightedTerm[]
  ascii: string[]
  pinyinCompact: string
  themes: string[]
  typeBoost: Partial<Record<EntryType, number>>
  compare: boolean
  needsSynthesis: boolean
}

export type HitKind = 'line' | 'quote' | 'entry'

export interface Hit {
  key: string
  kind: HitKind
  type?: EntryType
  score: number
  /** 主要展示文本（诗句原文 / 名句原文 / 条目名） */
  primary: string
  /** 副行（《篇名》· 作者 / 词条副题） */
  secondary: string
  /** 送给模型的资料片段 */
  snippet: string
  source: string
  route: string
  workTitle: string
  author: string
  matched: string
  poemId?: string
  ref?: number
}

export interface RagResult {
  lines: Hit[]
  quotes: Hit[]
  entries: Hit[]
  all: Hit[]
  totals: { lines: number; quotes: number; entries: number }
}

export interface Citation {
  n: number
  kind: HitKind
  type?: EntryType
  title: string
  author: string
  kicker: string
  snippet: string
  route: string
}

export interface ChatDeltaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const TYPE_LABEL: Record<EntryType, string> = {
  poem: '作品',
  idiom: '成语',
  quote: '名句',
  author: '作者',
  imagery: '意象',
}

const BASE = import.meta.env.BASE_URL || '/'
const ASSET_BASE = BASE.endsWith('/') ? BASE : `${BASE}/`

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

function normText(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 拼音：去声调、去空格与标点，便于 contains / prefix 匹配 */
function normPinyin(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  let pos = 0
  while (true) {
    const idx = haystack.indexOf(needle, pos)
    if (idx < 0) break
    n += 1
    pos = idx + needle.length
  }
  return n
}

/** 去掉「三月 / 九月十五日 / 四月」这类月份日期，避免把「月」误当月亮 */
function stripMonthDates(text: string): string {
  return text.replace(
    /(?:[一二三四五六七八九十百千万零〇两0-9]{1,3}|正|腊)月(?:份|日|初|中|底|间)?/g,
    '',
  )
}

/** 「含月」等字面约束：月要排除月份用法 */
function hasLiteral(text: string, must: string): boolean {
  if (must === '月') return stripMonthDates(text).includes('月')
  return text.includes(must)
}

/** 月亮语义（明月/月光/月夜…）加权，进一步压低「三月下扬州」这类日期句 */
function isMoonPhrase(text: string): boolean {
  return /明月|月光|月色|月夜|月明|月华|秋月|春月|婵娟|月影|月轮|新月|残月|满月|月照|月落|月出|月上|月下|望月|对月|月如|月有|月是|月近|月满/.test(
    text,
  )
}

/** srcPath → 站内静态路由（与 config.mts 的 rewrites 一致；补 .html 以适配静态托管） */
export function toSiteRoute(srcPath: string): string {
  let clean = String(srcPath ?? '')
    .replace(/^content\//, '')
    .replace(/\.md$/i, '')
  if (clean.endsWith('/index')) clean = clean.slice(0, -'/index'.length)
  if (!clean) return ASSET_BASE
  if (!clean.endsWith('/') && !/\.html?$/i.test(clean)) clean += '.html'
  return encodeURI(`${ASSET_BASE}${clean}`)
}

/* ------------------------------------------------------------------ */
/* 语料加载                                                            */
/* ------------------------------------------------------------------ */

async function fetchItems<T>(url: string): Promise<T[]> {
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`HTTP ${res.status} · ${url.replace(ASSET_BASE, '/')}`)
  const data = await res.json()
  const items = Array.isArray(data) ? data : data?.items
  if (!Array.isArray(items)) throw new Error(`索引格式异常 · ${url.replace(ASSET_BASE, '/')}`)
  return items as T[]
}

let corpusPromise: Promise<Corpus> | null = null

export function loadCorpus(): Promise<Corpus> {
  if (!corpusPromise) {
    corpusPromise = buildCorpus().catch((err) => {
      corpusPromise = null
      throw err
    })
  }
  return corpusPromise
}

async function buildCorpus(): Promise<Corpus> {
  const [rawEntries, rawLines, rawQuotes] = await Promise.all([
    fetchItems<SearchEntry>(`${ASSET_BASE}indexes/search.json`),
    fetchItems<PoemLine>(`${ASSET_BASE}indexes/lines.json`),
    fetchItems<QuoteEntry>(`${ASSET_BASE}indexes/quotes.json`),
  ])

  const counts = { poem: 0, idiom: 0, quote: 0, author: 0, imagery: 0, lines: 0, quotes: 0 }

  const entries: SearchEntry[] = rawEntries
    .filter((e) => e && e.id && e.title && e.srcPath)
    .map((e) => {
      if (counts[e.type] !== undefined) counts[e.type] += 1
      const tokens = Array.isArray(e.tokens) ? e.tokens : []
      return {
        ...e,
        type: e.type,
        title: String(e.title ?? ''),
        subtitle: String(e.subtitle ?? ''),
        tokens,
        pinyin: String(e.pinyin ?? ''),
        pinyinFirst: String(e.pinyinFirst ?? ''),
        excerpt: String(e.excerpt ?? ''),
        srcPath: String(e.srcPath ?? ''),
        _title: normText(e.title),
        _subtitle: normText(e.subtitle),
        _excerpt: normText(e.excerpt),
        _tokens: tokens.map(normText),
        _pinyin: normPinyin(e.pinyin),
        _pinyinFirst: normPinyin(e.pinyinFirst),
      }
    })

  const entryById = new Map<string, SearchEntry>()
  const poemById = new Map<string, SearchEntry>()
  const authorByName = new Map<string, SearchEntry>()
  for (const e of entries) {
    entryById.set(e.id, e)
    if (e.type === 'poem') poemById.set(e.id, e)
    if (e.type === 'author') authorByName.set(normText(e.title), e)
  }

  const lines: PoemLine[] = rawLines
    .filter((l) => l && l.line && l.poemId && l.srcPath)
    .map((l) => {
      const authorName = normText(l.author)
      return {
        ...l,
        line: String(l.line ?? ''),
        title: String(l.title ?? ''),
        author: String(l.author ?? ''),
        dynasty: String(l.dynasty ?? ''),
        srcPath: String(l.srcPath ?? ''),
        _line: normText(l.line),
        _title: normText(l.title),
        _author: authorName,
        _dynasty: normText(l.dynasty),
        _poem: poemById.get(l.poemId),
        _authorEntry: authorByName.get(authorName),
      }
    })

  const quotes: QuoteEntry[] = rawQuotes
    .filter((q) => q && q.id && q.text && q.srcPath)
    .map((q) => {
      const theme = Array.isArray(q.theme) ? q.theme : []
      const tags = Array.isArray(q.tags) ? q.tags : []
      const entry = entryById.get(q.id)
      const workTitle = q.work ? poemById.get(q.work)?.title ?? '' : ''
      return {
        ...q,
        text: String(q.text ?? ''),
        author: String(q.author ?? ''),
        theme,
        tags,
        citation: q.citation ?? '',
        srcPath: String(q.srcPath ?? ''),
        _text: normText(q.text),
        _author: normText(q.author),
        _citation: normText(q.citation),
        _theme: theme.map(normText),
        _tags: tags.map(normText),
        _entry: entry,
        _workTitle: workTitle,
      }
    })

  counts.lines = lines.length
  counts.quotes = quotes.length

  return { entries, lines, quotes, poemById, entryById, authorByName, counts }
}

/* ------------------------------------------------------------------ */
/* 问题分析                                                            */
/* ------------------------------------------------------------------ */

/** 提问框架词：先去掉，避免「名句」二字把整库名句都召回 */
const REQUEST_PATTERNS = [
  '写过哪些', '写过什么', '是谁写的', '可不可以', '能不能', '介绍一下', '告诉我', '问一下',
  '有哪些', '有什么', '是什么', '怎么样', '为什么', '有哪些', '哪些', '什么',
  '请问', '介绍', '一下', '关于', '有关', '相关', '包含', '含有', '带有',
  '帮我', '帮忙', '知道', '列举', '列出', '推荐', '一些', '几首', '一首', '几篇', '一篇',
  '写过', '写的', '作品', '诗句', '名句', '句子', '成语', '词语', '作者', '诗人', '词人',
  '意思', '含义', '解释', '形容', '表达', '表现', '主题', '内容', '需要', '可以', '能否',
  '说说', '讲讲', '看看', '找找', '查找', '搜索', '检索', '描写', '含', '带',
  '怎么', '如何', '是否', '还是', '或者', '以及',
].sort((a, b) => b.length - a.length)

const TYPE_HINTS: Array<{ type: EntryType; words: string[] }> = [
  { type: 'idiom', words: ['成语', '四字', '词语', '释义', '典故'] },
  { type: 'quote', words: ['名句', '句子', '语录', '名言', '金句'] },
  { type: 'poem', words: ['诗', '词', '作品', '篇目', '课文', '古文', '文言文', '曲'] },
  { type: 'author', words: ['作者', '诗人', '词人', '作家', '谁写的', '是谁写的'] },
  { type: 'imagery', words: ['意象', '意境', '象征'] },
]

const TYPE_BOOST: Record<EntryType, number> = {
  idiom: 14,
  quote: 10,
  poem: 6,
  author: 12,
  imagery: 12,
}

/** 主题别名 → 名句 theme + 语料内的常用说法 */
const THEME_RULES: Array<{ keys: string[]; themes: string[]; hints: string[] }> = [
  { keys: ['思乡', '乡愁', '故乡', '怀乡', '思亲', '想家'], themes: ['思念'], hints: ['思乡', '乡愁', '故乡', '故园', '家书', '归乡', '思念', '怀人'] },
  { keys: ['勤奋', '勤学', '刻苦', '努力', '用功', '好学'], themes: ['勤学', '进取'], hints: ['勤奋', '勤学', '刻苦', '努力', '孜孜', '不倦', '悬梁', '凿壁', '囊萤'] },
  { keys: ['坚持', '坚韧', '毅力', '恒心', '不屈'], themes: ['坚韧'], hints: ['坚持', '坚韧', '不懈', '毅力', '恒心', '持之以恒', '锲而不舍', '矢志'] },
  { keys: ['送别', '离别', '告别', '赠别', '留别'], themes: ['友情', '思念'], hints: ['送别', '赠别', '留别', '离别', '故人', '知己'] },
  { keys: ['友情', '友谊', '朋友'], themes: ['友情'], hints: ['友情', '友谊', '故人', '知己', '朋友', '故交'] },
  { keys: ['爱国', '家国', '报国', '忧国'], themes: ['家国'], hints: ['家国', '报国', '山河', '社稷', '忧国'] },
  { keys: ['自信', '信心'], themes: ['自信'], hints: ['自信', '天生我材', '长风破浪'] },
  { keys: ['豁达', '乐观', '从容'], themes: ['豁达'], hints: ['豁达', '乐观', '从容', '旷达', '闲适'] },
  { keys: ['惜时', '时间', '光阴', '珍惜'], themes: ['惜时'], hints: ['惜时', '光阴', '岁月', '及时', '白驹', '少壮'] },
  { keys: ['清廉', '廉洁', '清白'], themes: ['清廉'], hints: ['清廉', '廉洁', '清白', '两袖'] },
  { keys: ['奉献', '无私', '牺牲'], themes: ['奉献'], hints: ['奉献', '春蚕', '蜡炬', '落红', '无私'] },
  { keys: ['志向', '理想', '抱负', '立志'], themes: ['志向', '进取'], hints: ['志向', '理想', '抱负', '功名', '壮志'] },
  { keys: ['担当', '责任'], themes: ['担当'], hints: ['担当', '责任', '天下', '重任'] },
  { keys: ['孝亲', '孝顺', '母亲', '父亲', '亲情'], themes: ['孝亲'], hints: ['孝亲', '慈母', '游子', '父亲', '母亲', '亲情'] },
  { keys: ['自然', '山水', '田园'], themes: ['自然'], hints: ['自然', '山水', '田园', '山', '水', '江', '河'] },
  { keys: ['哲理', '哲思', '人生'], themes: ['哲思'], hints: ['哲理', '人生', '世事', '浮生', '如梦'] },
  { keys: ['爱情', '相思', '恋人'], themes: ['思念'], hints: ['相思', '爱情', '红豆', '鹊桥', '恋人'] },
]

/**
 * 主题 → 作品 search.json tokens 里的语义标签。
 * 用于给「诗句召回」补一层作品主题分：如《静夜思》带「思乡」标签，
 * 搜索「含月的思乡名句」时自然排在《乡村四月》这类只是字面带「月」的作品之前。
 */
const THEME_TOKENS: Record<string, string[]> = {
  思念: ['思乡', '乡愁', '思念', '怀人', '怀乡', '思亲', '中秋', '怀', '故园', '故乡', '乡', '送别'],
  勤学: ['勤学', '勤奋', '刻苦', '劝学', '惜时', '学习'],
  坚韧: ['坚韧', '坚持', '不懈', '毅力', '励志'],
  友情: ['友情', '送别', '赠别', '离别', '友谊', '怀人'],
  家国: ['家国', '爱国', '报国', '忧国', '边塞'],
  自信: ['自信', '进取', '志向', '励志'],
  豁达: ['豁达', '乐观', '旷达', '闲适', '哲理'],
  惜时: ['惜时', '光阴', '劝学', '哲理'],
  清廉: ['清廉', '廉洁', '清白'],
  奉献: ['奉献', '无私', '家国'],
  志向: ['志向', '理想', '抱负', '励志', '进取'],
  担当: ['担当', '责任', '家国'],
  孝亲: ['孝亲', '亲情', '母爱', '思亲'],
  自然: ['自然', '山水', '田园', '写景'],
  哲思: ['哲理', '哲思', '人生', '怀古'],
}

/** 领域扩展：让「送别」能命中《送友人》《赠汪伦》这类题名 */
const TOPIC_EXPANSIONS: Array<{ keys: string[]; extras: string[] }> = [
  { keys: ['送别', '离别', '赠别', '留别'], extras: ['送', '赠', '别', '留别', '赠别'] },
  { keys: ['思乡', '乡愁', '故乡'], extras: ['故乡', '故园', '家书', '归乡', '乡愁'] },
  { keys: ['月', '月光', '月亮'], extras: ['月', '明月', '月色', '婵娟'] },
  { keys: ['春天', '春日', '春景'], extras: ['春', '花', '柳', '燕', '东风', '桃', '杏'] },
  { keys: ['秋天', '秋日', '秋景'], extras: ['秋', '霜', '雁', '枫', '梧桐'] },
  { keys: ['边塞', '战争', '征战'], extras: ['塞', '关', '戍', '征', '烽', '沙场'] },
  { keys: ['山水', '田园', '自然'], extras: ['山', '水', '江', '河', '川', '峰', '溪'] },
  { keys: ['酒', '饮酒', '醉'], extras: ['酒', '醉', '杯', '樽', '酌'] },
]

export function analyzeQuery(raw: string): QueryPlan {
  const original = String(raw ?? '').trim()
  const lower = original.toLowerCase().normalize('NFKC')

  // 「含月」「带有‘月’」→ 结果必须真正包含这个字词
  const literalMusts: string[] = []
  const quotedMust = /[含带](?:有|着)?\s*[「“"']([\u3400-\u9fff]{1,4})[」”"']/g
  const bareMust = /[含带](?:有|着)?\s*([\u3400-\u9fff])/g
  let mustMatch: RegExpExecArray | null
  while ((mustMatch = quotedMust.exec(lower))) {
    if (!literalMusts.includes(mustMatch[1])) literalMusts.push(mustMatch[1])
  }
  while ((mustMatch = bareMust.exec(lower))) {
    const ch = mustMatch[1]
    if (ch && !'有了着之'.includes(ch) && !literalMusts.includes(ch)) literalMusts.push(ch)
  }

  // 1) 去标点，保留汉字 / 字母 / 数字 / 空格
  let cleaned = lower.replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')

  // 2) 去提问框架词（长词优先）
  for (const p of REQUEST_PATTERNS) {
    if (cleaned.includes(p)) cleaned = cleaned.split(p).join(' ')
  }

  // 3) 去常见虚词（只处理单字颗粒，不影响专名用字的主体）
  cleaned = cleaned.replace(/[的了吗呢吧和与跟及或者啊呀哦嗯]/g, ' ').replace(/\s+/g, ' ').trim()

  // 4) 词项：整段 / bigram / 单字
  const cjkRuns = (cleaned.match(/[\u3400-\u9fff]+/g) ?? []).filter(Boolean)
  const ascii = unique((cleaned.match(/[a-z]+/g) ?? []).filter((s) => s.length >= 2))
  const terms = new Map<string, WeightedTerm>()

  const addTerm = (text: string, weight: number, kind: WeightedTerm['kind']) => {
    const t = text.trim()
    if (!t) return
    const prev = terms.get(t)
    if (!prev || prev.weight < weight) terms.set(t, { text: t, weight, kind })
  }

  for (const run of cjkRuns) {
    if (run.length >= 2) {
      addTerm(run, 3.2, 'phrase')
      for (let i = 0; i < run.length - 1; i += 1) {
        addTerm(run.slice(i, i + 2), 2, 'bigram')
      }
    } else {
      addTerm(run, 1, 'char')
    }
  }

  // 5) 主题映射与同义扩展
  const themes = new Set<string>()
  for (const rule of THEME_RULES) {
    if (rule.keys.some((k) => original.includes(k))) {
      rule.themes.forEach((t) => themes.add(t))
      rule.hints.forEach((h) => addTerm(h, h.length === 1 ? 0.8 : 1.15, 'hint'))
    }
  }
  for (const exp of TOPIC_EXPANSIONS) {
    if (exp.keys.some((k) => original.includes(k))) {
      exp.extras.forEach((x) => addTerm(x, x.length === 1 ? 0.9 : 1.5, 'extra'))
    }
  }

  // 6) 类型意图
  const typeBoost: Partial<Record<EntryType, number>> = {}
  for (const hint of TYPE_HINTS) {
    if (hint.words.some((w) => original.includes(w))) {
      typeBoost[hint.type] = Math.max(typeBoost[hint.type] ?? 0, TYPE_BOOST[hint.type])
    }
  }

  const compare = /差异|区别|比较|对比|异同|不同/.test(original)
  const needsSynthesis = compare || /风格|赏析|鉴赏|评价|分析|为什么|如何理解|怎么看|妙处|艺术特色/.test(original)

  return {
    raw: original,
    cleaned,
    queryCompact: cjkRuns.join(''),
    literalMusts,
    terms: [...terms.values()],
    ascii,
    pinyinCompact: ascii.join(''),
    themes: [...themes],
    typeBoost,
    compare,
    needsSynthesis,
  }
}

/* ------------------------------------------------------------------ */
/* 三路召回                                                            */
/* ------------------------------------------------------------------ */

function makeLineHit(line: PoemLine, score: number, reasons: string[]): Hit {
  const workTitle = line.title
  const meta = [workTitle ? `《${workTitle}》` : '', line.author || '', line.dynasty || '']
    .filter(Boolean)
    .join(' · ')
  return {
    key: `line:${line.poemId}:${line.line}`,
    kind: 'line',
    score: Math.min(100, Math.round(score)),
    primary: line.line,
    secondary: meta,
    snippet: `诗句：「${line.line}」——${meta}`,
    source: meta,
    route: toSiteRoute(line.srcPath),
    workTitle,
    author: line.author,
    matched: unique(reasons).slice(0, 2).join(' · ') || '本地检索',
    poemId: line.poemId,
  }
}

function makeQuoteHit(quote: QuoteEntry, score: number, reasons: string[]): Hit {
  const sourceBits = [
    quote.author,
    quote._workTitle ? `《${quote._workTitle}》` : '',
    quote.citation || '',
    quote.dynasty || '',
  ].filter(Boolean)
  const source = unique(sourceBits).join(' · ')
  return {
    key: `quote:${quote.id}`,
    kind: 'quote',
    type: 'quote',
    score: Math.min(100, Math.round(score)),
    primary: quote.text,
    secondary: source,
    snippet: `名句：「${quote.text}」——${source || '站内名句'}${
      quote.theme.length ? `；主题：${quote.theme.join('、')}` : ''
    }`,
    source: source || '站内名句',
    route: toSiteRoute(quote.srcPath),
    workTitle: quote._workTitle || quote.citation || quote.text.slice(0, 18),
    author: quote.author,
    matched: unique(reasons).slice(0, 2).join(' · ') || '本地检索',
  }
}

function makeEntryHit(entry: SearchEntry, score: number, reasons: string[]): Hit {
  const type = entry.type
  const primary =
    type === 'poem'
      ? `《${entry.title}》`
      : type === 'idiom'
        ? entry.title
        : type === 'quote'
          ? entry.title
          : type === 'imagery'
            ? `意象「${entry.title}」`
            : entry.title
  const secondary = [TYPE_LABEL[type], entry.subtitle, entry.excerpt ? entry.excerpt.slice(0, 64) : '']
    .filter(Boolean)
    .join(' · ')
  return {
    key: `entry:${entry.type}:${entry.id}`,
    kind: 'entry',
    type,
    score: Math.min(100, Math.round(score)),
    primary,
    secondary,
    snippet: `${TYPE_LABEL[type]}：${primary}${entry.excerpt ? `｜${entry.excerpt}` : ''}${
      entry.subtitle ? `｜${entry.subtitle}` : ''
    }`,
    source: [TYPE_LABEL[type], entry.subtitle].filter(Boolean).join(' · '),
    route: toSiteRoute(entry.srcPath),
    workTitle: entry.title,
    author: type === 'author' ? entry.title : '',
    matched: unique(reasons).slice(0, 2).join(' · ') || '本地检索',
  }
}

export function retrieve(plan: QueryPlan, corpus: Corpus): RagResult {
  // 拼音通道反查作者：libai / lb → 李白，从而召回其诗句与作品
  const pinyinAuthors = new Set<string>()
  if (plan.ascii.length) {
    for (const e of corpus.entries) {
      if (e.type !== 'author') continue
      if (
        plan.ascii.some(
          (tok) =>
            e._pinyin === tok ||
            e._pinyin.startsWith(tok) ||
            e._pinyin.includes(tok) ||
            e._pinyinFirst.startsWith(tok),
        )
      ) {
        pinyinAuthors.add(normText(e.title))
      }
    }
  }

  // ---------- 1) 诗句召回 ----------
  let lineTotal = 0
  const lineHits: Hit[] = []
  for (const line of corpus.lines) {
    if (plan.literalMusts.length && !plan.literalMusts.some((m) => hasLiteral(line._line, m))) continue
    let score = 0
    const reasons: string[] = []
    const poem = line._poem

    for (const t of plan.terms) {
      if (line._line.includes(t.text)) {
        score += 6 * t.weight
        reasons.push('诗句')
      }
      if (line._title.includes(t.text)) {
        // 单字扩展词（如「送」）只作弱信号，避免《乡村四月》仅凭题面「月」压过真正写月的诗
        score += (t.text.length >= 2 ? 8 : 3) * t.weight
        reasons.push('篇名')
      }
      if (line._author.includes(t.text)) {
        score += 8 * t.weight
        reasons.push('作者')
      }
      if (t.text.length >= 2 && line._dynasty.includes(t.text)) score += 2 * t.weight
      if (poem?._tokens.includes(t.text)) score += 2 * t.weight
      if (poem?._subtitle.includes(t.text)) score += 3 * t.weight
    }

    // 作品语义标签：命中一个主题直接加分（最多两个主题）
    let themeHits = 0
    for (const theme of plan.themes) {
      const aliases = THEME_TOKENS[theme] ?? [theme]
      if (aliases.some((a) => poem?._tokens.includes(a))) {
        score += 24
        reasons.push(`主题·${theme}`)
        themeHits += 1
        if (themeHits >= 2) break
      }
    }

    if (pinyinAuthors.has(line._author)) {
      score += 22
      reasons.push('作者拼音')
    }

    for (const tok of plan.ascii) {
      if (line._line.includes(tok) || line._title.includes(tok)) score += 12
      if (poem?._pinyin.includes(tok)) {
        score += 22
        reasons.push('全拼')
      } else if (poem?._pinyinFirst.startsWith(tok)) {
        score += 18
        reasons.push('首字母')
      }
      if (line._authorEntry?._pinyin.includes(tok) || line._authorEntry?._pinyinFirst.startsWith(tok)) {
        score += 16
        reasons.push('作者拼音')
      }
    }

    if (plan.queryCompact.length >= 2 && line._line.includes(plan.queryCompact)) {
      score += 24
      reasons.unshift('原句')
    }

    // 「月」是意象还是日期？明月/月光/月夜等真实月色再加一档
    if (plan.terms.some((t) => t.text === '月' || t.text === '明月') && isMoonPhrase(line._line)) {
      score += 10
      reasons.push('月色')
    }

    for (const t of plan.terms) {
      if (t.text.length !== 1) continue
      const n = countOccurrences(line._line, t.text)
      if (n > 1) score += Math.min(6, (n - 1) * 2)
    }

    if (score >= 5) {
      lineTotal += 1
      lineHits.push(makeLineHit(line, score, reasons))
    }
  }
  lineHits.sort((a, b) => b.score - a.score || a.primary.localeCompare(b.primary, 'zh'))
  const strongLineHits = cutByRelative(lineHits, 6, 0.3)
  lineTotal = strongLineHits.length

  // 同一首诗最多两联，避免整页被一首长诗占满
  const pickedLines: Hit[] = []
  const perPoem = new Map<string, number>()
  for (const hit of strongLineHits) {
    const key = hit.poemId ?? hit.key
    const n = perPoem.get(key) ?? 0
    if (n >= 2) continue
    perPoem.set(key, n + 1)
    pickedLines.push(hit)
    if (pickedLines.length >= 10) break
  }

  // ---------- 2) 名句召回 ----------
  let quoteTotal = 0
  const quoteHits: Hit[] = []
  for (const quote of corpus.quotes) {
    if (plan.literalMusts.length && !plan.literalMusts.some((m) => hasLiteral(quote._text, m))) continue
    let score = 0
    const reasons: string[] = []
    const entry = quote._entry

    for (const t of plan.terms) {
      if (quote._text.includes(t.text)) {
        score += 7 * t.weight
        reasons.push('原文')
      }
      if (quote._author.includes(t.text)) {
        score += 6 * t.weight
        reasons.push('作者')
      }
      if (quote._citation.includes(t.text)) {
        score += 6 * t.weight
        reasons.push('出处')
      }
      if (quote._theme.some((th) => th.includes(t.text) || t.text.includes(th))) {
        score += 5 * t.weight
        reasons.push('主题')
      }
      if (quote._tags.some((tag) => tag.includes(t.text))) score += 3 * t.weight
      if (entry?._tokens.includes(t.text)) score += 4 * t.weight
      if (entry?._title.includes(t.text)) score += 5 * t.weight
    }

    if (plan.queryCompact.length >= 2 && quote._text.includes(plan.queryCompact)) {
      score += 30
      reasons.unshift('原句')
    }
    if (plan.terms.some((t) => t.text === '月' || t.text === '明月') && isMoonPhrase(quote._text)) {
      score += 10
      reasons.push('月色')
    }
    for (const theme of plan.themes) {
      if (quote._theme.includes(theme)) {
        score += 26
        reasons.push(`主题·${theme}`)
      }
    }
    for (const tok of plan.ascii) {
      if (quote._text.includes(tok) || quote._author.includes(tok) || quote._citation.includes(tok)) {
        score += 8
      }
      if (entry?._pinyin.includes(tok) || entry?._pinyinFirst.startsWith(tok)) {
        score += 18
        reasons.push('拼音')
      }
    }
    if (pinyinAuthors.has(normText(quote.author))) {
      score += 22
      reasons.push('作者拼音')
    }
    // 类型意图只放大已有内容命中，不能把全库同类条目都拉进来
    if (score > 0 && plan.typeBoost.quote) score += plan.typeBoost.quote

    if (score >= 6) {
      quoteTotal += 1
      quoteHits.push(makeQuoteHit(quote, score, reasons))
    }
  }
  quoteHits.sort((a, b) => b.score - a.score || a.primary.localeCompare(b.primary, 'zh'))
  const strongQuoteHits = cutByRelative(quoteHits, 6, 0.25)
  quoteTotal = strongQuoteHits.length
  const pickedQuotes = strongQuoteHits.slice(0, 8)

  // ---------- 3) 条目召回 ----------
  const quoteHitKeys = new Set(pickedQuotes.map((h) => h.key))
  let entryTotal = 0
  const entryHits: Hit[] = []
  for (const entry of corpus.entries) {
    // 名句已独立成组，避免同一句在「条目命中」里重复出现
    if (entry.type === 'quote' && quoteHitKeys.has(`entry:quote:${entry.id}`)) continue
    if (
      plan.literalMusts.length &&
      !plan.literalMusts.some(
        (m) => hasLiteral(entry._title, m) || hasLiteral(entry._excerpt, m) || entry._tokens.includes(m),
      )
    ) {
      continue
    }

    let score = 0
    const reasons: string[] = []
    const exactPhrase = plan.terms.some((t) => t.kind === 'phrase' && t.text === entry._title)

    if (plan.queryCompact && entry._title === plan.queryCompact) {
      score += 80
      reasons.push('标题精确')
    } else if (exactPhrase) {
      score += 70
      reasons.push('标题精确')
    } else if (plan.queryCompact.length >= 2 && entry._title.includes(plan.queryCompact)) {
      score += 32
      reasons.push('标题包含')
    }

    for (const t of plan.terms) {
      if (entry._title.includes(t.text)) {
        score += (t.text.length >= 2 ? 8 : 4) * t.weight
        reasons.push('标题')
      }
      if (entry._tokens.includes(t.text)) {
        score += 7 * t.weight
        reasons.push('分词')
      } else if (t.text.length >= 2 && entry._tokens.some((x) => x.includes(t.text))) {
        score += 3 * t.weight
        reasons.push('分词')
      }
      if (entry._subtitle.includes(t.text)) score += 4 * t.weight
      if (entry._excerpt.includes(t.text)) score += 3 * t.weight
    }

    for (const theme of plan.themes) {
      const aliases = THEME_TOKENS[theme] ?? [theme]
      if (aliases.some((a) => entry._tokens.includes(a)) || entry._subtitle.includes(theme)) {
        score += 16
        reasons.push(`主题·${theme}`)
        break
      }
    }

    if (plan.ascii.length) {
      for (const tok of plan.ascii) {
        if (entry._pinyin === tok) {
          score += 34
          reasons.push('全拼')
        } else if (entry._pinyin.startsWith(tok)) {
          score += 30
          reasons.push('全拼')
        } else if (entry._pinyin.includes(tok)) {
          score += 24
          reasons.push('全拼')
        }
        if (entry._pinyinFirst.startsWith(tok)) {
          score += 22
          reasons.push('首字母')
        }
        if (entry._title.includes(tok) || entry._subtitle.includes(tok)) score += 12
      }
      if (pinyinAuthors.has(normText(entry.title)) || pinyinAuthors.has(entry._subtitle)) {
        score += 18
        reasons.push('作者拼音')
      }
      if (pinyinAuthors.size && entry._tokens.some((t) => pinyinAuthors.has(t))) {
        score += 20
        reasons.push('作者拼音')
      }
    }

    // 同上：只有内容本身命中时，类型意图才加分
    if (score > 0 && plan.typeBoost[entry.type]) score += plan.typeBoost[entry.type] as number

    if (score >= 8) {
      entryTotal += 1
      entryHits.push(makeEntryHit(entry, score, reasons))
    }
  }
  entryHits.sort((a, b) => b.score - a.score || a.primary.localeCompare(b.primary, 'zh'))

  const strongEntries = cutByRelative(entryHits, 8, 0.25)
  entryTotal = strongEntries.length
  const pickedEntries = strongEntries.slice(0, 12)
  const all = [...pickedLines, ...pickedQuotes, ...pickedEntries].sort((a, b) => b.score - a.score)
  all.slice(0, 8).forEach((hit, i) => {
    hit.ref = i + 1
  })

  return {
    lines: pickedLines,
    quotes: pickedQuotes,
    entries: pickedEntries,
    all,
    totals: { lines: lineTotal, quotes: quoteTotal, entries: entryTotal },
  }
}

/* ------------------------------------------------------------------ */
/* 生成式回答                                                          */
/* ------------------------------------------------------------------ */

export const SYSTEM_PROMPT = `你是「万卷」中小学文学知识库的馆藏问答助手。请严格遵守：
1. 只依据用户提供的【资料】回答，不得使用资料之外的知识；不得编造诗句、作者、篇名、典故或出处。
2. 引用资料时，在相应句子末尾标注编号，如 [1]、[2][3]。
3. 回答末尾另起一行，以「参考：」开头，列出实际引用的编号与篇名/作者，例如：参考：[1]《静夜思》·李白。
4. 如果资料不足以回答（例如需要跨作品比较风格、鉴赏推断），请直接说「现有资料不足以回答」，并简述资料能覆盖的范围；不要凭常识补充。
5. 用简洁的现代汉语回答，引用原文时使用「」。不要使用 Markdown 语法、表格或代码块。`

export function buildUserPrompt(question: string, hits: Hit[]): string {
  const lines = hits.map((hit, i) => {
    return `[${i + 1}] ${hit.snippet}\n    出处：${hit.source || '站内条目'}（${hit.route}）`
  })
  return `【资料】\n${lines.join('\n')}\n\n【问题】\n${question}\n\n请严格依据【资料】回答；资料不足时请直接说明。`
}

export function citationsFromHits(hits: Hit[]): Citation[] {
  return hits.map((hit, i) => ({
    n: i + 1,
    kind: hit.kind,
    type: hit.type,
    title:
      hit.kind === 'entry'
        ? hit.workTitle
        : hit.workTitle || hit.primary.slice(0, 20),
    author: hit.author,
    kicker: hit.kind === 'line' ? '诗句' : hit.kind === 'quote' ? '名句' : TYPE_LABEL[hit.type ?? 'poem'],
    snippet:
      hit.kind === 'entry'
        ? hit.secondary
        : `「${hit.primary.length > 42 ? `${hit.primary.slice(0, 42)}…` : hit.primary}」`,
    route: hit.route,
  }))
}

export function relevancePercent(score: number): number {
  return Math.max(8, Math.min(99, Math.round(score)))
}

/** 相对截断：只保留与最高分同量级的结果，避免「送 / 别」这类单字扩展把全库拉进来 */
function cutByRelative<T extends { score: number }>(items: T[], minAbs: number, ratio: number): T[] {
  if (!items.length) return items
  const floor = Math.max(minAbs, items[0].score * ratio)
  return items.filter((item) => item.score >= floor)
}

/* ------------------------------------------------------------------ */
/* Ollama 本机连接                                                     */
/* ------------------------------------------------------------------ */

export interface OllamaProbe {
  ok: boolean
  root: string
  models: string[]
  error: string
}

export function normalizeOllamaBase(raw: string): string {
  let base = String(raw ?? '').trim()
  if (!base) return ''
  base = base.replace(/\/+$/g, '')
  while (/\/(v1|api)$/i.test(base)) base = base.replace(/\/(v1|api)$/i, '')
  return base.replace(/\/+$/g, '')
}

/** 只允许本机回环地址：保证「不请求外部网络」的承诺 */
export function validateOllamaBase(raw: string): string {
  const base = normalizeOllamaBase(raw)
  if (!base) return '请填写 Ollama 地址，例如 http://localhost:11434'
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return '地址格式无效，例如 http://localhost:11434'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '仅支持 http:// 或 https:// 地址'
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
  if (!local) return '为保护隐私，仅支持本机地址（localhost / 127.0.0.1 / ::1）'
  if (url.username || url.password) return '地址中不要包含账号或密码'
  return ''
}

export function describeOllamaError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (err instanceof DOMException && err.name === 'AbortError') return '请求超时或已取消'
  if (/AbortError|The operation was aborted/i.test(msg)) return '请求超时或已取消'
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|Network request failed|ERR_/i.test(msg)) {
    const httpsPage = typeof location !== 'undefined' && location.protocol === 'https:'
    return httpsPage
      ? '无法连接本机服务（Ollama 未启动，或 HTTPS 页面拦截了 HTTP 请求 / 浏览器 CORS 限制）'
      : '无法连接本机服务（请确认 Ollama 已启动、地址与端口正确；也可能是浏览器 CORS 限制）'
  }
  return msg || '未知错误'
}

export async function probeOllama(rawBase: string, timeoutMs = 5000): Promise<OllamaProbe> {
  const root = normalizeOllamaBase(rawBase)
  const invalid = validateOllamaBase(rawBase)
  if (invalid) return { ok: false, root, models: [], error: invalid }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${root}/api/tags`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json().catch(() => null)
    const models = (Array.isArray(data?.models) ? data.models : [])
      .map((m: Record<string, unknown>) => String(m?.name ?? m?.model ?? ''))
      .filter(Boolean)
    return { ok: true, root, models, error: '' }
  } catch (err) {
    return { ok: false, root, models: [], error: describeOllamaError(err) }
  } finally {
    clearTimeout(timer)
  }
}

interface OllamaChatOptions {
  base: string
  model: string
  messages: ChatDeltaMessage[]
  signal?: AbortSignal
  temperature?: number
  onDelta?: (text: string) => void
}

function extractDelta(data: any): string {
  const choice = data?.choices?.[0]
  const value =
    choice?.delta?.content ??
    choice?.message?.content ??
    data?.message?.content ??
    data?.response ??
    ''
  return typeof value === 'string' ? value : ''
}

function extractError(data: any): string {
  const e = data?.error
  if (!e) return ''
  if (typeof e === 'string') return e
  return String(e.message ?? e.detail ?? JSON.stringify(e))
}

async function readStream(
  res: Response,
  onDelta: ((text: string) => void) | undefined,
  mode: 'sse' | 'ndjson',
): Promise<string> {
  if (!res.body) throw new Error('当前浏览器不支持流式读取响应')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let full = ''

  const consume = (raw: string) => {
    let payload = raw.trim()
    if (!payload) return
    if (mode === 'sse') {
      if (!payload.startsWith('data:')) return
      payload = payload.slice(5).trim()
    }
    if (!payload || payload === '[DONE]') return
    let json: any
    try {
      json = JSON.parse(payload)
    } catch {
      return
    }
    const error = extractError(json)
    if (error) throw new Error(error)
    const piece = extractDelta(json)
    if (piece) {
      full += piece
      onDelta?.(piece)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n')
    while (idx >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '')
      buffer = buffer.slice(idx + 1)
      consume(line)
      idx = buffer.indexOf('\n')
    }
  }
  buffer += decoder.decode()
  if (buffer.trim()) consume(buffer)
  if (!full.trim()) throw new Error('模型没有返回任何内容')
  return full
}

/**
 * OpenAI 兼容接口：POST {root}/v1/chat/completions，stream=true。
 * 同时兼容少数实现返回 application/x-ndjson 或普通 JSON 的情况。
 */
export async function streamOllamaChat(opts: OllamaChatOptions): Promise<string> {
  const root = normalizeOllamaBase(opts.base)
  const invalid = validateOllamaBase(opts.base)
  if (invalid) throw new Error(invalid)
  const model = String(opts.model ?? '').trim()
  if (!model) throw new Error('请先填写模型名，例如 qwen2.5:7b')

  const res = await fetch(`${root}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json, application/x-ndjson',
    },
    body: JSON.stringify({
      model,
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature ?? 0.2,
      max_tokens: 1200,
    }),
    signal: opts.signal,
  })

  if (!res.ok) {
    let detail = ''
    try {
      const text = await res.text()
      try {
        const json = JSON.parse(text)
        detail = extractError(json) || text
      } catch {
        detail = text
      }
    } catch {
      /* ignore */
    }
    detail = detail.replace(/\s+/g, ' ').slice(0, 220)
    throw new Error(`HTTP ${res.status}${detail ? ` · ${detail}` : ''}`)
  }

  const ctype = (res.headers.get('content-type') || '').toLowerCase()
  if (ctype.includes('text/event-stream')) return readStream(res, opts.onDelta, 'sse')
  if (ctype.includes('ndjson') || ctype.includes('jsonl')) return readStream(res, opts.onDelta, 'ndjson')

  // 服务端忽略了 stream:true，按普通 JSON 处理
  const data = await res.json().catch(() => null)
  const error = extractError(data)
  if (error) throw new Error(error)
  const content = extractDelta(data)
  if (!content.trim()) throw new Error('模型返回为空')
  opts.onDelta?.(content)
  return content
}