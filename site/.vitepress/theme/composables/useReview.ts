/**
 * 万卷 · 复习系统核心（P1）
 *
 * 职责：
 *   1. 卡片模型：从构建索引（/indexes/*.json）生成三种卡片
 *      - 默写卡 recite：作品原文挖空下句（给上句默下句）
 *      - 释义卡 meaning：成语 → 释义四选一
 *      - 溯源卡 origin：名句 → 出处四选一
 *      生成卡片时内嵌题面/答案/选项（选项干扰项从同索引采样），离线索引版本变化不影响已有卡片。
 *   2. FSRS 调度：ts-fsrs（参数默认）管理每张卡的 {due, stability, difficulty, reps, lapses…}，
 *      持久化到 localStorage（key: wj-review-state，带版本号 v）。
 *   3. 每日一卷：按「日期 + 换卷序号」种子伪随机抽 8 题（默写 3 / 释义 3 / 出处 2），
 *      成绩与错题存 localStorage（key: wj-quiz-history，带版本号 v）；错题自动生成复习卡入队。
 *
 * 全部纯前端；SSR 环境下所有 storage/fetch 访问均有守卫。
 */

import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs'

/* ================================================================
 * 一、类型定义
 * ================================================================ */

/** 卡片类型：默写（作品挖空下句）/ 释义（成语四选一）/ 溯源（名句出处四选一） */
export type WjCardType = 'recite' | 'meaning' | 'origin'

export const CARD_TYPE_LABEL: Record<WjCardType, string> = {
  recite: '默写',
  meaning: '释义',
  origin: '溯源',
}

/** 复习卡（生成时内嵌全部题目数据，不依赖运行时索引） */
export interface WjCard {
  /** `${type}:${entryId}`，如 recite:tang-libai-jingyesi */
  id: string
  type: WjCardType
  /** 来源词条在索引中的 id */
  entryId: string
  /** 来源词条标题（作品名 / 成语 / 名句截断） */
  entryTitle: string
  /** 回源：仓库内源文件路径（content/…） */
  srcPath: string
  /** 题面：默写=上句；释义=成语；溯源=名句 */
  front: string
  /** 答案：默写=下句；释义=正确释义；溯源=出处（作者《篇名》） */
  back: string
  /** 辅助上下文（作者·朝代·体裁等，可空） */
  context?: string
  /** 四选一选项（释义/溯源卡；默写卡为空） */
  options?: string[]
  /** 题面补充（如成语拼音） */
  subfront?: string
  createdAt: number
}

/** 单张卡的 FSRS 调度状态（ts-fsrs Card 的可序列化形态） */
export interface WjFsrsState {
  due: string
  stability: number
  difficulty: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review: string | null
}

/** localStorage: wj-review-state */
export interface WjReviewState {
  v: 1
  cards: Record<string, { card: WjCard; fsrs: WjFsrsState }>
  updatedAt: number
}

/** 评分：1 重来 / 2 困难 / 3 良好 / 4 简单（对应 ts-fsrs Rating） */
export type WjRating = 1 | 2 | 3 | 4

export const RATING_LABEL: Record<WjRating, string> = { 1: '重来', 2: '困难', 3: '良好', 4: '简单' }

/* ---- 索引条目（仅声明用到的字段） ---- */
export interface PoemItem {
  id: string
  title: string
  author?: string
  dynasty?: string
  form?: string
  srcPath: string
}
export interface IdiomItem {
  id: string
  word: string
  pinyin?: string
  meaning: string
  srcPath: string
}
export interface QuoteItem {
  id: string
  text: string
  author?: string
  work?: string | null
  dynasty?: string
  srcPath: string
}
export interface WjIndexes {
  poems: PoemItem[]
  idioms: IdiomItem[]
  quotes: QuoteItem[]
}

/* ---- 每日一卷 / 错题 ---- */
export interface WjQuizQuestion {
  card: WjCard
  mode: 'input' | 'choice'
}

