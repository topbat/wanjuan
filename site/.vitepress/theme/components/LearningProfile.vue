<script setup lang="ts">
/**
 * 万卷 · 个人文学素养画像
 *
 * 数据源（全部本机 localStorage，SSR 阶段不读取）：
 *   - wj-review-state   复习卡（card.type / entryId / entryTitle / srcPath + fsrs.lapses/due）
 *   - wj-quiz-history   答题记录（date / variant / score / total / mistakes[].qid）
 *   - wj-genre-corrections 题材校对记录（只计入「参与建设」数量）
 * 结构化分母来自 /indexes/poems.json、idioms.json、stats.json。
 *
 * 四维雷达：
 *   朝代覆盖 = 复习卡涉及 poem 的 dynasty 去重 / poems 中 dynasty 去重
 *   体裁覆盖 = 复习卡涉及 poem 的 form 去重 / poems 中 form 去重
 *   意象熟悉 = 复习卡涉及 poem 的 imageryHits 去重 / stats.imageryFreq 意象去重
 *   语义场   = 复习卡涉及 idiom 的 semanticField 去重 / idioms 中语义场去重
 * 全部除零均有保护；无数据时雷达显示 0 并在图下说明，不报错。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { chartPalette, cssVar, onAppearanceChange, onThemeChange } from '../composables/useWjTheme'

/* ================================================================
 * 类型
 * ================================================================ */

type CardType = 'recite' | 'meaning' | 'origin'

interface LocalCard {
  id: string
  type: string
  entryId: string
  entryTitle: string
  srcPath: string
  lapses: number
  due: number
}

interface LocalRecord {
  date: string
  variant: number
  score: number
  total: number
  mistakes: any[]
  ts: number
}

interface PoemMeta {
  id: string
  title: string
  dynasty?: string
  form?: string
  genre?: string
  srcPath: string
  imageryHits?: string[]
}

interface IdiomMeta {
  id: string
  word: string
  semanticField?: string
  srcPath: string
}

interface QuoteMeta {
  id: string
  text: string
  dynasty?: string
  srcPath: string
}

interface RadarDim {
  key: string
  name: string
  hit: number
  total: number
  percent: number
}

interface MistakeGroup {
  key: string
  type: string
  entryId: string
  title: string
  count: number
  href: string
  lastDate: string
}

/* ================================================================
 * 常量与工具
 * ================================================================ */

const REVIEW_KEY = 'wj-review-state'
const QUIZ_KEY = 'wj-quiz-history'
const GENRE_KEY = 'wj-genre-corrections'
const BASE = import.meta.env.BASE_URL || '/'
const TYPE_LABEL: Record<string, string> = { recite: '默写', meaning: '释义', origin: '溯源' }
const WEEKDAYS = '日一二三四五六'

