<script setup lang="ts">
// 万卷 · 名句库浏览页
//
// 数据源：
//   /indexes/quotes.json         —— 名句（text/author/work/theme/dynasty/curriculum/srcPath）
//   /indexes/poems.json          —— 作品标题与词条路由（work → 篇名/链接）
//   /indexes/quotes-detail.json  —— 语境/适用场景（卡内展开，不跳页）
//
// 交互：
//   三视图（画廊 / 列表 / 主题墙，?view= 同步）· 折叠筛选（常用主题 + 更多筛选）
//   搜索（汉字/作者/篇名/全拼/首字母，/ 聚焦、Esc 清空）· 分页 24/页 · URL 同步
//   整卡进词条页 · 卡内展开语境 · 一键复制「名句」——作者《篇名》
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { pinyin } from 'pinyin-pro'
import WjFilterBar from './WjFilterBar.vue'
import WjPager from './WjPager.vue'
import QuoteCard from './QuoteCard.vue'
import { useUrlState } from '../composables/useUrlState'

type Quote = {
  id: string
  text: string
  author: string
  work?: string | null
  theme: string[]
  dynasty: string
  tags?: string[]
  curriculum?: { stage?: string; grade?: number; recitation?: boolean }
  srcPath: string
  sourceType?: string
  citation?: string | null
  verified?: boolean | null
}

type Poem = {
  id: string
  title: string
  author: string
  srcPath: string
}

type Detail = {
  id: string
  context: string
  scene?: string
}

type Enriched = Quote & {
  workTitle: string
  workRoute: string
  entryRoute: string
  scene: string
  context: string
  pinyin: string
  initials: string
  stageLabel: string
  sourceLabel: string
  citeSource: string
}

type WallGroup = { key: string; items: Enriched[] }

type SelectedChip = {
  key: 'q' | 'theme' | 'dynasty' | 'stage' | 'source'
  value: string
  label: string
  group: string
}

const BASE = import.meta.env.BASE_URL

/** 名句来源分层：古诗文 / 近现代名家 / 演讲语录 */
const SOURCE_LABEL: Record<string, string> = {
  classical: '古诗文',
  modern: '近现代名家',
  speech: '演讲语录',
}
const SOURCE_ORDER = ['classical', 'modern', 'speech']

const THEMES = [
  '自信', '豁达', '进取', '志向', '家国', '奉献', '思念', '友情',
  '惜时', '勤学', '哲思', '自然', '清廉', '担当', '坚韧', '孝亲',
] as const

/** 主题 → 适用场景短语（与 scripts/expand-quotes.mjs 保持同一套措辞） */
const THEME_SCENE: Record<string, string> = {
  自信: '表达对自我价值的肯定与从容',
  豁达: '表达面对得失、离别与挫折时的开阔胸襟',
  进取: '表达积极向上、不断追求进步的姿态',
  志向: '表达树立远大目标并为之奋斗的决心',
  家国: '表达对家国天下的关切与责任感',
  奉献: '表达甘于付出、成全他人的精神',
  思念: '表达对亲人、故乡或友人的深切怀念',
  友情: '表达真挚情谊与离别中的慰藉',
  惜时: '表达珍惜光阴、把握当下的态度',
  勤学: '表达勤勉学习、不断求索的精神',
  哲思: '表达对人生、事理的思考与感悟',
  自然: '描绘自然景物并寄寓情思',
  清廉: '表达清正自守、不慕荣利的品格',
  担当: '表达勇担责任、迎难而上的态度',
  坚韧: '表达在困境中坚持不懈的意志',
  孝亲: '表达对长辈的感念与孝敬',
}

const STAGE_LABEL: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中' }
const STAGE_ORDER = ['primary', 'junior', 'senior']
const DYNASTY_ORDER = ['先秦', '汉', '魏晋', '南北朝', '三国', '唐', '五代', '宋', '元', '明', '清', '近现代']

const VIEWS = [
  { id: 'gallery', label: '画廊' },
  { id: 'list', label: '列表' },
  { id: 'wall', label: '主题墙' },
] as const
type ViewMode = (typeof VIEWS)[number]['id']

const PAGE_SIZE_DEFAULT = 24
const WALL_STEP = 4
const WALL_PER_THEME = 6

const quotes = ref<Quote[]>([])
const poems = ref<Poem[]>([])
const details = ref<Detail[]>([])
const loading = ref(true)
const failed = ref('')

const pageSize = ref(PAGE_SIZE_DEFAULT)
const filtersOpen = ref(false)
const expanded = ref<Set<string>>(new Set())
const copiedId = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const resultsRef = ref<HTMLElement | null>(null)

const contextCache = reactive<Record<string, string>>({})
const contextLoading = reactive<Record<string, boolean>>({})
const contextError = reactive<Record<string, string>>({})

let copyTimer: ReturnType<typeof setTimeout> | undefined

const { state } = useUrlState({
  q: '',
  theme: [] as string[],
  dynasty: [] as string[],
  stage: [] as string[],
  source: [] as string[],
  page: 1,
  view: 'gallery',
})

const view = computed<ViewMode>({
  get: () => (VIEWS.some((v) => v.id === state.value.view) ? (state.value.view as ViewMode) : 'gallery'),
  set: (v) => {
    state.value.view = v
  },
})

const viewLabel = computed(() => VIEWS.find((v) => v.id === view.value)?.label ?? '画廊')

const poemById = computed(() => new Map(poems.value.map((p) => [p.id, p])))
const detailById = computed(() => new Map(details.value.map((d) => [d.id, d])))