export interface WjMistake {
  /** `${dateKey}:${cardId}`，错题本内唯一 */
  qid: string
  cardId: string
  type: WjCardType
  date: string
  ts: number
  front: string
  subfront?: string
  context?: string
  options?: string[]
  userAnswer: string
  back: string
  entryTitle: string
  srcPath: string
}

export interface WjQuizRecord {
  date: string
  variant: number
  score: number
  total: number
  mistakeCardIds: string[]
  mistakes: WjMistake[]
  ts: number
}

/** localStorage: wj-quiz-history */
export interface WjQuizHistory {
  v: 1
  records: WjQuizRecord[]
  /** 当日「换一卷」序号（同一天同序号=同卷） */
  variant: { date: string; n: number }
}

/* ================================================================
 * 二、localStorage 安全读写（带版本号；QuotaExceeded 不崩溃）
 * ================================================================ */

export const REVIEW_KEY = 'wj-review-state'
export const QUIZ_KEY = 'wj-quiz-history'

export type StoreResult = { ok: true } | { ok: false; message: string }

export function safeSetItem(key: string, value: string): StoreResult {
  try {
    localStorage.setItem(key, value)
    return { ok: true }
  } catch (e: any) {
    const name = e?.name ?? ''
    const code = e?.code ?? 0
    const quota = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014
    return {
      ok: false,
      message: quota
        ? '本地存储空间已满（QuotaExceeded），本次进度未能保存。请清理浏览器站点数据后重试。'
        : `本地存储写入失败（${name || e?.message || '未知原因'}），本次操作未能保存。`,
    }
  }
}

function safeGetJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    // 损坏数据：忽略并重建（不崩溃）
    return null
  }
}

/* ---- 复习状态 ---- */

export function readReviewState(): WjReviewState {
  const s = safeGetJSON<WjReviewState>(REVIEW_KEY)
  if (s && s.v === 1 && s.cards && typeof s.cards === 'object') return s
  return { v: 1, cards: {}, updatedAt: 0 }
}

export function writeReviewState(state: WjReviewState): StoreResult {
  state.updatedAt = Date.now()
  return safeSetItem(REVIEW_KEY, JSON.stringify(state))
}

export function hasCard(cardId: string): boolean {
  return Object.prototype.hasOwnProperty.call(readReviewState().cards, cardId)
}

export function cardCount(): number {
  return Object.keys(readReviewState().cards).length
}

/** 批量加入卡片（新卡立即到期，进入今日队列）；已存在的跳过不动其进度 */
export function addCards(cards: WjCard[], now: Date = new Date()): { result: StoreResult; added: number; skipped: number } {
  const state = readReviewState()
  let added = 0
  let skipped = 0
  for (const card of cards) {
    if (!card || !card.id) continue
    if (state.cards[card.id]) {
      skipped++
      continue
    }
    const empty = createEmptyCard(now)
    state.cards[card.id] = { card, fsrs: fsrsToState(empty) }
    added++
  }
  const result = added > 0 ? writeReviewState(state) : { ok: true as const }
  return { result, added, skipped }
}

export function removeCard(cardId: string): StoreResult {
  const state = readReviewState()
  if (state.cards[cardId]) {
    delete state.cards[cardId]
    return writeReviewState(state)
  }
  return { ok: true }
}

/* ---- 每日一卷历史 ---- */

export function readQuizHistory(): WjQuizHistory {
  const h = safeGetJSON<WjQuizHistory>(QUIZ_KEY)
  if (h && h.v === 1 && Array.isArray(h.records)) {
    if (!h.variant || typeof h.variant.n !== 'number') h.variant = { date: '', n: 0 }
    return h
  }
  return { v: 1, records: [], variant: { date: '', n: 0 } }
}

function writeQuizHistory(h: WjQuizHistory): StoreResult {
  return safeSetItem(QUIZ_KEY, JSON.stringify(h))
}

export function todayVariant(dateKey: string): number {
  const h = readQuizHistory()
  return h.variant.date === dateKey ? h.variant.n : 0
}

export function setVariant(dateKey: string, n: number): StoreResult {
  const h = readQuizHistory()
  h.variant = { date: dateKey, n }
  return writeQuizHistory(h)
}