function readJSON(key: string): any {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function safePercent(hit: number, total: number): number {
  if (!Number.isFinite(hit) || !Number.isFinite(total) || total <= 0) return 0
  return Math.min(100, Math.round((hit / total) * 1000) / 10)
}

function pageHref(path: string): string {
  return `${BASE}${path.replace(/^\//, '')}`
}

function entryHref(srcPath?: string): string {
  if (!srcPath) return ''
  return encodeURI(`${BASE}${srcPath.replace(/^content\//, '').replace(/\.md$/, '.html')}`)
}

function shortDate(date: string): string {
  const m = String(date || '').match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${m[1]}-${m[2]}` : date || '—'
}

/* ================================================================
 * 本地数据
 * ================================================================ */

const ready = ref(false)
const reviewCards = ref<LocalCard[]>([])
const quizRecords = ref<LocalRecord[]>([])
const correctionCount = ref(0)
const notice = ref('')
let noticeTimer: number | undefined

function showNotice(message: string) {
  notice.value = message
  if (noticeTimer) window.clearTimeout(noticeTimer)
  noticeTimer = window.setTimeout(() => (notice.value = ''), 6000)
}

function loadLocalData() {
  /* ---- 复习卡 ---- */
  const reviewState = readJSON(REVIEW_KEY)
  const cards: LocalCard[] = []
  const rawCards =
    reviewState && reviewState.v === 1 && reviewState.cards && typeof reviewState.cards === 'object'
      ? Object.values(reviewState.cards)
      : []
  for (const entry of rawCards as any[]) {
    const card = entry?.card ?? entry
    if (!card || !card.id) continue
    const id = String(card.id)
    const type = String(card.type || id.split(':')[0] || '')
    const entryId = String(card.entryId ?? id.slice(type.length + 1))
    const fsrs = entry?.fsrs ?? {}
    const dueRaw = fsrs?.due ?? card.due
    const due = dueRaw ? new Date(dueRaw).getTime() : NaN
    cards.push({
      id,
      type,
      entryId,
      entryTitle: String(card.entryTitle ?? ''),
      srcPath: String(card.srcPath ?? ''),
      lapses: Math.max(0, Math.floor(num(fsrs?.lapses ?? card.lapses))),
      due: Number.isFinite(due) ? due : NaN,
    })
  }
  reviewCards.value = cards

  /* ---- 答题记录 ---- */
  const history = readJSON(QUIZ_KEY)
  const records: LocalRecord[] = []
  if (history && history.v === 1 && Array.isArray(history.records)) {
    for (const raw of history.records as any[]) {
      if (!raw || typeof raw !== 'object') continue
      const total = Math.max(0, Math.floor(num(raw.total)))
      const score = Math.min(Math.max(0, Math.floor(num(raw.score))), total)
      records.push({
        date: String(raw.date ?? ''),
        variant: Math.max(0, Math.floor(num(raw.variant))),
        score,
        total,
        mistakes: Array.isArray(raw.mistakes) ? raw.mistakes : [],
        ts: num(raw.ts),
      })
    }
  }
  quizRecords.value = records

  /* ---- 题材校对（参与建设） ---- */
  const corrections = readJSON(GENRE_KEY)
  correctionCount.value =
    corrections && typeof corrections === 'object' && !Array.isArray(corrections)
      ? Object.keys(corrections).length
      : 0
}

/* ================================================================
 * 索引
 * ================================================================ */

const poems = ref<PoemMeta[]>([])
const idioms = ref<IdiomMeta[]>([])
const quotes = ref<QuoteMeta[]>([])
const stats = ref<any>(null)
const indexError = ref('')
const radarLoading = ref(true)

async function loadIndexes() {
  try {
    const getItems = async (name: string): Promise<any[]> => {
      const res = await fetch(`${BASE}indexes/${name}.json`)
      if (!res.ok) throw new Error(`indexes/${name}.json（HTTP ${res.status}）`)
      const data = await res.json()
      return Array.isArray(data?.items) ? data.items : []
    }
    const statsPromise = fetch(`${BASE}indexes/stats.json`).then(async (res) => {
      if (!res.ok) throw new Error(`indexes/stats.json（HTTP ${res.status}）`)
      return res.json()
    })
    const [poemItems, idiomItems, quoteItems, statsData] = await Promise.all([
      getItems('poems'),
      getItems('idioms'),
      getItems('quotes'),
      statsPromise,
    ])
    poems.value = poemItems as PoemMeta[]
    idioms.value = idiomItems as IdiomMeta[]
    quotes.value = quoteItems as QuoteMeta[]
    stats.value = statsData
  } catch (e: any) {
    indexError.value = e?.message ?? String(e)
  }
}

const poemById = computed(() => new Map(poems.value.map((p) => [p.id, p])))
const idiomById = computed(() => new Map(idioms.value.map((i) => [i.id, i])))
const quoteById = computed(() => new Map(quotes.value.map((q) => [q.id, q])))

function metaFor(type: string, entryId: string): { title: string; srcPath: string } | null {
  if (type === 'recite') {
    const poem = poemById.value.get(entryId)
    if (poem) return { title: `《${poem.title}》`, srcPath: poem.srcPath }
    const quote = quoteById.value.get(entryId)
    if (quote) return { title: quote.text, srcPath: quote.srcPath }
  } else if (type === 'meaning') {
    const idiom = idiomById.value.get(entryId)
    if (idiom) return { title: idiom.word, srcPath: idiom.srcPath }
  } else if (type === 'origin') {
    const quote = quoteById.value.get(entryId)
    if (quote) return { title: quote.text, srcPath: quote.srcPath }
  }
  return null
}

function cardTitle(card: LocalCard): string {
  return card.entryTitle || metaFor(card.type, card.entryId)?.title || card.entryId || card.id
}

function cardHref(card: LocalCard): string {
  return entryHref(card.srcPath || metaFor(card.type, card.entryId)?.srcPath)
}

/* ================================================================
 * 总览指标
 * ================================================================ */

const cardTypeCounts = computed(() => {
  const out: Record<string, number> = { recite: 0, meaning: 0, origin: 0 }
  for (const card of reviewCards.value) {
    if (card.type in out) out[card.type] += 1
    else out[card.type] = (out[card.type] ?? 0) + 1
  }
  return out
})

const totalQuestions = computed(() => quizRecords.value.reduce((sum, r) => sum + r.total, 0))
const totalScore = computed(() => quizRecords.value.reduce((sum, r) => sum + r.score, 0))
const accuracy = computed<number | null>(() =>
  totalQuestions.value > 0 ? Math.round((totalScore.value / totalQuestions.value) * 1000) / 10 : null,
)

const latestStudyDate = computed(() => {
  const dates = quizRecords.value.map((r) => r.date).filter(Boolean).sort()
  return dates.length ? dates[dates.length - 1] : ''
})

const streak = computed(() => {
  const dates = new Set(quizRecords.value.map((r) => r.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))
  if (!dates.size) return 0
  const cursorDate = new Date()
  let cursor = localDateKey(cursorDate)
  if (!dates.has(cursor)) {
    cursorDate.setDate(cursorDate.getDate() - 1)
    cursor = localDateKey(cursorDate)
    if (!dates.has(cursor)) return 0
  }
  let days = 0
  while (dates.has(cursor)) {
    days += 1
    const prev = new Date(`${cursor}T12:00:00`)
    prev.setDate(prev.getDate() - 1)
    cursor = localDateKey(prev)
  }
  return days
})

const isBlank = computed(() => reviewCards.value.length === 0 && quizRecords.value.length === 0)

const overviewMetrics = computed(() => {
  const counts = cardTypeCounts.value
  return [
    {
      key: 'cards',
      label: '已加入复习卡数',
      value: String(reviewCards.value.length),
      unit: '张',
      hint: reviewCards.value.length
        ? `默写 ${counts.recite ?? 0} · 释义 ${counts.meaning ?? 0} · 溯源 ${counts.origin ?? 0}`
        : '去词条页点「＋ 加入复习」',
    },
    {
      key: 'questions',
      label: '累计答题数',
      value: String(totalQuestions.value),
      unit: '题',
      hint: quizRecords.value.length ? `共交卷 ${quizRecords.value.length} 套` : '完成一套每日一卷开始记录',
    },
    {
      key: 'accuracy',
      label: '平均正确率',
      value: accuracy.value === null ? '—' : accuracy.value.toFixed(1),
      unit: accuracy.value === null ? '' : '%',
      hint: totalQuestions.value ? `累计答对 ${totalScore.value} / ${totalQuestions.value} 题` : '暂无答题数据',
    },
    {
      key: 'streak',
      label: '连续学习天数',
      value: String(streak.value),
      unit: '天',
      hint: latestStudyDate.value ? `最近学习 ${shortDate(latestStudyDate.value)}` : '连续每天做一套即可累积',
    },
  ]
})

/* ================================================================
 * 四维雷达
 * ================================================================ */

const reviewedPoems = computed(() => {
  const out: PoemMeta[] = []
  const seen = new Set<string>()
  for (const card of reviewCards.value) {
    if (card.type !== 'recite' || seen.has(card.entryId)) continue
    const poem = poemById.value.get(card.entryId)
    if (poem) {
      out.push(poem)
      seen.add(card.entryId)
    }
  }
  return out
})

const allDynasties = computed(() => new Set(poems.value.map((p) => p.dynasty).filter(Boolean) as string[]))
const allForms = computed(() => new Set(poems.value.map((p) => p.form).filter(Boolean) as string[]))
const reviewedDynasties = computed(
  () => new Set(reviewedPoems.value.map((p) => p.dynasty).filter(Boolean) as string[]),
)
const reviewedForms = computed(() => new Set(reviewedPoems.value.map((p) => p.form).filter(Boolean) as string[]))

const imageryTotalSet = computed(() => {
  const fromStats = new Set<string>(
    (Array.isArray(stats.value?.imageryFreq) ? stats.value.imageryFreq : [])
      .map((x: any) => String(x?.name ?? ''))
      .filter(Boolean),
  )
  if (fromStats.size) return fromStats
  return new Set<string>(
    poems.value.flatMap((p) => (Array.isArray(p.imageryHits) ? p.imageryHits : [])).filter(Boolean),
  )
})

const reviewedImagerySet = computed(
  () =>
    new Set<string>(
      reviewedPoems.value
        .flatMap((p) => (Array.isArray(p.imageryHits) ? p.imageryHits : []))
        .filter(Boolean),
    ),
)

const semanticTotalSet = computed(
  () => new Set(idioms.value.map((i) => i.semanticField).filter(Boolean) as string[]),
)

const reviewedSemanticSet = computed(() => {
  const out = new Set<string>()
  for (const card of reviewCards.value) {
    if (card.type !== 'meaning') continue
    const idiom = idiomById.value.get(card.entryId)
    if (idiom?.semanticField) out.add(idiom.semanticField)
  }
  return out
})

const radarDims = computed<RadarDim[]>(() => {
  const dims = [
    {
      key: 'dynasty',
      name: '朝代覆盖',
      hit: reviewedDynasties.value.size,
      total: allDynasties.value.size,
    },
    {
      key: 'form',
      name: '体裁覆盖',
      hit: reviewedForms.value.size,
      total: allForms.value.size,
    },
    {
      key: 'imagery',
      name: '意象熟悉度',
      hit: reviewedImagerySet.value.size,
      total: imageryTotalSet.value.size,
    },
    {
      key: 'semantic',
      name: '成语语义场掌握',
      hit: reviewedSemanticSet.value.size,
      total: semanticTotalSet.value.size,
    },
  ]
  return dims.map((d) => ({ ...d, percent: safePercent(d.hit, d.total) }))
})

const radarAllZero = computed(() => radarDims.value.every((d) => d.hit === 0))

/* ---- ECharts（运行时按需加载） ---- */

const radarEl = ref<HTMLElement | null>(null)
let chart: any = null
let ro: ResizeObserver | null = null
const radarFailed = ref('')

function renderRadar() {
  if (!chart) return
  const dims = radarDims.value
  const palette = chartPalette()
  const accent = cssVar('--wj-accent') || palette[0] || '#4a6cf7'
  const ink = cssVar('--wj-ink-2') || '#666'
  const inkStrong = cssVar('--wj-ink') || '#111'
  const line = cssVar('--wj-line') || '#ddd'
  const card = cssVar('--wj-card') || '#fff'
  const font = cssVar('--wj-font-display') || 'sans-serif'

  chart.setOption(
    {
      backgroundColor: 'transparent',
      textStyle: { fontFamily: font },
      tooltip: {
        trigger: 'item',
        backgroundColor: card,
        borderColor: line,
        textStyle: { color: inkStrong, fontFamily: font, fontSize: 12 },
        formatter: () =>
          dims
            .map(
              (d) =>
                `${d.name}<br/><b>${d.percent}%</b>　${d.hit} / ${d.total}`,
            )
            .join('<br/>'),
      },
      radar: {
        center: ['50%', '54%'],
        radius: '64%',
        splitNumber: 4,
        indicator: dims.map((d) => ({ name: d.name, max: 100 })),
        axisName: { color: ink, fontSize: 12, fontFamily: font },
        axisLine: { lineStyle: { color: line } },
        splitLine: { lineStyle: { color: line } },
        splitArea: { show: false },
      },
      series: [
        {
          type: 'radar',
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: accent, width: 2 },
          itemStyle: { color: accent, borderColor: card, borderWidth: 1 },
          areaStyle: { color: accent, opacity: 0.22 },
          label: {
            show: true,
            color: ink,
            fontSize: 11,
            fontFamily: font,
            formatter: (p: any) => `${p.value}%`,
          },
          data: [{ value: dims.map((d) => d.percent), name: '覆盖度' }],
        },
      ],
    },
    { notMerge: true },
  )
}

async function initRadar() {
  radarLoading.value = true
  if (!radarEl.value) {
    radarLoading.value = false
    return
  }
  try {
    const echarts = await import('echarts')
    if (!radarEl.value) return
    chart = echarts.init(radarEl.value)
    renderRadar()
    window.addEventListener('resize', onResize)
    if (typeof ResizeObserver !== 'undefined' && radarEl.value) {
      ro = new ResizeObserver(() => chart && chart.resize())
      ro.observe(radarEl.value)
    }
  } catch (e: any) {
    radarFailed.value = e?.message ?? String(e)
  } finally {
    radarLoading.value = false
  }
}

function onResize() {
  chart?.resize()
}

const offTheme = onThemeChange(() => renderRadar())
const offAppearance = onAppearanceChange(() => renderRadar())

onMounted(async () => {
  loadLocalData()
  ready.value = true
  await nextTick()
  await loadIndexes()
  await nextTick()
  await initRadar()
})

onBeforeUnmount(() => {
  offTheme()
  offAppearance()
  window.removeEventListener('resize', onResize)
  ro?.disconnect()
  ro = null
  chart?.dispose()
  chart = null
  if (noticeTimer) window.clearTimeout(noticeTimer)
})

/* ================================================================
 * 薄弱点：错题主题
 * ================================================================ */

function parseQid(qid: unknown): { date: string; type: string; entryId: string } {
  const raw = String(qid ?? '')
  const dated = raw.match(/^(\d{4}-\d{2}-\d{2}):\d+:(recite|meaning|origin):(.+)$/)
  if (dated) return { date: dated[1], type: dated[2], entryId: dated[3] }
  const idx = raw.indexOf(':')
  const maybeType = idx > 0 ? raw.slice(0, idx) : ''
  if (TYPE_LABEL[maybeType]) return { date: '', type: maybeType, entryId: raw.slice(idx + 1) }
  return { date: '', type: '', entryId: raw }
}

const mistakeStats = computed(() => {
  const groups = new Map<string, MistakeGroup>()
  const typeCounts: Record<string, number> = { recite: 0, meaning: 0, origin: 0 }
  let total = 0

  for (const record of quizRecords.value) {
    for (const mistake of record.mistakes) {
      const fromQid = parseQid(mistake?.qid)
      const fromCard = parseQid(mistake?.cardId)
      let type = String(mistake?.type || fromQid.type || fromCard.type || '')
      if (!TYPE_LABEL[type]) type = fromQid.type || fromCard.type
      if (!TYPE_LABEL[type]) continue
      const entryId = fromQid.entryId || fromCard.entryId
      if (!entryId) continue

      const meta = metaFor(type, entryId)
      const key = `${type}:${entryId}`
      const title = String(mistake?.entryTitle || meta?.title || entryId)
      const href = entryHref(String(mistake?.srcPath || meta?.srcPath || ''))
      const date = fromQid.date || record.date
      const existing = groups.get(key)
      if (existing) {
        existing.count += 1
        if (date > existing.lastDate) existing.lastDate = date
      } else {
        groups.set(key, { key, type, entryId, title, count: 1, href, lastDate: date })
      }
      typeCounts[type] += 1
      total += 1
    }
  }

  const top = [...groups.values()]
    .sort(
      (a, b) =>
        b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.title.localeCompare(b.title, 'zh'),
    )
    .slice(0, 5)

  return { top, typeCounts, total }
})

/* ================================================================
 * 薄弱点：复习压力
 * ================================================================ */

const pressureCards = computed(() =>
  reviewCards.value
    .filter((card) => card.lapses >= 2)
    .sort((a, b) => {
      if (b.lapses !== a.lapses) return b.lapses - a.lapses
      const da = Number.isFinite(a.due) ? a.due : Number.POSITIVE_INFINITY
      const db = Number.isFinite(b.due) ? b.due : Number.POSITIVE_INFINITY
      return da - db
    })
    .slice(0, 5),
)

function dueText(due: number): string {
  if (!Number.isFinite(due)) return '未排期'
  if (due <= Date.now()) return '已到期'
  const d = new Date(due)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} 到期`
}

/* ================================================================
 * 薄弱点：覆盖缺口
 * ================================================================ */

const genreGaps = computed(() => {
  const reviewedPoemIds = new Set(
    reviewCards.value.filter((card) => card.type === 'recite').map((card) => card.entryId),
  )
  const counts = new Map<string, { total: number; touched: boolean }>()
  for (const poem of poems.value) {
    const genre = String(poem.genre ?? '').trim()
    if (!genre || genre === '待归类') continue
    const item = counts.get(genre) ?? { total: 0, touched: false }
    item.total += 1
    if (reviewedPoemIds.has(poem.id)) item.touched = true
    counts.set(genre, item)
  }
  return [...counts.entries()]
    .filter(([, item]) => !item.touched)
    .map(([genre, item]) => ({ genre, total: item.total }))
    .sort((a, b) => b.total - a.total || a.genre.localeCompare(b.genre, 'zh'))
    .slice(0, 3)
})

/* ================================================================
 * 学习足迹
 * ================================================================ */

const quizByDate = computed(() => {
  const map = new Map<string, number>()
  for (const record of quizRecords.value) {
    if (!record.date) continue
    map.set(record.date, (map.get(record.date) ?? 0) + record.total)
  }
  return map
})

const last14Days = computed(() => {
  const out: { key: string; label: string; weekday: string; questions: number }[] = []
  const today = new Date()
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const key = localDateKey(d)
    out.push({
      key,
      label: `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`,
      weekday: WEEKDAYS[d.getDay()],
      questions: quizByDate.value.get(key) ?? 0,
    })
  }
  return out
})