function toRoute(srcPath: string) {
  return encodeURI(`${BASE}${srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}

function sceneFor(themes: string[]): string {
  const names = themes.map((t) => `「${t}」`).join('、')
  const desc = themes.map((t) => THEME_SCENE[t]).filter(Boolean).join('；')
  return `适合用于${names}主题的写作：${desc}。`
}

/** 篇名书名号：本身已带书名号时不重复包裹 */
function workLabel(title: string): string {
  if (!title) return ''
  return /^《.*》/.test(title) ? title : `《${title}》`
}

/** 卡面「作者 · 篇名」 */
function sourceLabel(author: string, title: string): string {
  const work = workLabel(title)
  if (!work) return author
  if (author && work.startsWith(author)) return work
  return author ? `${author} · ${work}` : work
}

/** 复制引用「名句」——作者《篇名》（不加间隔点） */
function citeSource(author: string, title: string): string {
  const work = workLabel(title)
  if (!work) return author
  if (author && work.startsWith(author)) return work
  return `${author}${work}`
}

function pinyinCompact(text: string, first = false): string {
  return pinyin(text, {
    toneType: 'none',
    type: 'array',
    pattern: first ? 'first' : undefined,
    nonZh: 'consecutive',
  })
    .join('')
    .replace(/\s+/g, '')
    .toLowerCase()
}

/** 语境常与原句相同（如单句摘录），此时卡内只展示适用场景，避免重复 */
function normalizeForCompare(text: string): string {
  return text.replace(/[\s\u3000，。、；：！？,.!?;:'"“”‘’「」『』《》〈〉（）()—…·]/g, '')
}

const enriched = computed<Enriched[]>(() => {
  const list = quotes.value.map((q) => {
    const poem = q.work ? poemById.value.get(q.work) : undefined
    const workTitle = poem?.title ?? ''
    const workRoute = poem ? toRoute(poem.srcPath) : ''
    const stage = q.curriculum?.stage ?? ''
    const detail = detailById.value.get(q.id)
    const searchPinyin = [
      pinyinCompact(q.text),
      pinyinCompact(q.author),
      workTitle ? pinyinCompact(workTitle) : '',
    ].join(' ')
    const searchInitials = [
      pinyinCompact(q.text, true),
      pinyinCompact(q.author, true),
      workTitle ? pinyinCompact(workTitle, true) : '',
    ].join(' ')
    const themes = q.theme ?? []
    return {
      ...q,
      workTitle,
      workRoute,
      entryRoute: toRoute(q.srcPath),
      scene: detail?.scene?.trim() || sceneFor(themes),
      context: detail?.context?.trim() ?? '',
      pinyin: searchPinyin,
      initials: searchInitials,
      stageLabel: STAGE_LABEL[stage] ?? stage,
      sourceLabel: sourceLabel(q.author, workTitle),
      citeSource: citeSource(q.author, workTitle),
    }
  })
  const dynastyRank = (d: string) => {
    const i = DYNASTY_ORDER.indexOf(d)
    return i < 0 ? DYNASTY_ORDER.length : i
  }
  return list.sort(
    (a, b) =>
      dynastyRank(a.dynasty) - dynastyRank(b.dynasty) ||
      a.author.localeCompare(b.author, 'zh') ||
      a.text.localeCompare(b.text, 'zh'),
  )
})

// ── 搜索与筛选 ──────────────────────────────────────────────

function searchMatch(q: Enriched, raw: string): boolean {
  const query = raw.trim()
  if (!query) return true
  if (/^[a-z0-9\s]+$/i.test(query)) {
    const compact = query.replace(/\s+/g, '').toLowerCase()
    return q.pinyin.includes(compact) || q.initials.includes(compact)
  }
  return (
    q.text.includes(query) ||
    q.author.includes(query) ||
    q.workTitle.includes(query) ||
    (q.theme ?? []).some((t) => t.includes(query))
  )
}

function dimensionMatch(q: Enriched, key: 'theme' | 'dynasty' | 'stage' | 'source'): boolean {
  const selected = state.value[key]
  if (!selected.length) return true
  if (key === 'theme') return (q.theme ?? []).some((t) => selected.includes(t))
  if (key === 'dynasty') return selected.includes(q.dynasty)
  if (key === 'source') return selected.includes(SOURCE_LABEL[q.sourceType ?? 'classical'] ?? '')
  return selected.includes(q.curriculum?.stage ?? '')
}

function matchesExcept(q: Enriched, skip?: 'theme' | 'dynasty' | 'stage' | 'source'): boolean {
  if (!searchMatch(q, state.value.q)) return false
  for (const key of ['source', 'theme', 'dynasty', 'stage'] as const) {
    if (key !== skip && !dimensionMatch(q, key)) return false
  }
  return true
}

const filtered = computed(() => enriched.value.filter((q) => matchesExcept(q)))

function resetWallState() {
  wallLimit.value = WALL_STEP
  wallExpanded.value = new Set()
  activeWall.value = ''
}

/** 吸顶状态下展开筛选时，把面板拉回可视区（面板本身不吸顶） */
function toggleFilters() {
  filtersOpen.value = !filtersOpen.value
  if (!filtersOpen.value) return
  nextTick(() => {
    const panel = document.getElementById('wj-qb-filters')
    if (panel && panel.getBoundingClientRect().top < 120) scrollElement(panel)
  })
}

const filters = computed<Record<string, string[]>>({
  get: () => ({
    source: state.value.source,
    theme: state.value.theme,
    dynasty: state.value.dynasty,
    stage: state.value.stage,
  }),
  set: (v) => {
    state.value = {
      ...state.value,
      source: v.source ?? [],
      theme: v.theme ?? [],
      dynasty: v.dynasty ?? [],
      stage: v.stage ?? [],
      page: 1,
    }
    resetWallState()
    maybeScrollToResults()
  },
})

const themeOptions = computed(() =>
  THEMES.map((t) => ({
    value: t,
    label: t,
    count: enriched.value.filter((q) => matchesExcept(q, 'theme') && (q.theme ?? []).includes(t)).length,
  })),
)

const dynastyOptions = computed(() => {
  const names = [...new Set(enriched.value.map((q) => q.dynasty))].sort((a, b) => {
    const ia = DYNASTY_ORDER.indexOf(a)
    const ib = DYNASTY_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  return names.map((d) => ({
    value: d,
    label: d,
    count: enriched.value.filter((q) => matchesExcept(q, 'dynasty') && q.dynasty === d).length,
  }))
})

const stageOptions = computed(() =>
  STAGE_ORDER.map((s) => ({
    value: s,
    label: STAGE_LABEL[s],
    count: enriched.value.filter((q) => matchesExcept(q, 'stage') && q.curriculum?.stage === s).length,
  })),
)

/** 来源维度：古诗文 / 近现代名家 / 演讲语录（计数随其他维度实时变化） */
const sourceOptions = computed(() =>
  SOURCE_ORDER.map((st) => {
    const label = SOURCE_LABEL[st]
    return {
      value: label,
      label,
      count: enriched.value.filter(
        (q) => matchesExcept(q, 'source') && (SOURCE_LABEL[q.sourceType ?? 'classical'] ?? '') === label,
      ).length,
    }
  }).filter((o) => o.count > 0),
)

const groups = computed(() => [
  { key: 'source', label: '来源', options: sourceOptions.value },
  { key: 'theme', label: '主题', options: themeOptions.value },
  { key: 'dynasty', label: '朝代', options: dynastyOptions.value },
  { key: 'stage', label: '学段', options: stageOptions.value },
])

const themeTotal = computed(() => {
  const map: Record<string, number> = {}
  for (const q of enriched.value) {
    for (const t of q.theme ?? []) map[t] = (map[t] ?? 0) + 1
  }
  return map
})

/** 常用主题：按整体出现频次取前 6 个（计数仍随其他维度实时变化） */
const quickThemes = computed(() => {
  const optionMap = new Map(themeOptions.value.map((o) => [o.value, o]))
  return [...THEMES]
    .sort(
      (a, b) =>
        (themeTotal.value[b] ?? 0) - (themeTotal.value[a] ?? 0) ||
        THEMES.indexOf(a) - THEMES.indexOf(b),
    )
    .slice(0, 6)
    .map((v) => optionMap.get(v) ?? { value: v, label: v, count: 0 })
})

// ── 分页与 URL 状态 ──────────────────────────────────────────

const page = computed({
  get: () => state.value.page,
  set: (v: number) => {
    state.value.page = v
  },
})

const query = computed({
  get: () => state.value.q,
  set: (v: string) => {
    state.value.q = v
    state.value.page = 1
    resetWallState()
    maybeScrollToResults()
  },
})

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))

const pageItems = computed(() => {
  const p = Math.min(Math.max(1, state.value.page), pageCount.value)
  return filtered.value.slice((p - 1) * pageSize.value, p * pageSize.value)
})

watch(
  () => [filtered.value.length, pageCount.value, pageSize.value] as const,
  () => {
    if (state.value.page > pageCount.value) state.value.page = pageCount.value
    if (state.value.page < 1) state.value.page = 1
  },
)

const activeCount = computed(
  () => state.value.theme.length + state.value.dynasty.length + state.value.stage.length,
)

const selectedChips = computed<SelectedChip[]>(() => {
  const out: SelectedChip[] = []
  if (state.value.q) out.push({ key: 'q', value: state.value.q, label: `搜索：${state.value.q}`, group: '搜索' })
  const groupLabels: Record<string, string> = { theme: '主题', dynasty: '朝代', stage: '学段' }
  for (const g of groups.value) {
    for (const v of state.value[g.key as 'theme' | 'dynasty' | 'stage'] ?? []) {
      const opt = g.options.find((o) => o.value === v)
      out.push({ key: g.key as SelectedChip['key'], value: v, label: opt?.label ?? v, group: groupLabels[g.key] ?? g.label })
    }
  }
  return out
})

function removeChip(c: SelectedChip) {
  if (c.key === 'q') {
    query.value = ''
    return
  }
  const key = c.key
  filters.value = {
    theme: state.value.theme,
    dynasty: state.value.dynasty,
    stage: state.value.stage,
    [key]: state.value[key].filter((v) => v !== c.value),
  }
}

function toggleTheme(value: string) {
  const cur = new Set(state.value.theme)
  cur.has(value) ? cur.delete(value) : cur.add(value)
  filters.value = {
    theme: [...cur],
    dynasty: state.value.dynasty,
    stage: state.value.stage,
  }
}

function clearAll() {
  state.value = {
    ...state.value,
    q: '',
    theme: [],
    dynasty: [],
    stage: [],
    page: 1,
  }
  resetWallState()
}

// ── 主题墙 ──────────────────────────────────────────────────

const wallLimit = ref(WALL_STEP)
const wallExpanded = ref<Set<string>>(new Set())
const activeWall = ref('')

const wallGroups = computed<WallGroup[]>(() => {
  const map = new Map<string, Enriched[]>()
  const selectedThemes = state.value.theme
  for (const q of filtered.value) {
    const all = q.theme ?? []
    let keys = selectedThemes.length ? all.filter((t) => selectedThemes.includes(t)) : all
    if (!keys.length && !selectedThemes.length) keys = ['其他']
    for (const key of new Set(keys)) {
      const list = map.get(key)
      if (list) list.push(q)
      else map.set(key, [q])
    }
  }
  const rank = (key: string) => {
    const i = THEMES.indexOf(key as (typeof THEMES)[number])
    return i < 0 ? THEMES.length : i
  }
  return [...map.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => b.items.length - a.items.length || rank(a.key) - rank(b.key))
})

const visibleWallGroups = computed(() => wallGroups.value.slice(0, wallLimit.value))
const wallRemaining = computed(() => Math.max(0, wallGroups.value.length - wallLimit.value))

function wallId(key: string) {
  return `wj-qb-wall-${key.replace(/\s+/g, '-')}`
}
function wallTitleId(key: string) {
  return `${wallId(key)}-title`
}
function wallItems(g: WallGroup) {
  return wallExpanded.value.has(g.key) ? g.items : g.items.slice(0, WALL_PER_THEME)
}
function toggleWallGroup(key: string) {
  const next = new Set(wallExpanded.value)
  next.has(key) ? next.delete(key) : next.add(key)
  wallExpanded.value = next
}
function loadMoreWall() {
  wallLimit.value = Math.min(wallGroups.value.length, wallLimit.value + WALL_STEP)
}

async function jumpTo(key: string) {
  const idx = wallGroups.value.findIndex((g) => g.key === key)
  if (idx < 0) return
  if (idx >= wallLimit.value) {
    wallLimit.value = Math.min(wallGroups.value.length, Math.ceil((idx + 1) / WALL_STEP) * WALL_STEP)
  }
  activeWall.value = key
  await nextTick()
  const el = document.getElementById(wallId(key))
  if (!el) return
  scrollElement(el)
  // 平滑滚动期间滚动事件会被节流/忽略的情况：落位后再确认一次高亮
  window.setTimeout(() => {
    if (view.value !== 'wall') return
    const rect = el.getBoundingClientRect()
    if (rect.top >= 0 && rect.top < window.innerHeight * 0.5) activeWall.value = key
  }, 500)
}

function scrollElement(el: Element) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const start = window.scrollY
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  if (reduce) return
  // 部分内嵌/无头浏览器会忽略 smooth 滚动；若 350ms 后仍未移动则立即定位
  window.setTimeout(() => {
    if (Math.abs(window.scrollY - start) >= 2) return
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop || '0') || 0
    const top = window.scrollY + el.getBoundingClientRect().top - margin
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
  }, 350)
}

/** 在长页中改动搜索/筛选时，把结果区拉回吸顶栏下方 */
function maybeScrollToResults() {
  nextTick(() => {
    if (resultsRef.value && resultsRef.value.getBoundingClientRect().top < 110) {
      scrollElement(resultsRef.value)
    }
  })
}

function updateActiveWall() {
  if (view.value !== 'wall') return
  const nodes = [...document.querySelectorAll<HTMLElement>('[data-wall-key]')]
  if (!nodes.length) return
  // 以「在吸顶栏以下可见面积最大」的分组为当前锚点（页底时最后一组也能正确高亮）
  const bound = 160
  let bestKey = nodes[0].dataset.wallKey ?? ''
  let bestArea = -Infinity
  for (const el of nodes) {
    const r = el.getBoundingClientRect()
    const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, bound)
    if (visible > bestArea) {
      bestArea = visible
      bestKey = el.dataset.wallKey ?? bestKey
    }
  }
  if (bestKey && bestKey !== activeWall.value) activeWall.value = bestKey
}

function onWindowScroll() {
  if (view.value !== 'wall') return
  updateActiveWall()
}

watch(visibleWallGroups, async () => {
  if (view.value !== 'wall') return
  await nextTick()
  if (!visibleWallGroups.value.some((g) => g.key === activeWall.value)) {
    activeWall.value = visibleWallGroups.value[0]?.key ?? ''
  }
  updateActiveWall()
})

// 锚点条横向滚动：让当前高亮项始终可见（移动端/窄屏）
watch(activeWall, async () => {
  await nextTick()
  const bar = document.querySelector<HTMLElement>('.wj-qb-anchors')
  const btn = bar?.querySelector<HTMLElement>('.wj-qb-anchor.on')
  if (!bar || !btn) return
  const target = btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2
  if (Math.abs(bar.scrollLeft - target) < 4) return
  bar.scrollTo({ left: Math.max(0, target), behavior: 'auto' })
})

async function chooseView(next: ViewMode) {
  if (view.value === next) return
  view.value = next
  await nextTick()
  if (view.value === 'wall') updateActiveWall()
  if (resultsRef.value && resultsRef.value.getBoundingClientRect().top < 120) {
    scrollElement(resultsRef.value)
  }
}

function onPageChange() {
  nextTick(() => {
    if (resultsRef.value) scrollElement(resultsRef.value)
  })
}

// ── 展开语境 ────────────────────────────────────────────────

function contextFor(q: Enriched): string {
  const raw = contextCache[q.id] ?? q.context
  if (!raw) return ''
  return normalizeForCompare(raw) === normalizeForCompare(q.text) ? '' : raw
}

function replaceBreaks(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  return (clone.textContent ?? '').trim()
}

async function loadContext(q: Enriched) {
  if (q.context || contextCache[q.id] || contextLoading[q.id]) return
  contextLoading[q.id] = true
  contextError[q.id] = ''
  try {
    const route = q.srcPath.replace(/^content\//, '').replace(/\.md$/, '')
    const res = await fetch(encodeURI(`${BASE}${route}.html`))
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const heading = [...doc.querySelectorAll('h2')].find((h) => h.textContent?.trim() === '语境')
    if (!heading) throw new Error('未找到「语境」区块')
    const parts: string[] = []
    for (let el = heading.nextElementSibling; el && el.tagName !== 'H2'; el = el.nextElementSibling) {
      if (el.tagName === 'P') {
        const text = replaceBreaks(el)
        if (text) parts.push(text)
      }
      if (el.tagName === 'BLOCKQUOTE') break
    }
    if (!parts.length) throw new Error('「语境」内容为空')
    contextCache[q.id] = parts.join('\n')
  } catch (err: any) {
    contextError[q.id] = err?.message ?? String(err)
  } finally {
    contextLoading[q.id] = false
  }
}

function toggleContext(q: Enriched) {
  const next = new Set(expanded.value)
  if (next.has(q.id)) {
    next.delete(q.id)
  } else {
    next.add(q.id)
    loadContext(q)
  }
  expanded.value = next
}

// ── 复制 ────────────────────────────────────────────────────

function citeText(q: Enriched): string {
  return `「${q.text}」——${q.citeSource}`
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  if (!ok) throw new Error('execCommand copy failed')
}

async function copyQuote(q: Enriched) {
  const text = citeText(q)
  try {
    if (navigator.clipboard?.writeText) {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise<void>((_, reject) =>
          window.setTimeout(() => reject(new Error('clipboard timeout')), 1200),
        ),
      ])
    } else {
      fallbackCopy(text)
    }
  } catch {
    try {
      fallbackCopy(text)
    } catch {
      window.prompt('复制失败，请手动复制：', text)
      return
    }
  }
  copiedId.value = q.id
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    if (copiedId.value === q.id) copiedId.value = ''
  }, 2000)
}

// ── 键盘 ────────────────────────────────────────────────────

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function onGlobalKeydown(e: KeyboardEvent) {
  if (e.altKey || e.ctrlKey || e.metaKey) return
  if (e.key === '/') {
    if (isTypingTarget(e.target)) return
    e.preventDefault()
    // VitePress 内置搜索也监听 `/`；捕获阶段截停，优先聚焦本页搜索框
    e.stopPropagation()
    searchInput.value?.focus()
    searchInput.value?.select()
    return
  }
  if (e.defaultPrevented) return
  if (
    e.key === 'Escape' &&
    (e.target === searchInput.value || document.activeElement === searchInput.value)
  ) {
    if (query.value) {
      e.preventDefault()
      query.value = ''
    } else {
      searchInput.value?.blur()
    }
  }
}

function clearSearch() {
  query.value = ''
  nextTick(() => searchInput.value?.focus())
}

// ── 数据加载 ────────────────────────────────────────────────

onMounted(async () => {
  // 移动端首次进入默认列表视图；带 ?view= 的深链接尊重用户选择
  const sp = new URLSearchParams(window.location.search)
  if (!sp.has('view') && window.matchMedia('(max-width: 760px)').matches) {
    state.value.view = 'list'
  }

  window.addEventListener('keydown', onGlobalKeydown, true)
  window.addEventListener('scroll', onWindowScroll, { passive: true })

  try {
    const [qRes, pRes, dRes] = await Promise.all([
      fetch(`${BASE}indexes/quotes.json`),
      fetch(`${BASE}indexes/poems.json`),
      fetch(`${BASE}indexes/quotes-detail.json`),
    ])
    if (!qRes.ok) throw new Error(`quotes.json HTTP ${qRes.status}`)
    quotes.value = (await qRes.json()).items ?? []
    if (pRes.ok) poems.value = (await pRes.json()).items ?? []
    if (dRes.ok) details.value = (await dRes.json()).items ?? []
  } catch (err: any) {
    failed.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown, true)
  window.removeEventListener('scroll', onWindowScroll)
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
  <section class="wj-qb" :class="{ 'is-wall': view === 'wall' }" aria-labelledby="wj-qb-title">
    <header class="wj-qb-hero">
      <div class="wj-qb-heading">
        <p class="wj-qb-kicker">QUOTES · 名句库</p>
        <h1 id="wj-qb-title" class="wj-qb-title">名句库</h1>
      </div>
      <p class="wj-qb-lead">
        三种读法：画廊泛读、列表速查、主题墙按写作主题取材。<br />
        点击卡片进词条，语境与适用场景在卡内展开。
      </p>
    </header>

    <div class="wj-qb-toolbar wj-sticky">
      <div class="wj-qb-toolbar-row">
        <div class="wj-qb-searchwrap">
          <svg class="wj-qb-searchicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref="searchInput"
            v-model="query"
            class="wj-qb-search"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="搜索名句、作者、篇名，或全拼/首字母（如 sushi / ss）"
            aria-label="搜索名句"
          />
          <button
            v-if="query"
            type="button"
            class="wj-qb-searchclear"
            aria-label="清空搜索"
            @click="clearSearch"
          >
            ×
          </button>
          <kbd v-else class="wj-qb-kbd" aria-hidden="true">/</kbd>
        </div>

        <div class="wj-qb-views" role="group" aria-label="视图模式">
          <button
            v-for="v in VIEWS"
            :key="v.id"
            type="button"
            class="wj-qb-viewbtn"
            :class="{ on: view === v.id }"
            :aria-pressed="view === v.id"
            @click="chooseView(v.id)"
          >
            {{ v.label }}
          </button>
        </div>

        <button
          type="button"
          class="wj-qb-filterbtn"
          :class="{ on: filtersOpen || activeCount > 0 }"
          :aria-expanded="filtersOpen"
          aria-controls="wj-qb-filters"
          :aria-label="filtersOpen ? '收起筛选面板' : '展开更多筛选'"
          @click="toggleFilters"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          <span>筛选<template v-if="activeCount"> · {{ activeCount }}</template></span>
          <svg class="wj-qb-chev" :class="{ rot: filtersOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      <div
        v-if="view === 'wall' && !loading && !failed && wallGroups.length"
        class="wj-qb-anchors"
        role="navigation"
        aria-label="主题锚点"
      >
        <button
          v-for="g in wallGroups"
          :key="g.key"
          type="button"
          class="wj-chip wj-qb-anchor"
          :class="{ on: activeWall === g.key }"
          :aria-current="activeWall === g.key ? 'true' : undefined"
          @click="jumpTo(g.key)"
        >
          {{ g.key }}<span class="wj-chip-n">{{ g.items.length }}</span>
        </button>
      </div>
    </div>

    <div v-if="!loading && !failed" class="wj-qb-quick">
      <span class="wj-qb-quicklabel">常用主题</span>
      <button
        v-for="t in quickThemes"
        :key="t.value"
        type="button"
        class="wj-chip"
        :class="{ on: state.theme.includes(t.value), zero: t.count === 0 }"
        :aria-pressed="state.theme.includes(t.value)"
        :disabled="t.count === 0"
        @click="toggleTheme(t.value)"
      >
        {{ t.label }}<span class="wj-chip-n">{{ t.count }}</span>
      </button>
      <button
        type="button"
        class="wj-qb-more"
        :aria-expanded="filtersOpen"
        aria-controls="wj-qb-filters"
        @click="toggleFilters"
      >
        {{ filtersOpen ? '收起筛选' : '更多筛选' }}
        <svg class="wj-qb-chev" :class="{ rot: filtersOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>

    <div id="wj-qb-filters" class="wj-qb-collapse" :class="{ open: filtersOpen }" :inert="!filtersOpen">
      <div class="wj-qb-collapse-inner">
        <div v-if="!loading && !failed" class="wj-qb-filterbox">
          <WjFilterBar v-model="filters" :groups="groups" :total="filtered.length" unit="句" />
        </div>
      </div>
    </div>

    <div class="wj-qb-status">
      <span class="wj-qb-count" role="status" aria-live="polite" aria-atomic="true">
        <template v-if="loading">正在载入名句…</template>
        <template v-else-if="failed">名句数据载入失败</template>
        <template v-else>共 <b>{{ filtered.length }}</b> 句</template>
      </span>
      <template v-if="!loading && !failed && selectedChips.length">
        <span class="wj-qb-sellabel">已选</span>
        <button
          v-for="c in selectedChips"
          :key="c.key + ':' + c.value"
          type="button"
          class="wj-chip wj-qb-selchip"
          :aria-label="`移除筛选：${c.group} ${c.label}`"
          @click="removeChip(c)"
        >
          <span class="wj-qb-seltext">{{ c.label }}</span>
          <span class="wj-chip-x" aria-hidden="true">×</span>
        </button>
        <button type="button" class="wj-qb-clear" @click="clearAll">清除全部</button>
      </template>
      <span v-if="!loading && !failed" class="wj-qb-hint" aria-hidden="true">
        按 <kbd>/</kbd> 搜索 · <kbd>Esc</kbd> 清空 · {{ viewLabel }}视图
      </span>
    </div>

    <div ref="resultsRef" class="wj-qb-results">
      <div v-if="loading" class="wj-qb-loading" role="status" aria-live="polite" aria-busy="true">
        <span class="wj-qb-sr">正在加载名句…</span>
        <div class="wj-qb-sk-grid" :class="{ 'is-list': view === 'list' }">
          <div v-for="i in view === 'list' ? 8 : 9" :key="i" class="wj-qb-sk" :class="{ 'is-list': view === 'list' }">
            <span class="wj-qb-sk-line a" /><span class="wj-qb-sk-line b" /><span class="wj-qb-sk-line c" />
          </div>
        </div>
      </div>

      <p v-else-if="failed" class="wj-note">
        名句数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成索引后再访问。
      </p>

      <div v-else-if="!filtered.length" class="wj-empty wj-qb-empty">
        <p class="wj-qb-empty-title">没有符合当前条件的名句</p>
        <p class="wj-qb-empty-sub">试试更宽泛的关键词，或清除部分筛选条件。</p>
        <button type="button" class="wj-qb-btn primary" @click="clearAll">清除筛选</button>
      </div>

      <div v-else :key="view" class="wj-qb-view" :class="`wj-qb-view--${view}`">
        <div v-if="view === 'gallery'" class="wj-grid wj-qb-grid">
          <QuoteCard
            v-for="q in pageItems"
            :key="q.id"
            :quote="q"
            variant="gallery"
            :expanded="expanded.has(q.id)"
            :copied="copiedId === q.id"
            :context="contextFor(q)"
            :context-loading="!!contextLoading[q.id]"
            :context-error="contextError[q.id]"
            @toggle-context="toggleContext"
            @copy="copyQuote"
          />
        </div>

        <div v-else-if="view === 'list'" class="wj-qb-list" role="list">
          <QuoteCard
            v-for="q in pageItems"
            :key="q.id"
            :quote="q"
            variant="list"
            :expanded="expanded.has(q.id)"
            :copied="copiedId === q.id"
            :context="contextFor(q)"
            :context-loading="!!contextLoading[q.id]"
            :context-error="contextError[q.id]"
            @toggle-context="toggleContext"
            @copy="copyQuote"
          />
        </div>

        <template v-else>
          <section
            v-for="g in visibleWallGroups"
            :id="wallId(g.key)"
            :key="g.key"
            class="wj-qb-wallgroup"
            :data-wall-key="g.key"
            :aria-labelledby="wallTitleId(g.key)"
          >
            <header class="wj-qb-wallhead">
              <h2 :id="wallTitleId(g.key)" class="wj-qb-walltitle">{{ g.key }}</h2>
              <span class="wj-qb-wallcount">{{ g.items.length }} 句</span>
              <button
                v-if="g.items.length > WALL_PER_THEME"
                type="button"
                class="wj-qb-linkbtn"
                :aria-expanded="wallExpanded.has(g.key)"
                @click="toggleWallGroup(g.key)"
              >
                {{ wallExpanded.has(g.key) ? '收起本组' : `展开全部 ${g.items.length} 句` }}
              </button>
            </header>
            <div class="wj-grid wj-qb-wallgrid">
              <QuoteCard
                v-for="q in wallItems(g)"
                :key="`${g.key}:${q.id}`"
                :quote="q"
                variant="wall"
                :uid="g.key"
                :allow-expand="false"
                :copied="copiedId === q.id"
                @copy="copyQuote"
              />
            </div>
          </section>

          <div class="wj-qb-wallmore">
            <span class="wj-qb-wallstatus" role="status" aria-live="polite">
              已显示 {{ visibleWallGroups.length }} / {{ wallGroups.length }} 个主题 · 共 {{ filtered.length }} 句
            </span>
            <button v-if="wallRemaining > 0" type="button" class="wj-qb-btn primary" @click="loadMoreWall">
              加载更多主题（还有 {{ wallRemaining }} 个）
            </button>
            <span v-else class="wj-qb-wallend">已显示全部主题</span>
            <span class="wj-qb-wallnote">同一名句可出现在多个主题下</span>
          </div>
        </template>
      </div>

      <WjPager
        v-if="!loading && !failed && filtered.length && view !== 'wall'"
        v-model:page="page"
        v-model:size="pageSize"
        :total="filtered.length"
        :sizes="[12, 24, 48]"
        unit="句"
        @update:page="onPageChange"
      />
    </div>
  </section>
</template>

<style scoped>
/* 少年主题的装饰光斑伪元素会超出视口，导致本页出现横向滚动条；仅在本页裁切横向溢出 */
:global(body:has(.wj-qb)) {
  overflow-x: clip;
}

.wj-qb {
  box-sizing: border-box;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 6px clamp(14px, 2.6vw, 30px) 40px;
}

/* ── 页头（压缩到一行，给名句让出首屏）────────────────── */
.wj-qb-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 0 2px 8px;
}
.wj-qb-kicker {
  margin: 0 0 2px;
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-size: 10.5px;
  letter-spacing: var(--wj-label-tracking);
  line-height: 1.3;
}
.wj-qb-title {
  margin: 0;
  color: var(--wj-ink);
  font-family: var(--wj-font-display);
  font-weight: var(--wj-display-weight, 700);
  font-size: clamp(26px, 3vw, 34px);
  line-height: 1.12;
  letter-spacing: 0.05em;
}
.wj-qb-lead {
  margin: 0 0 2px;
  max-width: 440px;
  color: var(--wj-ink-2);
  font-size: 12.5px;
  line-height: 1.7;
  text-align: right;
}

/* ── 吸顶工具栏 ───────────────────────────────────────── */
.wj-qb-toolbar {
  margin: 0;
  padding: 6px 0 7px;
  background: var(--wj-bg);
  border-bottom: 1px solid var(--wj-line);
}
.wj-qb-toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wj-qb-searchwrap {
  position: relative;
  display: flex;
  flex: 1 1 300px;
  align-items: center;
  min-width: 0;
}
.wj-qb-searchicon {
  position: absolute;
  left: 12px;
  width: 15px;
  height: 15px;
  color: var(--wj-ink-3);
  pointer-events: none;
}
.wj-qb-search {
  box-sizing: border-box;
  width: 100%;
  height: 38px;
  padding: 0 42px 0 35px;
  color: var(--wj-ink);
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  outline: none;
  font-family: var(--wj-font-body);
  font-size: 13.5px;
  transition: border-color 0.16s, box-shadow 0.16s;
}
.wj-qb-search::placeholder {
  color: var(--wj-ink-3);
}
.wj-qb-search:focus {
  border-color: var(--wj-accent);
  box-shadow: 0 0 0 3px var(--wj-accent-tint);
}
.wj-qb-search::-webkit-search-cancel-button {
  display: none;
}
.wj-qb-searchclear {
  position: absolute;
  right: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  color: var(--wj-ink-3);
  background: transparent;
  border: 0;
  border-radius: var(--wj-radius-pill);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.wj-qb-searchclear:hover {
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
.wj-qb-kbd {
  position: absolute;
  right: 9px;
  padding: 1px 6px;
  color: var(--wj-ink-3);
  background: var(--wj-bg-soft);
  border: 1px solid var(--wj-line);
  border-radius: calc(var(--wj-radius-sm) * 0.6);
  font-family: var(--wj-font-mono);
  font-size: 11px;
  line-height: 1.5;
  pointer-events: none;
}

.wj-qb-views {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  box-shadow: var(--wj-shadow);
}
.wj-qb-viewbtn {
  min-height: 30px;
  padding: 6px 10px;
  color: var(--wj-ink-2);
  background: transparent;
  border: 0;
  border-radius: var(--wj-radius-pill);
  font-family: var(--wj-font-display);
  font-size: 12.5px;
  line-height: 1;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.wj-qb-viewbtn:hover {
  color: var(--wj-ink);
  background: var(--wj-bg-soft);
}
.wj-qb-viewbtn.on,
.wj-qb-viewbtn.on:hover {
  color: var(--wj-card);
  background: var(--wj-accent);
}

.wj-qb-filterbtn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  height: 38px;
  padding: 0 12px;
  color: var(--wj-ink-2);
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  font-family: var(--wj-font-display);
  font-size: 12.5px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.wj-qb-filterbtn svg {
  width: 14px;
  height: 14px;
}
.wj-qb-filterbtn:hover {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
}
.wj-qb-filterbtn.on {
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
  border-color: var(--wj-accent);
}
.wj-qb-fcount {
  font-size: 11px;
  opacity: 0.85;
}
.wj-qb-chev {
  width: 12px;
  height: 12px;
  transition: transform 0.18s ease;
}
.wj-qb-chev.rot {
  transform: rotate(180deg);
}

/* 主题墙锚点条（吸顶工具栏第二行） */
.wj-qb-anchors {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  padding: 1px 0 1px;
  overflow-x: auto;
  scrollbar-width: none;
}
.wj-qb-anchors::-webkit-scrollbar {
  display: none;
}
.wj-qb-anchor {
  flex: 0 0 auto;
  min-height: 28px;
  padding: 2px 9px;
  font-size: 11.5px;
}
.wj-qb-anchor .wj-chip-n {
  margin-left: 3px;
}

/* ── 常用主题 + 更多筛选 ──────────────────────────────── */
.wj-qb-quick {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 2px;
  padding: 4px 2px 2px;
  overflow-x: auto;
  scrollbar-width: none;
}
.wj-qb-quick::-webkit-scrollbar {
  display: none;
}
.wj-qb-quicklabel {
  flex: none;
  padding-right: 2px;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-display);
  font-size: 11px;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
.wj-qb-quick .wj-chip {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 3px 11px;
  font-size: 12px;
}
.wj-qb-more {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  padding: 4px 2px;
  color: var(--wj-accent);
  background: none;
  border: 0;
  font-family: var(--wj-font-display);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ── 折叠筛选面板（高度动画）─────────────────────────── */
.wj-qb-collapse {
  display: grid;
  grid-template-rows: 0fr;
  visibility: hidden;
  scroll-margin-top: 160px;
  transition: grid-template-rows 0.22s ease, visibility 0s linear 0.22s;
}
.wj-qb-collapse.open {
  grid-template-rows: 1fr;
  visibility: visible;
  transition: grid-template-rows 0.22s ease;
}
.wj-qb-collapse-inner {
  min-height: 0;
  overflow: hidden;
}
.wj-qb-filterbox {
  margin: 6px 0 2px;
  padding: 10px 12px 6px;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
}
.wj-qb-filterbox :deep(.wj-fb) {
  margin: 0;
  padding: 0;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.wj-qb-filterbox :deep(.wj-fb-selected) {
  display: none;
}
.wj-qb-filterbox :deep(.wj-fb-chips) {
  max-height: none;
  overflow: visible;
}

/* ── 结果计数 / 已选条件 ──────────────────────────────── */
.wj-qb-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 7px;
  min-height: 32px;
  margin-bottom: 9px;
  padding: 5px 2px;
  border-bottom: 1px solid var(--wj-line-soft);
  color: var(--wj-ink-2);
  font-size: 12.5px;
}
.wj-qb-count b {
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
  font-size: 14px;
}
.wj-qb-sellabel {
  color: var(--wj-ink-3);
  font-size: 11px;
  letter-spacing: 0.08em;
}
.wj-qb-selchip {
  min-height: 26px;
  padding: 1px 9px;
  font-size: 11.5px;
}
.wj-qb-seltext {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wj-qb-clear {
  padding: 2px;
  color: var(--wj-accent);
  background: none;
  border: 0;
  font-size: 11.5px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.wj-qb-hint {
  margin-left: auto;
  color: var(--wj-ink-3);
  font-size: 11px;
  white-space: nowrap;
}
.wj-qb-hint kbd {
  padding: 0 4px;
  background: var(--wj-bg-soft);
  border: 1px solid var(--wj-line);
  border-radius: calc(var(--wj-radius-sm) * 0.6);
  font-family: var(--wj-font-mono);
  font-size: 10px;
}

/* ── 结果区与三视图 ───────────────────────────────────── */
.wj-qb-results {
  scroll-margin-top: 140px;
  min-height: 220px;
}
/* 主题墙的吸顶工具栏多了锚点行，滚动定位需要让出更多高度 */
.wj-qb.is-wall .wj-qb-results {
  scroll-margin-top: 172px;
}
.wj-qb.is-wall .wj-qb-collapse {
  scroll-margin-top: 200px;
}
.wj-qb-view {
  animation: wj-qb-fade 0.12s ease both;
}
@keyframes wj-qb-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.wj-qb-grid {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  align-items: start;
}
.wj-qb-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wj-qb-wallgroup {
  margin-top: 22px;
  scroll-margin-top: 170px;
}
.wj-qb-wallgroup:first-child {
  margin-top: 4px;
}
.wj-qb-wallhead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
  padding: 2px 2px 8px;
  border-bottom: 1px solid var(--wj-line);
}
.wj-qb-walltitle {
  position: relative;
  margin: 0;
  padding-left: 12px;
  color: var(--wj-ink);
  font-family: var(--wj-font-display);
  font-weight: var(--wj-display-weight, 700);
  font-size: 21px;
  letter-spacing: 0.08em;
  line-height: 1.3;
}
.wj-qb-walltitle::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.32em;
  width: 4px;
  height: 0.92em;
  background: var(--wj-accent);
}
.wj-qb-wallcount {
  color: var(--wj-ink-3);
  font-size: 12px;
}
.wj-qb-linkbtn {
  margin-left: auto;
  padding: 2px;
  color: var(--wj-accent);
  background: none;
  border: 0;
  font-size: 11.5px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.wj-qb-wallgrid {
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
  align-items: start;
}
.wj-qb-wallmore {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 24px 0 8px;
  padding: 16px;
  border-top: 1px dashed var(--wj-line);
  text-align: center;
}
.wj-qb-wallstatus {
  color: var(--wj-ink-2);
  font-size: 12.5px;
}
.wj-qb-wallend {
  color: var(--wj-ink-3);
  font-size: 11.5px;
}
.wj-qb-wallnote {
  color: var(--wj-ink-3);
  font-size: 10.5px;
}

/* ── 空态 / 按钮 ─────────────────────────────────────── */
.wj-qb-empty {
  margin: 20px 0;
  padding: 32px 20px;
}
.wj-qb-empty-title {
  margin: 0 0 6px;
  color: var(--wj-ink);
  font-family: var(--wj-font-display);
  font-size: 16px;
}
.wj-qb-empty-sub {
  margin: 0 0 14px;
  color: var(--wj-ink-2);
  font-size: 13px;
}
.wj-qb-btn {
  padding: 6px 15px;
  color: var(--wj-ink-2);
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  font-family: var(--wj-font-display);
  font-size: 12.5px;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.wj-qb-btn:hover {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
}
.wj-qb-btn.primary {
  color: var(--wj-card);
  background: var(--wj-accent);
  border-color: var(--wj-accent);
}
.wj-qb-btn.primary:hover {
  background: var(--wj-accent-deep);
  border-color: var(--wj-accent-deep);
}

/* ── 加载骨架 ────────────────────────────────────────── */
.wj-qb-sk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.wj-qb-sk-grid.is-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wj-qb-sk {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 196px;
  padding: 16px;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-top: 3px solid var(--wj-line);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
}
.wj-qb-sk.is-list {
  flex-direction: row;
  align-items: center;
  min-height: 48px;
  padding: 12px 14px;
  border-top: 1px solid var(--wj-line);
  border-left: 3px solid var(--wj-line);
}
.wj-qb-sk-line {
  display: block;
  height: 14px;
  border-radius: var(--wj-radius-sm);
  background: linear-gradient(90deg, var(--wj-bg-soft), var(--wj-line-soft), var(--wj-bg-soft));
  background-size: 200% 100%;
  animation: wj-qb-shimmer 1.4s linear infinite;
}
.wj-qb-sk-line.a {
  width: 82%;
  height: 22px;
  margin: 16px auto 0;
}
.wj-qb-sk-line.b {
  width: 64%;
  height: 22px;
  margin: 0 auto;
}
.wj-qb-sk-line.c {
  width: 46%;
  height: 11px;
  margin: 8px auto 0;
}
.wj-qb-sk.is-list .wj-qb-sk-line.a {
  flex: 1 1 auto;
  width: auto;
  height: 14px;
  margin: 0;
}
.wj-qb-sk.is-list .wj-qb-sk-line.b {
  flex: 0 0 18%;
  width: auto;
  height: 11px;
  margin: 0;
}
.wj-qb-sk.is-list .wj-qb-sk-line.c {
  flex: 0 0 12%;
  width: auto;
  height: 11px;
  margin: 0;
}
@keyframes wj-qb-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.wj-qb-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.wj-qb button:focus-visible,
.wj-qb-filterbox :deep(.wj-chip:focus-visible) {
  outline: 2px solid var(--wj-accent);
  outline-offset: 2px;
}

/* ── 移动端 ──────────────────────────────────────────── */
@media (max-width: 760px) {
  .wj-qb {
    padding: 4px 12px 34px;
  }
  .wj-qb-hero {
    align-items: flex-start;
    padding-bottom: 7px;
  }
  .wj-qb-lead {
    display: none;
  }
  .wj-qb-toolbar {
    padding-top: 4px;
  }
  .wj-qb-searchwrap {
    flex-basis: 100%;
  }
  .wj-qb-views {
    flex: 1 1 auto;
    min-width: 0;
  }
  .wj-qb-views .wj-qb-viewbtn {
    flex: 1 1 0;
    padding-right: 4px;
    padding-left: 4px;
    text-align: center;
  }
  .wj-qb-filterbtn {
    padding: 0 10px;
  }
  .wj-qb-quick {
    display: none;
  }
  .wj-qb-hint {
    display: none;
  }
  .wj-qb-grid,
  .wj-qb-wallgrid {
    grid-template-columns: 1fr;
  }
  .wj-qb-results {
    scroll-margin-top: 168px;
  }
  .wj-qb-collapse {
    scroll-margin-top: 205px;
  }
  .wj-qb-wallgroup {
    scroll-margin-top: 196px;
  }
  .wj-qb.is-wall .wj-qb-results,
  .wj-qb.is-wall .wj-qb-collapse {
    scroll-margin-top: 245px;
  }
  .wj-qb-walltitle {
    font-size: 19px;
  }
  .wj-qb-wallhead {
    flex-wrap: wrap;
    gap: 4px 8px;
  }
  .wj-qb-wallcount {
    margin-right: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wj-qb-collapse,
  .wj-qb-chev,
  .wj-qb-search,
  .wj-qb-btn,
  .wj-qb-filterbtn,
  .wj-qb-viewbtn {
    transition: none;
  }
  .wj-qb-view {
    animation: none;
  }
  .wj-qb-sk-line {
    animation: none;
  }
}
</style>