export function pushQuizRecord(record: WjQuizRecord): StoreResult {
  const h = readQuizHistory()
  // 同一天同序号只留最新一份（重做覆盖）
  h.records = h.records.filter((r) => !(r.date === record.date && r.variant === record.variant))
  h.records.push(record)
  // 只保留最近 60 卷，防止 localStorage 无限膨胀
  if (h.records.length > 60) h.records = h.records.slice(-60)
  return writeQuizHistory(h)
}

/** 错题本数据：全部错题按时间倒序 */
export function allMistakes(): WjMistake[] {
  const h = readQuizHistory()
  const out: WjMistake[] = []
  for (const r of h.records) for (const m of r.mistakes ?? []) out.push(m)
  return out.sort((a, b) => b.ts - a.ts)
}

/** 「已掌握」：从错题本移除某题 */
export function removeMistake(qid: string): StoreResult {
  const h = readQuizHistory()
  for (const r of h.records) {
    const before = r.mistakes.length
    r.mistakes = r.mistakes.filter((m) => m.qid !== qid)
    if (r.mistakes.length !== before) r.score += 1 // 移除错题视作改对，成绩同步
  }
  return writeQuizHistory(h)
}

/* ================================================================
 * 三、FSRS 调度
 * ================================================================ */

const scheduler = fsrs(generatorParameters())

function fsrsToState(c: Card): WjFsrsState {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as number,
    last_review: c.last_review ? c.last_review.toISOString() : null,
  }
}

function stateToFsrs(s: WjFsrsState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as Card['state'],
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  }
}

export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function sameLocalDay(a: Date, b: Date): boolean {
  return localDateKey(a) === localDateKey(b)
}

export interface QueueEntry {
  card: WjCard
  fsrs: WjFsrsState
}

export interface ReviewStats {
  total: number
  dueCount: number
  doneToday: number
}

/** 今日队列：已到期（due ≤ 当前时刻）的卡，按到期先后排序 */
export function todayQueue(now: Date = new Date()): QueueEntry[] {
  const state = readReviewState()
  return Object.values(state.cards)
    .filter((e) => new Date(e.fsrs.due).getTime() <= now.getTime())
    .sort((a, b) => new Date(a.fsrs.due).getTime() - new Date(b.fsrs.due).getTime())
    .map((e) => ({ card: e.card, fsrs: e.fsrs }))
}

/** 概览：总数 / 今日待复习 / 今日已完成（今天评过分且当前未到期） */
export function reviewStats(now: Date = new Date()): ReviewStats {
  const state = readReviewState()
  const entries = Object.values(state.cards)
  let dueCount = 0
  let doneToday = 0
  for (const e of entries) {
    const due = new Date(e.fsrs.due)
    const last = e.fsrs.last_review ? new Date(e.fsrs.last_review) : null
    if (due.getTime() <= now.getTime()) dueCount++
    else if (last && sameLocalDay(last, now)) doneToday++
  }
  return { total: entries.length, dueCount, doneToday }
}

/** 评分：ts-fsrs 调度并持久化。返回新的调度状态（含下次到期时间）。 */
export function rateCard(
  cardId: string,
  rating: WjRating,
  now: Date = new Date(),
): { result: StoreResult; next?: WjFsrsState } {
  const state = readReviewState()
  const entry = state.cards[cardId]
  if (!entry) return { result: { ok: false, message: '卡片不存在或已被移除。' } }
  const { card } = scheduler.next(stateToFsrs(entry.fsrs), now, rating as Grade)
  entry.fsrs = fsrsToState(card)
  const result = writeReviewState(state)
  return { result, next: entry.fsrs }
}

/** 四档按钮的间隔预览（如「重来 ≈ 1 分钟」） */
export function previewIntervals(
  cardId: string,
  now: Date = new Date(),
): Record<WjRating, string> | null {
  const entry = readReviewState().cards[cardId]
  if (!entry) return null
  const preview = scheduler.repeat(stateToFsrs(entry.fsrs), now)
  const out = {} as Record<WjRating, string>
  for (const g of [1, 2, 3, 4] as WjRating[]) {
    const item = (preview as any)[g]
    out[g] = humanInterval(new Date(item.card.due).getTime() - now.getTime())
  }
  return out
}