const heatMax = computed(() => Math.max(1, ...last14Days.value.map((d) => d.questions)))

function heatLevel(questions: number): number {
  if (questions <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((questions / heatMax.value) * 4)))
}

function heatStyle(questions: number): Record<string, string> {
  if (questions <= 0) return { background: 'var(--wj-line-soft)' }
  return {
    background: 'var(--wj-accent)',
    opacity: String(0.24 + heatLevel(questions) * 0.18),
  }
}

const recentRecords = computed(() =>
  quizRecords.value
    .slice()
    .sort((a, b) => recordTime(b) - recordTime(a))
    .slice(0, 5),
)

function recordTime(record: LocalRecord): number {
  if (Number.isFinite(record.ts) && record.ts > 0) return record.ts
  const parsed = Date.parse(`${record.date}T00:00:00`)
  return Number.isFinite(parsed) ? parsed + record.variant : 0
}

function recordAccuracy(record: LocalRecord): number {
  return record.total > 0 ? Math.round((record.score / record.total) * 100) : 0
}

/* ================================================================
 * 导出 / 清空
 * ================================================================ */

const confirmingClear = ref(false)

function exportJSON() {
  const payload = {
    app: 'wanjuan',
    version: 1,
    exportedAt: new Date().toISOString(),
    reviewState: readJSON(REVIEW_KEY),
    quizHistory: readJSON(QUIZ_KEY),
    genreCorrections: readJSON(GENRE_KEY),
  }
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}`
  const name = `wanjuan-profile-${stamp}.json`
  try {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    showNotice(`已导出 ${name}`)
  } catch (e: any) {
    showNotice(`导出失败：${e?.message ?? String(e)}`)
  }
}

function requestClear() {
  confirmingClear.value = true
}

function cancelClear() {
  confirmingClear.value = false
}

function confirmClear() {
  try {
    localStorage.removeItem(REVIEW_KEY)
    localStorage.removeItem(QUIZ_KEY)
    localStorage.removeItem(GENRE_KEY)
  } catch (e: any) {
    showNotice(`清空失败：${e?.message ?? String(e)}`)
    confirmingClear.value = false
    return
  }
  confirmingClear.value = false
  loadLocalData()
  renderRadar()
  showNotice('已清空本机学习数据（复习卡、答题记录、题材校对）')
}
</script>

<template>
  <div class="wj-profile">
    <div v-if="!ready" class="wj-empty">正在读取本机学习数据…</div>

    <template v-else>
      <div v-if="notice" class="wj-profile-notice" role="status">{{ notice }}</div>

      <!-- 1. 总览 -->
      <section class="wj-panel wj-profile-overview" aria-label="学习总览">
        <div class="wj-profile-metrics">
          <div v-for="metric in overviewMetrics" :key="metric.key" class="wj-profile-metric">
            <span class="wj-profile-metric-label">{{ metric.label }}</span>
            <span class="wj-profile-metric-value">
              {{ metric.value }}<small v-if="metric.unit">{{ metric.unit }}</small>
            </span>
            <span class="wj-profile-metric-hint">{{ metric.hint }}</span>
          </div>
        </div>

        <div v-if="isBlank" class="wj-empty wj-profile-guide">
          <p><b>画像还是一张白纸。</b>先去词条页把感兴趣的作品加入复习，或做一套每日一卷——这里会自动长出雷达、诊断和足迹。</p>
          <div class="wj-profile-actions">
            <a class="wj-profile-btn primary" :href="pageHref('review/')">去复习</a>
            <a class="wj-profile-btn" :href="pageHref('quiz/')">去做题</a>
          </div>
        </div>
        <p v-else-if="correctionCount > 0" class="wj-profile-contrib">
          参与建设：你已校对 <b>{{ correctionCount }}</b> 条题材标注，感谢为知识库添一笔。
        </p>
      </section>

      <!-- 2. 四维雷达 -->
      <section class="wj-panel wj-profile-section" aria-labelledby="wj-profile-radar-title">
        <div class="wj-profile-section-head">
          <h2 id="wj-profile-radar-title">四维文学素养雷达</h2>
          <span class="wj-profile-section-note">复习卡 × 全库索引</span>
        </div>
        <p class="wj-profile-lead">
          四维均为「已覆盖 / 全库总量」的覆盖率：复习卡里的作品与成语，按索引反查朝代、体裁、意象与语义场。
        </p>

        <p v-if="radarLoading" class="wj-note">正在加载四维数据…</p>
        <p v-else-if="indexError" class="wj-note">索引加载失败（{{ indexError }}），四维暂按 0 显示。</p>

        <div ref="radarEl" class="wj-profile-radar" role="img" aria-label="四维文学素养雷达图"></div>
        <p v-if="radarFailed" class="wj-note">图表渲染失败（{{ radarFailed }}），可参考下方数值。</p>

        <div class="wj-profile-dims">
          <span v-for="dim in radarDims" :key="dim.key" class="wj-chip wj-profile-dim">
            {{ dim.name }}
            <b>{{ dim.percent }}%</b>
            <span class="wj-chip-n">{{ dim.hit }} / {{ dim.total }}</span>
          </span>
        </div>

        <p v-if="isBlank" class="wj-profile-explain">
          还没有复习卡，所以四维都是 0%。去词条页点「＋ 加入复习」，或在每日一卷里答错生成卡片，雷达就会随真实数据生长。
        </p>
        <p v-else-if="radarAllZero" class="wj-profile-explain">
          已有复习卡，但暂未匹配到作品或成语索引（例如卡片来自名句默写）。加入作品默写卡或成语释义卡后即可看到覆盖变化。
        </p>
        <p v-else-if="!indexError" class="wj-profile-explain">
          提示：名句「溯源 / 默写」卡不计入朝代、体裁与意象维度；它们反映的是作品积累，而名句素养可在错题主题中观察。
        </p>
      </section>

      <!-- 3. 薄弱点诊断 -->
      <section class="wj-profile-section" aria-labelledby="wj-profile-diag-title">
        <div class="wj-profile-section-head">
          <h2 id="wj-profile-diag-title">薄弱点诊断</h2>
          <span class="wj-profile-section-note">按真实错题与复习状态</span>
        </div>

        <div class="wj-profile-diag-grid">
          <!-- 3.1 错题主题 Top5 -->
          <article class="wj-panel wj-profile-diag">
            <div class="wj-profile-diag-head">
              <h3>错题主题 Top 5</h3>
              <span v-if="mistakeStats.total" class="wj-profile-count">{{ mistakeStats.total }} 次错误</span>
            </div>

            <p v-if="mistakeStats.total" class="wj-profile-type-row">
              <span v-for="(label, type) in TYPE_LABEL" :key="type" class="wj-chip wj-profile-type">
                {{ label }} <b>{{ mistakeStats.typeCounts[type] ?? 0 }}</b>
              </span>
            </p>

            <ol v-if="mistakeStats.top.length" class="wj-profile-list">
              <li v-for="item in mistakeStats.top" :key="item.key" class="wj-profile-list-item">
                <span class="wj-profile-badge">{{ TYPE_LABEL[item.type] }}</span>
                <a v-if="item.href" class="wj-profile-item-title" :href="item.href">{{ item.title }}</a>
                <span v-else class="wj-profile-item-title">{{ item.title }}</span>
                <span class="wj-profile-item-meta">{{ item.count }} 次</span>
              </li>
            </ol>
            <div v-else class="wj-profile-empty-line">
              还没有错题记录。做一套每日一卷，错题会自动汇总在这里并进入复习队列。
            </div>

            <div class="wj-profile-actions">
              <a class="wj-profile-btn primary" :href="pageHref('quiz/')">去 /quiz/ 再练一套</a>
              <a class="wj-profile-btn" :href="pageHref('quiz/mistakes')">查看错题本</a>
            </div>
          </article>

          <!-- 3.2 复习压力 -->
          <article class="wj-panel wj-profile-diag">
            <div class="wj-profile-diag-head">
              <h3>复习压力</h3>
              <span v-if="pressureCards.length" class="wj-profile-count">lapses ≥ 2</span>
            </div>

            <ol v-if="pressureCards.length" class="wj-profile-list">
              <li v-for="card in pressureCards" :key="card.id" class="wj-profile-list-item">
                <span class="wj-profile-badge">{{ TYPE_LABEL[card.type] || '卡片' }}</span>
                <a v-if="cardHref(card)" class="wj-profile-item-title" :href="cardHref(card)">{{ cardTitle(card) }}</a>
                <span v-else class="wj-profile-item-title">{{ cardTitle(card) }}</span>
                <span class="wj-profile-item-meta">
                  忘 {{ card.lapses }} 次 · {{ dueText(card.due) }}
                </span>
              </li>
            </ol>
            <div v-else class="wj-profile-empty-line">
              暂无反复遗忘的卡片（lapses ≥ 2）。继续按计划复习，这里会揪出最该补的几张。
            </div>

            <div class="wj-profile-actions">
              <a class="wj-profile-btn primary" :href="pageHref('review/')">去 /review/ 清卡</a>
            </div>
          </article>

          <!-- 3.3 覆盖缺口 -->
          <article class="wj-panel wj-profile-diag">
            <div class="wj-profile-diag-head">
              <h3>覆盖缺口</h3>
              <span class="wj-profile-section-note">复习卡为 0 的题材</span>
            </div>

            <ul v-if="genreGaps.length" class="wj-profile-gaps">
              <li v-for="gap in genreGaps" :key="gap.genre" class="wj-profile-gap">
                <span class="wj-profile-gap-name">{{ gap.genre }}</span>
                <span class="wj-profile-gap-total">全库 {{ gap.total }} 篇 · 你还没碰</span>
              </li>
            </ul>
            <div v-else-if="isBlank" class="wj-profile-empty-line">
              还没有复习卡，全库题材都是待开垦的空白。
            </div>
            <div v-else class="wj-profile-empty-line">
              每个题材都已有复习卡，覆盖面不错；可以换成语库或名句库开拓新版图。
            </div>

            <div class="wj-profile-actions">
              <a class="wj-profile-btn primary" :href="pageHref('quiz/')">去 /quiz/ 抽新题</a>
              <a class="wj-profile-btn" :href="pageHref('idioms/')">逛成语库</a>
              <a class="wj-profile-btn" :href="pageHref('quotes/')">逛名句库</a>
            </div>
          </article>
        </div>
      </section>

      <!-- 4. 学习足迹 -->
      <section class="wj-panel wj-profile-section" aria-labelledby="wj-profile-foot-title">
        <div class="wj-profile-section-head">
          <h2 id="wj-profile-foot-title">学习足迹</h2>
          <span class="wj-profile-section-note">最近 14 天</span>
        </div>

        <div class="wj-profile-heat" aria-label="最近 14 天答题热力条">
          <div
            v-for="day in last14Days"
            :key="day.key"
            class="wj-profile-heat-cell"
            :style="heatStyle(day.questions)"
            :title="`${day.key}（周${day.weekday}）：${day.questions} 题`"
            :aria-label="`${day.key} 周${day.weekday}，${day.questions} 题`"
          ></div>
        </div>
        <div class="wj-profile-heat-scale">
          <span>{{ last14Days[0]?.label }}</span>
          <span class="wj-profile-heat-legend">
            少
            <i v-for="level in 4" :key="level" :style="heatStyle(level)"></i>
            多
          </span>
          <span>{{ last14Days[last14Days.length - 1]?.label }}</span>
        </div>

        <div class="wj-profile-recent">
          <h3>最近 5 条答题记录</h3>
          <ul v-if="recentRecords.length" class="wj-profile-records">
            <li v-for="record in recentRecords" :key="`${record.date}-${record.variant}`" class="wj-profile-record">
              <span class="wj-profile-record-date">{{ record.date || '—' }}</span>
              <span class="wj-profile-record-variant">第 {{ record.variant + 1 }} 卷</span>
              <span class="wj-profile-record-score">{{ record.score }} / {{ record.total }}</span>
              <span class="wj-profile-record-acc">{{ recordAccuracy(record) }}%</span>
            </li>
          </ul>
          <p v-else class="wj-profile-empty-line">
            还没有答题记录。完成一套<a :href="pageHref('quiz/')">每日一卷</a>后会出现在这里。
          </p>
        </div>
      </section>

      <!-- 5. 数据与隐私 -->
      <section class="wj-panel wj-profile-privacy" aria-label="数据与隐私">
        <p class="wj-profile-privacy-text">
          全部数据仅存本机 localStorage（复习卡、答题记录、题材校对），不上传服务器。你可以随时导出 JSON 备份，或清空本地学习数据。
        </p>
        <div class="wj-profile-actions">
          <button type="button" class="wj-profile-btn" @click="exportJSON">导出 JSON</button>

          <template v-if="!confirmingClear">
            <button type="button" class="wj-profile-btn danger" @click="requestClear">清空本地数据</button>
          </template>
          <template v-else>
            <span class="wj-profile-confirm-text">清空后不可恢复，确定吗？</span>
            <button type="button" class="wj-profile-btn danger" @click="confirmClear">确认清空</button>
            <button type="button" class="wj-profile-btn" @click="cancelClear">取消</button>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
/* 画像需要横向空间承载三列诊断与雷达：与 .wj-chart 数据页同一版心策略 */
:global(.VPDoc:has(.wj-profile) .content-container),
:global(.VPDoc:has(.wj-profile) .content) {
  max-width: 1060px !important;
}
:global(.VPDoc:has(.wj-profile) .container) {
  max-width: 1440px !important;
}

.wj-profile {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin: 18px 0 40px;
}

.wj-profile .wj-panel {
  transition: none;
}
.wj-profile .wj-panel:hover {
  transform: none;
  box-shadow: var(--wj-shadow);
}

.wj-profile-notice {
  padding: 10px 14px;
  border: 1px solid var(--wj-line);
  border-left: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
  color: var(--wj-ink);
  font-size: 13px;
}

/* ---- 总览 ---- */
.wj-profile-overview {
  padding: 20px 22px;
}

.wj-profile-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.wj-profile-metric {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  padding: 4px 2px;
}

.wj-profile-metric + .wj-profile-metric {
  border-left: 1px solid var(--wj-line-soft);
  padding-left: 16px;
}

.wj-profile-metric-label {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-display);
}

.wj-profile-metric-value {
  font-family: var(--wj-font-display);
  font-size: 2.05em;
  font-weight: var(--wj-display-weight, 800);
  line-height: 1.05;
  color: var(--wj-ink);
  font-variant-numeric: tabular-nums;
}

.wj-profile-metric-value small {
  margin-left: 4px;
  font-size: 0.42em;
  font-weight: 400;
  color: var(--wj-ink-3);
}

.wj-profile-metric-hint {
  font-size: 12px;
  color: var(--wj-ink-2);
  line-height: 1.5;
}

.wj-profile-guide {
  margin-top: 18px;
  padding: 26px 20px;
}

.wj-profile-guide p {
  margin: 0 auto 14px;
  max-width: 34em;
  font-size: 14px;
  line-height: 1.75;
}

.wj-profile-contrib {
  margin: 16px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--wj-line-soft);
  font-size: 12px;
  color: var(--wj-ink-3);
}

.wj-profile-contrib b {
  color: var(--wj-accent);
}

/* ---- 通用节标题 ---- */
.wj-profile-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.wj-profile-section-head h2 {
  margin: 0;
  font-size: 1.28em;
  padding: 0;
  border: none;
}

.wj-profile-section-note {
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-display);
}

.wj-profile-lead {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--wj-ink-2);
}

/* ---- 雷达 ---- */
.wj-profile-radar {
  width: 100%;
  height: 360px;
  margin: 2px 0 4px;
}

.wj-profile-dims {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0 10px;
}

.wj-profile-dim {
  cursor: default;
  font-family: var(--wj-font-display);
}

.wj-profile-dim:hover {
  border-color: var(--wj-line);
  color: var(--wj-ink-2);
  transform: none;
}

.wj-profile-dim b {
  color: var(--wj-accent);
  font-variant-numeric: tabular-nums;
}

.wj-profile-explain {
  margin: 8px 0 0;
  padding: 10px 14px;
  border: 1px dashed var(--wj-line);
  border-radius: var(--wj-radius-sm);
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--wj-ink-2);
}

/* ---- 诊断 ---- */
.wj-profile-diag-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.wj-profile-diag {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.wj-profile-diag-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.wj-profile-diag-head h3 {
  margin: 0;
  font-size: 1.02em;
  letter-spacing: 0.02em;
}

.wj-profile-count {
  font-size: 11px;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-mono);
}

.wj-profile-type-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 10px;
}

.wj-profile-type {
  cursor: default;
  padding: 3px 9px;
  min-height: 26px;
  font-size: 12px;
}

.wj-profile-type:hover {
  border-color: var(--wj-line);
  color: var(--wj-ink-2);
  transform: none;
}

.wj-profile-type b {
  color: var(--wj-accent);
}

.wj-profile-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wj-profile-list-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid var(--wj-line-soft);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
}

.wj-profile-badge {
  flex: none;
  padding: 1px 7px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
}

.wj-profile-item-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--wj-ink);
  text-decoration: none;
}

a.wj-profile-item-title:hover {
  color: var(--wj-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.wj-profile-item-meta {
  flex: none;
  font-size: 11px;
  color: var(--wj-ink-3);
  font-variant-numeric: tabular-nums;
}

.wj-profile-gaps {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wj-profile-gap {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--wj-line-soft);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
}

.wj-profile-gap-name {
  font-family: var(--wj-font-display);
  font-size: 14px;
  color: var(--wj-ink);
}

.wj-profile-gap-total {
  font-size: 11px;
  color: var(--wj-ink-3);
}

.wj-profile-empty-line {
  padding: 12px 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--wj-ink-3);
}

.wj-profile-empty-line a {
  color: var(--wj-accent);
}

/* ---- 动作按钮 ---- */
.wj-profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: auto;
  padding-top: 12px;
}

.wj-profile-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  padding: 5px 14px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  font-size: 12.5px;
  font-family: var(--wj-font-display);
  text-decoration: none;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.wj-profile-btn:hover {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
}

.wj-profile-btn.primary {
  border-color: var(--wj-accent);
  background: var(--wj-accent);
  color: #fff;
}

.wj-profile-btn.primary:hover {
  background: var(--wj-accent-deep);
  border-color: var(--wj-accent-deep);
  color: #fff;
}

.wj-profile-btn.danger {
  border-color: var(--wj-ink-3);
  color: var(--wj-ink-2);
}

.wj-profile-btn.danger:hover {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}

.wj-profile-confirm-text {
  font-size: 12px;
  color: var(--wj-ink-2);
}

/* ---- 热力条 ---- */
.wj-profile-heat {
  display: grid;
  grid-template-columns: repeat(14, minmax(0, 1fr));
  gap: 5px;
  margin-top: 6px;
}

.wj-profile-heat-cell {
  height: 26px;
  border-radius: calc(var(--wj-radius-sm) * 0.7);
  border: 1px solid var(--wj-line-soft);
}

.wj-profile-heat-scale {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 7px;
  font-size: 11px;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-mono);
}

.wj-profile-heat-legend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.wj-profile-heat-legend i {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1px solid var(--wj-line-soft);
  border-radius: 3px;
}

.wj-profile-recent {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--wj-line-soft);
}

.wj-profile-recent h3 {
  margin: 0 0 8px;
  font-size: 0.98em;
}

.wj-profile-records {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.wj-profile-record {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 10px;
  border: 1px solid var(--wj-line-soft);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-bg-soft);
  font-size: 12.5px;
  font-family: var(--wj-font-mono);
  color: var(--wj-ink-2);
}

.wj-profile-record-date {
  color: var(--wj-ink);
}

.wj-profile-record-variant {
  color: var(--wj-ink-3);
  font-size: 11px;
}

.wj-profile-record-score {
  margin-left: auto;
  color: var(--wj-ink);
  font-variant-numeric: tabular-nums;
}

.wj-profile-record-acc {
  min-width: 3.2em;
  text-align: right;
  color: var(--wj-accent);
  font-variant-numeric: tabular-nums;
}

/* ---- 隐私 ---- */
.wj-profile-privacy {
  padding: 16px 20px;
}

.wj-profile-privacy-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--wj-ink-2);
}

.wj-profile-privacy .wj-profile-actions {
  padding-top: 10px;
}

/* ---- 响应式 ---- */
@media (max-width: 1100px) {
  .wj-profile-diag-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .wj-profile-diag:last-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 860px) {
  .wj-profile-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 14px;
  }

  .wj-profile-metric + .wj-profile-metric {
    border-left: none;
    padding-left: 2px;
  }

  .wj-profile-metric:nth-child(even) {
    border-left: 1px solid var(--wj-line-soft);
    padding-left: 16px;
  }

  .wj-profile-diag-grid {
    grid-template-columns: 1fr;
  }

  .wj-profile-diag:last-child {
    grid-column: auto;
  }
}

@media (max-width: 640px) {
  .wj-profile {
    gap: 14px;
  }

  .wj-profile-overview {
    padding: 16px;
  }

  .wj-profile-metric-value {
    font-size: 1.7em;
  }

  .wj-profile-radar {
    height: 300px;
  }

  .wj-profile-heat {
    gap: 4px;
  }

  .wj-profile-heat-cell {
    height: 22px;
  }

  .wj-profile-record {
    gap: 8px;
    flex-wrap: wrap;
  }
}
</style>