export function humanInterval(ms: number): string {
  const minutes = ms / 60000
  if (minutes < 1) return '稍后'
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} 分钟`
  const hours = minutes / 60
  if (hours < 24) return `${Math.max(1, Math.round(hours))} 小时`
  const days = hours / 24
  if (days < 31) return `${Math.max(1, Math.round(days))} 天`
  return `${Math.max(1, Math.round(days / 30))} 个月`
}

/* ================================================================
 * 四、索引与作品原文加载
 * ================================================================ */

const INDEX_BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/')

let indexesPromise: Promise<WjIndexes> | null = null

/** 加载构建索引（poems/idioms/quotes），模块级缓存 */
export function loadWjIndexes(): Promise<WjIndexes> {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const get = async (name: string): Promise<any[]> => {
        const res = await fetch(`${INDEX_BASE}indexes/${name}.json`)
        if (!res.ok) throw new Error(`索引加载失败：indexes/${name}.json（HTTP ${res.status}）`)
        const data = await res.json()
        return Array.isArray(data?.items) ? data.items : []
      }
      const [poems, idioms, quotes] = await Promise.all([get('poems'), get('idioms'), get('quotes')])
      return { poems, idioms, quotes } as WjIndexes
    })().catch((e) => {
      indexesPromise = null // 失败允许重试
      throw e
    })
  }
  return indexesPromise
}

/**
 * 作品简介正文（用于默写卡）：构建索引不含正文，且 VitePress 会把 srcDir 内
 * `.md` 一律编译为页面模块（?raw 查询无效），故改为运行时 fetch 词条页 HTML，
 * 用 DOMParser 提取「## 原文」区块的段落文本（同源请求，dev/preview/build 均可用）。
 */
const poemBodyCache = new Map<string, string>()

async function fetchPoemBody(srcPath: string): Promise<string> {
  if (poemBodyCache.has(srcPath)) return poemBodyCache.get(srcPath) ?? ''
  if (typeof window === 'undefined') return ''
  try {
    const res = await fetch(hrefFromSrcPath(srcPath))
    if (!res.ok) return ''
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html')
    const main = doc.querySelector('.vp-doc') ?? doc
    const h2 =
      main.querySelector('h2#原文') ??
      Array.from(main.querySelectorAll('h2')).find((h) => (h.textContent ?? '').trim() === '原文')
    if (!h2) return ''
    let text = ''
    let node = h2.nextElementSibling
    while (node && node.tagName !== 'H2') {
      if (node.tagName === 'P' && !node.querySelector('table')) text += (node as HTMLElement).textContent ?? ''
      node = node.nextElementSibling
    }
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean) poemBodyCache.set(srcPath, clean)
    return clean
  } catch {
    return ''
  }
}

/** 按需取一批作品的《原文》正文：srcPath → 正文（取不到的键不存在） */
export async function loadPoemBodies(srcPaths: string[]): Promise<Map<string, string>> {
  await Promise.all(srcPaths.map((p) => fetchPoemBody(p)))
  return poemBodyCache
}

/* ================================================================
 * 五、伪随机（种子 = 日期 + 换卷序号 → 同一天同卷）
 * ================================================================ */

export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 从候选集采样 n 个不重复元素（seeded） */
export function sampleFrom<T>(pool: T[], n: number, rand: () => number): T[] {
  return seededShuffle(pool, rand).slice(0, n)
}

/* ================================================================
 * 六、卡片生成（索引 → 卡片，选项内嵌）
 * ================================================================ */

export interface Couplet {
  first: string
  second: string
}

/** 原文 → 相邻句对（句内按标点切分，取相邻两联） */
export function buildCouplets(text: string): Couplet[] {
  const out: Couplet[] = []
  const valid = (c: string) => c.length >= 2 && c.length <= 24
  for (const sentence of text.split(/[。！？；!?;…]/)) {
    const clauses = sentence.split(/[，、：,:]/).map((c) => c.trim())
    for (let i = 0; i + 1 < clauses.length; i++) {
      if (valid(clauses[i]) && valid(clauses[i + 1])) out.push({ first: clauses[i], second: clauses[i + 1] })
    }
  }
  return out
}

/** 稳定取一对（同一条目永远同一对，进度可复现） */
export function pickCouplet(couplets: Couplet[], key: string): Couplet | null {
  if (!couplets.length) return null
  return couplets[hashString(key) % couplets.length]
}

/** 名句 text（如「不识庐山真面目，只缘身在此山中」）→ 句对 */
export function quoteCouplet(text: string): Couplet | null {
  const c = buildCouplets(text)
  return c.length ? c[0] : null
}

function hrefFromSrcPath(srcPath: string): string {
  const url = srcPath.replace(/^content\//, '').replace(/\.md$/, '.html')
  return '/' + encodeURI(url)
}

/** 词条页链接（content/**.md → 站点路由） */
export function entryHref(card: Pick<WjCard, 'srcPath'>): string {
  try {
    return hrefFromSrcPath(card.srcPath)
  } catch {
    return '/'
  }
}

/* ---- 默写卡（作品） ---- */

export function reciteCardFromPoem(
  poem: PoemItem,
  body: string | undefined,
  coupletKeySuffix = '',
): WjCard | null {
  const couplets = buildCouplets(body ?? '')
  const couplet = pickCouplet(couplets, poem.id + coupletKeySuffix)
  if (!couplet) return null
  const context = [poem.dynasty, poem.author, poem.form].filter(Boolean).join(' · ')
  return {
    id: `recite:${poem.id}`,
    type: 'recite',
    entryId: poem.id,
    entryTitle: `《${poem.title}》`,
    srcPath: poem.srcPath,
    front: couplet.first,
    back: couplet.second,
    context,
    createdAt: Date.now(),
  }
}

/** 名句也可生成默写卡（quiz 错题入队用），id 与溯源卡区分开 */
export function reciteCardFromQuote(quote: QuoteItem): WjCard | null {
  const couplet = quoteCouplet(quote.text)
  if (!couplet) return null
  return {
    id: `recite:${quote.id}`,
    type: 'recite',
    entryId: quote.id,
    entryTitle: quote.text,
    srcPath: quote.srcPath,
    front: couplet.first,
    back: couplet.second,
    context: [quote.dynasty, quote.author].filter(Boolean).join(' · '),
    createdAt: Date.now(),
  }
}

/* ---- 释义卡（成语） ---- */

export function meaningCardFromIdiom(idiom: IdiomItem, distractors: string[]): WjCard {
  return {
    id: `meaning:${idiom.id}`,
    type: 'meaning',
    entryId: idiom.id,
    entryTitle: idiom.word,
    srcPath: idiom.srcPath,
    front: idiom.word,
    subfront: idiom.pinyin,
    back: idiom.meaning,
    options: [idiom.meaning, ...distractors.filter((d) => d && d !== idiom.meaning).slice(0, 3)],
    createdAt: Date.now(),
  }
}

/* ---- 溯源卡（名句） ---- */

/** 名句出处标签：作者《篇名》（work 为本库作品 id，查 poems 索引回题名；无则 朝代·作者） */
export function quoteOriginLabel(quote: QuoteItem, poems: PoemItem[]): string {
  if (quote.work) {
    const poem = poems.find((p) => p.id === quote.work)
    if (poem) return `${quote.author ?? '佚名'}《${poem.title}》`
  }
  const author = quote.author ?? '佚名'
  return quote.dynasty ? `${quote.dynasty} · ${author}` : author
}

export function originCardFromQuote(quote: QuoteItem, poems: PoemItem[], distractors: string[]): WjCard {
  const back = quoteOriginLabel(quote, poems)
  return {
    id: `origin:${quote.id}`,
    type: 'origin',
    entryId: quote.id,
    entryTitle: quote.text,
    srcPath: quote.srcPath,
    front: quote.text,
    subfront: quote.author,
    back,
    options: [back, ...distractors.filter((d) => d && d !== back).slice(0, 3)],
    createdAt: Date.now(),
  }
}

/* ================================================================
 * 七、词条页「加入复习」（EntryMeta 调用；frontmatter 即数据源）
 * ================================================================ */

export interface EntryReviewInput {
  kind: 'poem' | 'idiom' | 'quote'
  /** 页面 relativePath == srcPath（srcDir 指向仓库根） */
  srcPath: string
  fm: Record<string, any>
}

export interface AddEntryResult {
  result: StoreResult
  added: number
  skipped: number
  cardIds: string[]
}

export async function addEntryToReview(input: EntryReviewInput): Promise<AddEntryResult> {
  const { kind, fm, srcPath } = input
  const empty: AddEntryResult = { result: { ok: true }, added: 0, skipped: 0, cardIds: [] }

  if (!srcPath) return empty

  if (kind === 'poem') {
    const body = await fetchPoemBody(srcPath)
    const card = reciteCardFromPoem(
      { id: fm.id ?? srcPath, title: fm.title ?? '未题名作品', author: fm.author, dynasty: fm.dynasty, form: fm.form, srcPath },
      body,
    )
    if (!card) return { ...empty, result: { ok: false, message: '未能在《原文》区块解析出可用句对，暂不支持加入复习。' } }
    const r = addCards([card])
    return { ...r, cardIds: r.added ? [card.id] : [] }
  }

  if (kind === 'idiom') {
    if (!fm.word || !fm.meaning) return empty
    const { idioms } = await loadWjIndexes()
    const others = idioms.filter((x) => x.word !== fm.word && x.meaning && x.meaning !== fm.meaning)
    const distractors = sampleFrom(others, 3, Math.random).map((x) => x.meaning)
    const card = meaningCardFromIdiom(
      { id: fm.id ?? srcPath, word: fm.word, pinyin: fm.pinyin, meaning: fm.meaning, srcPath },
      distractors,
    )
    const r = addCards([card])
    return { ...r, cardIds: r.added ? [card.id] : [] }
  }

  if (kind === 'quote') {
    if (!fm.text) return empty
    const { poems, quotes } = await loadWjIndexes()
    const back = quoteOriginLabel({ ...fm, work: fm.work ?? null } as QuoteItem, poems)
    const others = quotes.filter((x) => x.text !== fm.text && quoteOriginLabel(x, poems) !== back)
    const distractors = sampleFrom(others, 3, Math.random).map((x) => quoteOriginLabel(x, poems))
    const card = originCardFromQuote(
      { id: fm.id ?? srcPath, text: fm.text, author: fm.author, work: fm.work ?? null, dynasty: fm.dynasty, srcPath } as QuoteItem,
      poems,
      distractors,
    )
    const r = addCards([card])
    return { ...r, cardIds: r.added ? [card.id] : [] }
  }

  return empty
}

/* ================================================================
 * 八、每日一卷组卷（8 题：默写 3 / 释义 3 / 出处 2）
 * ================================================================ */

export const QUIZ_LAYOUT = { recite: 3, meaning: 3, origin: 2 } as const

export interface DailyQuizPaper {
  date: string
  variant: number
  questions: WjQuizQuestion[]
}

/** 组卷：种子 = `${date}#${variant}`，同一天同序号必得同卷 */
export async function buildDailyQuiz(date: string, variant: number): Promise<DailyQuizPaper> {
  const rand = mulberry32(hashString(`${date}#${variant}`))
  const { poems, idioms, quotes } = await loadWjIndexes()
  const bodies = await loadPoemBodies(poems.map((p) => p.srcPath))

  /* 默写池：作品句对 + 名句句对 */
  const recitePool: WjCard[] = []
  for (const p of poems) {
    const card = reciteCardFromPoem(p, bodies.get(p.srcPath))
    if (card) recitePool.push(card)
  }
  for (const q of quotes) {
    const card = reciteCardFromQuote(q)
    if (card) recitePool.push(card)
  }

  /* 释义池（干扰项 seeded 采样） */
  const meaningPool = idioms.map((x) =>
    meaningCardFromIdiom(
      x,
      sampleFrom(
        idioms.filter((o) => o.id !== x.id && o.meaning !== x.meaning),
        3,
        rand,
      ).map((o) => o.meaning),
    ),
  )

  /* 溯源池 */
  const originLabels = quotes.map((q) => quoteOriginLabel(q, poems))
  const originPool = quotes.map((q) => {
    const label = quoteOriginLabel(q, poems)
    const distractors = sampleFrom(
      originLabels.filter((l) => l !== label),
      3,
      rand,
    )
    return originCardFromQuote(q, poems, distractors)
  })

  const pick = <T extends { id: string }>(pool: T[], n: number): T[] => {
    const chosen = sampleFrom(pool, n, rand)
    // 去重（不同类型池间 id 不冲突；同池内 id 唯一），不足则有多少取多少
    return chosen
  }

  const recite = pick(recitePool, QUIZ_LAYOUT.recite)
  const meaning = pick(meaningPool, QUIZ_LAYOUT.meaning)
  const origin = pick(originPool, QUIZ_LAYOUT.origin)

  const questions: WjQuizQuestion[] = [
    ...recite.map((card) => ({ card, mode: 'input' as const })),
    ...meaning.map((card) => ({ card, mode: 'choice' as const })),
    ...origin.map((card) => ({ card, mode: 'choice' as const })),
  ]

  return { date, variant, questions: seededShuffle(questions, rand) }
}

/* ---- 默写判分：精确匹配，允许全角/半角标点与空白差异 ---- */

export function normalizeAnswer(s: string): string {
  return (s ?? '')
    .normalize('NFKC') // 全角字母数字与标点 → 半角
    .replace(/\s+/g, '')
    .replace(/[，,、。．.．·!！?？;；:：“”"'『』「」（）()《》<>〈〉—\-＿_～~]/g, '')
    .toLowerCase()
}

export function checkReciteAnswer(input: string, answer: string): boolean {
  const a = normalizeAnswer(input)
  const b = normalizeAnswer(answer)
  return b.length > 0 && a === b
}

/** 判断单题作答并回填用户答案文本 */
export function gradeQuestion(q: WjQuizQuestion, userAnswer: string): boolean {
  if (q.mode === 'input') return checkReciteAnswer(userAnswer, q.card.back)
  return userAnswer === q.card.back
}

/** 交卷：错题生成复习卡入队 + 写入历史。返回 {score, mistakes, storeResult} */
export function submitQuiz(paper: DailyQuizPaper, answers: (string | null)[]): {
  score: number
  mistakes: WjMistake[]
  storeResult: StoreResult
  enqueueResult: StoreResult
} {
  const now = new Date()
  const dateKey = paper.date || localDateKey(now)
  const mistakes: WjMistake[] = []
  const wrongCards: WjCard[] = []

  paper.questions.forEach((q, i) => {
    const userAnswer = (answers[i] ?? '').trim()
    const correct = userAnswer !== '' && gradeQuestion(q, userAnswer)
    if (!correct) {
      mistakes.push({
        qid: `${dateKey}:${paper.variant}:${q.card.id}`,
        cardId: q.card.id,
        type: q.card.type,
        date: dateKey,
        ts: now.getTime() + i,
        front: q.card.front,
        subfront: q.card.subfront,
        context: q.card.context,
        options: q.card.options,
        userAnswer: userAnswer === '' ? '（未作答）' : userAnswer,
        back: q.card.back,
        entryTitle: q.card.entryTitle,
        srcPath: q.card.srcPath,
      })
      if (!wrongCards.some((c) => c.id === q.card.id)) wrongCards.push(q.card)
    }
  })

  const score = paper.questions.length - mistakes.length
  const storeResult = pushQuizRecord({
    date: dateKey,
    variant: paper.variant,
    score,
    total: paper.questions.length,
    mistakeCardIds: wrongCards.map((c) => c.id),
    mistakes,
    ts: now.getTime(),
  })

  // 错题自动生成复习卡并入队（与复习系统共用状态存储）
  const enqueue = addCards(wrongCards, now)

  return { score, mistakes, storeResult, enqueueResult: enqueue.result }
}
