<script setup lang="ts">
/**
 * 万卷 · 作者生平时间轴
 *
 * 数据：site/public/indexes/authors.json / poems.json（构建期只读打包，不联网、不编造年份）
 * 主视图为 CSS 绝对定位的生命线甘特图：横轴为公元纪年，每位作者一条生命线，按生年纵向堆叠。
 * 无生卒年者不进入时间轴，只在「生卒待考」视图按朝代归档；仅单侧年份者以虚线 + ? 标出。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import authorsRaw from '../../../public/indexes/authors.json'
import poemsRaw from '../../../public/indexes/poems.json'

type Author = {
  id: string
  name: string
  courtesy: string | null
  pseudonym: string | null
  birth: number | null
  death: number | null
  dynasty: string
  school: string | null
  masters: string[]
  friends: string[]
  tags: string[]
  srcPath: string
}

type Poem = {
  id: string
  title: string
  author: string
  dynasty: string
  form: string
  tune?: string | null
  genre: string
  curriculum?: { stage?: string; grade?: number; semester?: string | null } | null
  srcPath: string
}

type DynastyMeta = { name: string; start: number; end: number; color: string }

const AUTHORS = ((authorsRaw as unknown as { items: Author[] }).items ?? []) as Author[]
const POEMS = ((poemsRaw as unknown as { items: Poem[] }).items ?? []) as Poem[]
const BASE = import.meta.env.BASE_URL

const STAGE_LABEL: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中' }

/** 标准朝代区间（仅用于顶部色带的横向定位；作者归属仍以 authors.json 的 dynasty 字段为准） */
const DYNASTY_META: DynastyMeta[] = [
  { name: '先秦', start: -1046, end: -221, color: 'var(--wj-chart-6)' },
  { name: '秦', start: -221, end: -206, color: 'color-mix(in srgb, var(--wj-chart-3) 55%, var(--wj-chart-8))' },
  { name: '汉', start: -206, end: 220, color: 'var(--wj-chart-5)' },
  { name: '三国', start: 220, end: 280, color: 'var(--wj-chart-7)' },
  { name: '魏晋', start: 280, end: 420, color: 'var(--wj-chart-8)' },
  { name: '南北朝', start: 420, end: 589, color: 'var(--wj-chart-3)' },
  { name: '唐', start: 618, end: 907, color: 'var(--wj-chart-1)' },
  { name: '五代', start: 907, end: 960, color: 'var(--wj-chart-3)' },
  { name: '宋', start: 960, end: 1271, color: 'var(--wj-chart-4)' },
  { name: '元', start: 1271, end: 1368, color: 'var(--wj-chart-2)' },
  { name: '明', start: 1368, end: 1644, color: 'var(--wj-chart-7)' },
  { name: '清', start: 1644, end: 1912, color: 'var(--wj-chart-6)' },
  { name: '近现代', start: 1912, end: 1949, color: 'var(--wj-chart-5)' },
]
const DYNASTY_ORDER = DYNASTY_META.map((d) => d.name)
const DYNASTY_MAP = new Map(DYNASTY_META.map((d) => [d.name, d]))

/** 只保留真实存在于数据中的朝代，未知朝代追加到末尾 */
function dynastyIndex(name: string): number {
  const i = DYNASTY_ORDER.indexOf(name)
  return i < 0 ? 999 : i
}
function dynColor(name: string): string {
  return DYNASTY_MAP.get(name)?.color ?? 'var(--wj-chart-3)'
}
function dynRange(name: string): string {
  const m = DYNASTY_MAP.get(name)
  return m ? `${fmtYear(m.start)}—${fmtYear(m.end)}` : ''
}

const bothCount = AUTHORS.filter((a) => a.birth != null && a.death != null).length
const unknownAuthors = AUTHORS.filter((a) => a.birth == null && a.death == null)
const datedAuthors = AUTHORS.filter((a) => a.birth != null || a.death != null)

/** 横轴：所有可考年份的最小值到最大值（含仅有单侧年份者） */
const knownYears = datedAuthors.flatMap((a) => [a.birth, a.death]).filter((y): y is number => y != null)
const domainStart = knownYears.length ? Math.min(...knownYears) : 0
const domainEnd = knownYears.length ? Math.max(...knownYears) : 1
const spanYears = domainEnd - domainStart

const rows = computed(() =>
  [...datedAuthors].sort((a, b) => {
    const ay = a.birth ?? a.death ?? 0
    const by = b.birth ?? b.death ?? 0
    if (ay !== by) return ay - by
    const ad = a.death ?? 9999
    const bd = b.death ?? 9999
    if (ad !== bd) return ad - bd
    return a.name.localeCompare(b.name, 'zh')
  }),
)

const worksByAuthor = computed(() => {
  const map = new Map<string, Poem[]>()
  for (const p of POEMS) {
    const list = map.get(p.author)
    if (list) list.push(p)
    else map.set(p.author, [p])
  }
  return map
})
function workCount(name: string): number {
  return worksByAuthor.value.get(name)?.length ?? 0
}
const linkedPoemCount = computed(() => AUTHORS.reduce((sum, a) => sum + workCount(a.name), 0))

const authorByName = computed(() => new Map(AUTHORS.map((a) => [a.name, a])))

const timelineDynastyCounts = computed(() => {
  const map = new Map<string, number>()
  for (const a of datedAuthors) map.set(a.dynasty, (map.get(a.dynasty) ?? 0) + 1)
  return map
})
const dynastyChips = computed(() =>
  DYNASTY_META.filter((m) => (timelineDynastyCounts.value.get(m.name) ?? 0) > 0).map((m) => ({
    ...m,
    count: timelineDynastyCounts.value.get(m.name) ?? 0,
  })),
)

const dynastyGroups = computed(() => {
  const map = new Map<string, Author[]>()
  for (const a of AUTHORS) {
    const list = map.get(a.dynasty)
    if (list) list.push(a)
    else map.set(a.dynasty, [a])
  }
  return [...map.entries()]
    .sort((a, b) => dynastyIndex(a[0]) - dynastyIndex(b[0]) || a[0].localeCompare(b[0], 'zh'))
    .map(([name, list]) => {
      const sorted = [...list].sort((a, b) => {
        const ay = a.birth ?? a.death ?? 9999
        const by = b.birth ?? b.death ?? 9999
        if (ay !== by) return ay - by
        return a.name.localeCompare(b.name, 'zh')
      })
      const known = sorted.filter((a) => a.birth != null || a.death != null)
      const years = known.flatMap((a) => [a.birth, a.death]).filter((y): y is number => y != null)
      return {
        name,
        color: dynColor(name),
        authors: sorted,
        datedCount: known.length,
        range: years.length ? `${fmtYear(Math.min(...years))}—${fmtYear(Math.max(...years))}` : '',
      }
    })
})

const unknownGroups = computed(() => {
  const map = new Map<string, Author[]>()
  for (const a of unknownAuthors) {
    const list = map.get(a.dynasty)
    if (list) list.push(a)
    else map.set(a.dynasty, [a])
  }
  return [...map.entries()]
    .sort((a, b) => dynastyIndex(a[0]) - dynastyIndex(b[0]) || a[0].localeCompare(b[0], 'zh'))
    .map(([name, list]) => ({
      name,
      color: dynColor(name),
      authors: [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    }))
})

/* ---------------- 视图与 URL ---------------- */
const VIEWS = ['timeline', 'dynasty', 'unknown'] as const
type ViewKey = (typeof VIEWS)[number]
const view = ref<ViewKey>('timeline')
const viewTabs = computed(() => [
  { key: 'timeline' as const, label: '时间轴', note: `${rows.value.length} 位有年份` },
  { key: 'dynasty' as const, label: '朝代分组', note: `${AUTHORS.length} 位` },
  { key: 'unknown' as const, label: '生卒待考', note: `${unknownAuthors.length} 位` },
])

function applyView(raw: string | null) {
  if (raw && (VIEWS as readonly string[]).includes(raw)) view.value = raw as ViewKey
}
function syncFromUrl() {
  if (typeof window === 'undefined') return
  applyView(new URLSearchParams(window.location.search).get('view'))
}
function setView(next: ViewKey) {
  view.value = next
  hideTip()
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set('view', next)
  window.history.replaceState(window.history.state, '', url.toString())
}
function onTabKey(event: KeyboardEvent, index: number) {
  const key = event.key
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
  event.preventDefault()
  let next = index
  if (key === 'ArrowLeft') next = (index - 1 + VIEWS.length) % VIEWS.length
  if (key === 'ArrowRight') next = (index + 1) % VIEWS.length
  if (key === 'Home') next = 0
  if (key === 'End') next = VIEWS.length - 1
  setView(VIEWS[next])
  nextTick(() => document.getElementById(`wj-tl-tab-${VIEWS[next]}`)?.focus())
}

/* ---------------- 时间刻度与缩放 ---------------- */
const ZOOMS = [1, 1.5, 2] as const
type Zoom = (typeof ZOOMS)[number]
const BASE_PX_PER_YEAR = 0.46
const LABEL_W = 150
const zoom = ref<Zoom>(1)
const trackWidth = computed(() => Math.round(spanYears * BASE_PX_PER_YEAR * zoom.value))
const innerWidth = computed(() => LABEL_W + trackWidth.value)
const pxPerYear = computed(() => trackWidth.value / spanYears)
const xOf = (year: number) => (year - domainStart) * pxPerYear.value

const ticks = computed(() => {
  const list: { year: number; x: number; label: string; align: string }[] = []
  const first = Math.ceil(domainStart / 100) * 100
  for (let y = first; y <= domainEnd; y += 100) {
    const x = xOf(y)
    list.push({
      year: y,
      x,
      label: fmtYear(y),
      align: x < 26 ? 'start' : x > trackWidth.value - 26 ? 'end' : 'center',
    })
  }
  return list
})

const eraSegments = computed(() =>
  DYNASTY_META.filter((m) => (timelineDynastyCounts.value.get(m.name) ?? 0) > 0 && m.end > domainStart && m.start < domainEnd).map(
    (m) => {
      const start = Math.max(m.start, domainStart)
      const end = Math.min(m.end, domainEnd)
      const left = (start - domainStart) * pxPerYear.value
      const width = Math.max((end - start) * pxPerYear.value, 2)
      return {
        ...m,
        left,
        width,
        count: timelineDynastyCounts.value.get(m.name) ?? 0,
        showLabel: width >= 34,
      }
    },
  ),
)

const mobileTicks = computed(() => {
  const values = [domainStart, Math.round(domainStart + spanYears / 3), Math.round(domainStart + (spanYears * 2) / 3), domainEnd]
  return values.map((year) => ({
    year,
    label: fmtYear(year),
    left: ((year - domainStart) / spanYears) * 100,
  }))
})

/* ---------------- 朝代高亮 ---------------- */
const activeDynasty = ref<string | null>(null)
const activeDynastyCount = computed(() =>
  activeDynasty.value ? (timelineDynastyCounts.value.get(activeDynasty.value) ?? 0) : 0,
)
function toggleDynasty(name: string) {
  activeDynasty.value = activeDynasty.value === name ? null : name
  hideTip()
}
function isDim(a: Author): boolean {
  return !!activeDynasty.value && a.dynasty !== activeDynasty.value
}

/* ---------------- 作者卡 ---------------- */
const selectedName = ref<string | null>(null)
const selected = computed(() => AUTHORS.find((a) => a.name === selectedName.value) ?? null)
const sideRef = ref<HTMLElement | null>(null)
const selectedWorks = computed(() => (selected.value ? worksByAuthor.value.get(selected.value.name) ?? [] : []))
const workGroups = computed(() => {
  const map = new Map<string, Poem[]>()
  for (const p of selectedWorks.value) {
    const list = map.get(p.form)
    if (list) list.push(p)
    else map.set(p.form, [p])
  }
  return [...map.entries()]
    .map(([form, items]) => ({ form, items: [...items].sort((a, b) => a.title.localeCompare(b.title, 'zh')) }))
    .sort((a, b) => b.items.length - a.items.length || a.form.localeCompare(b.form, 'zh'))
})
function selectAuthor(a: Author) {
  selectedName.value = a.name
  hideTip()
  if (typeof window === 'undefined') return
  if (window.innerWidth < 1080) {
    // 等作者卡渲染并完成布局后再滚动，否则目标位置可能还是空的
    window.setTimeout(() => {
      const target = sideRef.value ?? document.getElementById('wj-tl-side')
      if (!target) return
      // 使用即时滚动：部分内嵌浏览器会忽略平滑滚动，且即时滚动本身就是 reduced-motion 友好的
      target.scrollIntoView({ behavior: 'auto', block: 'start' })
    }, 60)
  }
}
function clearSelection() {
  selectedName.value = null
}

/* ---------------- 悬停浮层 ---------------- */
const hovered = ref<Author | null>(null)
const tipPos = ref({ x: 0, y: 0 })
let hideTimer: ReturnType<typeof setTimeout> | null = null
function placeTip(x: number, y: number) {
  if (typeof window === 'undefined') return
  const w = 292
  const h = 206
  tipPos.value = {
    x: Math.max(8, Math.min(x, window.innerWidth - w - 10)),
    y: Math.max(8, Math.min(y, window.innerHeight - h - 10)),
  }
}
function showTip(a: Author, event: MouseEvent) {
  hovered.value = a
  placeTip(event.clientX + 16, event.clientY + 14)
}
function showTipAt(a: Author, event: FocusEvent) {
  hovered.value = a
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  placeTip(rect.right + 14, rect.top - 10)
}
function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    hovered.value = null
  }, 160)
}
function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}
function hideTip() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  hovered.value = null
}

/* ---------------- 格式化 ---------------- */
function fmtYear(y: number): string {
  return y < 0 ? `前${Math.abs(y)}` : String(y)
}
function lifeText(a: Author): string {
  if (a.birth != null && a.death != null) return `${fmtYear(a.birth)}—${fmtYear(a.death)}`
  if (a.birth != null) return `${fmtYear(a.birth)}—卒年待考`
  if (a.death != null) return `生年待考—${fmtYear(a.death)}`
  return '生卒待考'
}
function lifeShort(a: Author): string {
  if (a.birth != null && a.death != null) return `${fmtYear(a.birth)}—${fmtYear(a.death)}`
  if (a.birth != null) return `${fmtYear(a.birth)}—?`
  if (a.death != null) return `?—${fmtYear(a.death)}`
  return '待考'
}
function styleName(a: Author): string {
  const parts: string[] = []
  if (a.courtesy) parts.push(`字${a.courtesy}`)
  if (a.pseudonym) parts.push(`号${a.pseudonym}`)
  return parts.join(' · ')
}
function stageText(p: Poem): string {
  const c = p.curriculum
  if (!c?.stage) return ''
  if (c.stage === 'senior') {
    return c.grade === 10 ? '高一' : c.grade === 11 ? '高二' : c.grade === 12 ? '高三' : '高中'
  }
  if (c.stage === 'junior') {
    const names = ['初一', '初二', '初三']
    return c.grade ? names[c.grade - 7] ?? `${c.grade} 年级` : '初中'
  }
  if (c.stage === 'primary') {
    const names = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级']
    return c.grade ? names[c.grade - 1] ?? `${c.grade} 年级` : '小学'
  }
  return STAGE_LABEL[c.stage] ?? c.stage
}
function authorHref(name: string): string {
  return encodeURI(`${BASE}authors/${name}`)
}
function poemHref(p: Poem): string {
  return encodeURI(`${BASE}${p.srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}
function barAria(a: Author): string {
  return `${a.name}，${lifeText(a)}，${a.dynasty}，收录作品 ${workCount(a.name)} 篇。按回车查看作者卡。`
}

/* ---------------- 生命线几何 ---------------- */
const MIN_BAR_PX = 6
function barStyle(a: Author) {
  if (a.birth != null && a.death != null) {
    const left = xOf(a.birth)
    const width = Math.max(xOf(a.death) - left, MIN_BAR_PX)
    return { left: `${left}px`, width: `${width}px` }
  }
  if (a.birth != null) return { left: `${xOf(a.birth)}px`, width: '16px' }
  const death = a.death ?? domainStart
  return { left: `${Math.max(xOf(death) - 16, 0)}px`, width: '16px' }
}
function mobileBarStyle(a: Author) {
  if (a.birth != null && a.death != null) {
    const left = ((a.birth - domainStart) / spanYears) * 100
    const width = Math.max(((a.death - a.birth) / spanYears) * 100, 1.4)
    return { left: `${left}%`, width: `${width}%` }
  }
  if (a.birth != null) return { left: `${((a.birth - domainStart) / spanYears) * 100}%`, width: '1.7%' }
  const death = a.death ?? domainStart
  return { left: `${Math.max(((death - domainStart) / spanYears) * 100 - 1.7, 0)}%`, width: '1.7%' }
}

const spanLabel = computed(() => `${fmtYear(domainStart)}—${fmtYear(domainEnd)}`)

/* ---------------- 生命周期 ---------------- */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    hideTip()
    selectedName.value = null
  }
}
onMounted(() => {
  syncFromUrl()
  window.addEventListener('popstate', syncFromUrl)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('popstate', syncFromUrl)
  window.removeEventListener('keydown', onKeydown)
  if (hideTimer) clearTimeout(hideTimer)
})
</script>

<template>
  <div class="wj-tl">
    <header class="wj-tl-hero">
      <p class="wj-tl-kicker">万卷 · 作者年表</p>
      <h1 class="wj-tl-title">作者生平时间轴</h1>
      <p class="wj-tl-lead">
        把 <b>{{ AUTHORS.length }} 位作者</b>放回他们活过的年代：一条生命线就是一生，
        点开即可看到生平师友与本站收录的全部作品。只按真实生卒年绘制，不为待考者补年份。
      </p>
      <dl class="wj-tl-stats">
        <div class="wj-tl-stat">
          <dt>作者</dt>
          <dd>{{ AUTHORS.length }}</dd>
        </div>
        <div class="wj-tl-stat">
          <dt>有生卒年</dt>
          <dd>{{ bothCount }}</dd>
        </div>
        <div class="wj-tl-stat">
          <dt>时间跨度</dt>
          <dd>{{ spanYears }}<span class="wj-tl-unit">年</span></dd>
        </div>
      </dl>
      <p class="wj-tl-stat-note">
        横轴按可考年份 <b>{{ spanLabel }}</b> 绘制；{{ bothCount }} 位生卒俱全，另有
        {{ datedAuthors.length - bothCount }} 位仅存生年或卒年，以虚线标出。
        {{ unknownAuthors.length }} 位生卒待考，单独归档。
      </p>
    </header>

    <div class="wj-tl-switch" role="tablist" aria-label="切换时间轴视图">
      <button
        v-for="(tab, i) in viewTabs"
        :id="`wj-tl-tab-${tab.key}`"
        :key="tab.key"
        type="button"
        role="tab"
        class="wj-tl-tab"
        :class="{ on: view === tab.key }"
        :aria-selected="view === tab.key"
        :tabindex="view === tab.key ? 0 : -1"
        aria-controls="wj-tl-panel"
        @click="setView(tab.key)"
        @keydown="onTabKey($event, i)"
      >
        <span class="wj-tl-tab-label">{{ tab.label }}</span>
        <span class="wj-tl-tab-note">{{ tab.note }}</span>
      </button>
    </div>

    <div class="wj-tl-main">
      <div id="wj-tl-panel" class="wj-tl-panel" role="tabpanel" :aria-labelledby="`wj-tl-tab-${view}`">
        <!-- ============ 时间轴 ============ -->
        <template v-if="view === 'timeline'">
          <div class="wj-tl-toolbar">
            <div class="wj-tl-zoom" role="group" aria-label="时间轴缩放">
              <span class="wj-tl-tool-label">缩放</span>
              <button
                v-for="z in ZOOMS"
                :key="z"
                type="button"
                class="wj-tl-zoom-btn"
                :class="{ on: zoom === z }"
                :aria-pressed="zoom === z"
                @click="zoom = z"
              >
                {{ z }}x
              </button>
            </div>
            <div class="wj-tl-chips" role="group" aria-label="按朝代高亮作者">
              <button
                v-for="d in dynastyChips"
                :key="d.name"
                type="button"
                class="wj-tl-chip"
                :class="{ on: activeDynasty === d.name }"
                :style="{ '--dyn': d.color }"
                :aria-pressed="activeDynasty === d.name"
                :title="`${d.name} · ${d.count} 位有年份的作者`"
                @click="toggleDynasty(d.name)"
              >
                <i class="wj-tl-chip-dot" aria-hidden="true"></i>{{ d.name }}
                <span>{{ d.count }}</span>
              </button>
            </div>
            <p v-if="activeDynasty" class="wj-tl-filter-note" aria-live="polite">
              已高亮 <b>{{ activeDynasty }}</b> · {{ activeDynastyCount }} 位
              <button type="button" class="wj-tl-clear" @click="activeDynasty = null">取消</button>
            </p>
          </div>

          <!-- 桌面：生命线甘特图 -->
          <div class="wj-tl-chart wj-tl-desktop">
            <div class="wj-tl-scroll" @scroll="hideTip">
              <div class="wj-tl-inner" :style="{ width: `${innerWidth}px` }">
                <div class="wj-tl-axis">
                  <div class="wj-tl-corner">
                    <span>作者</span>
                    <span>生卒</span>
                  </div>
                  <div class="wj-tl-axis-track" :style="{ width: `${trackWidth}px` }">
                    <div class="wj-tl-band" aria-label="朝代色带">
                      <button
                        v-for="seg in eraSegments"
                        :key="seg.name"
                        type="button"
                        class="wj-tl-era"
                        :class="{ on: activeDynasty === seg.name, dim: activeDynasty && activeDynasty !== seg.name }"
                        :style="{ left: `${seg.left}px`, width: `${seg.width}px`, '--dyn': seg.color }"
                        :aria-pressed="activeDynasty === seg.name"
                        :aria-label="`${seg.name}，${seg.count} 位有年份的作者，${dynRange(seg.name)}`"
                        :title="`${seg.name} · ${seg.count} 位 · ${dynRange(seg.name)}`"
                        @click="toggleDynasty(seg.name)"
                      >
                        <span v-if="seg.showLabel">{{ seg.name }}</span>
                      </button>
                    </div>
                    <div class="wj-tl-ticks" aria-hidden="true">
                      <span
                        v-for="tick in ticks"
                        :key="tick.year"
                        class="wj-tl-tick"
                        :class="`al-${tick.align}`"
                        :style="{ left: `${tick.x}px` }"
                      >
                        <i></i><b>{{ tick.label }}</b>
                      </span>
                    </div>
                  </div>
                </div>

                <div class="wj-tl-body">
                  <div class="wj-tl-grid" :style="{ left: `${LABEL_W}px`, width: `${trackWidth}px` }" aria-hidden="true">
                    <span v-for="tick in ticks" :key="tick.year" :style="{ left: `${tick.x}px` }"></span>
                  </div>
                  <div
                    v-for="a in rows"
                    :key="a.id"
                    class="wj-tl-row"
                    :class="{ sel: selectedName === a.name, dim: isDim(a) }"
                    :style="{ '--dyn': dynColor(a.dynasty) }"
                  >
                    <div class="wj-tl-name" :title="`${a.name} · ${lifeShort(a)}`">
                      <span class="wj-tl-name-main">{{ a.name }}</span>
                      <span class="wj-tl-name-date">{{ lifeShort(a) }}</span>
                    </div>
                    <div class="wj-tl-track" :style="{ width: `${trackWidth}px` }">
                      <button
                        type="button"
                        class="wj-tl-life"
                        :class="{
                          'is-selected': selectedName === a.name,
                          'is-partial': a.birth == null || a.death == null,
                          'partial-start': a.birth == null,
                          'partial-end': a.birth != null && a.death == null,
                        }"
                        :style="barStyle(a)"
                        :aria-label="barAria(a)"
                        :aria-pressed="selectedName === a.name"
                        @click="selectAuthor(a)"
                        @mouseenter="showTip(a, $event)"
                        @mouseleave="scheduleHide"
                        @focus="showTipAt(a, $event)"
                        @blur="scheduleHide"
                      >
                        <span class="wj-tl-life-year" v-if="a.birth != null">{{ fmtYear(a.birth) }}</span>
                        <span class="wj-tl-life-year end" v-if="a.death != null">{{ fmtYear(a.death) }}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <p class="wj-tl-chart-foot">
              共 {{ rows.length }} 条生命线 · 按生年排序 · 虚线为单侧年份 · 横向滚动查看放大后的时间轴
            </p>
          </div>

          <!-- 窄屏：纵向列表 + 比例条 -->
          <div class="wj-tl-mobile">
            <div class="wj-tl-mobile-head">
              <div class="wj-tl-mobile-title">
                <b>生命线比例</b><span>{{ spanLabel }}</span>
              </div>
              <div class="wj-tl-mobile-scale" aria-hidden="true">
                <span v-for="t in mobileTicks" :key="t.year" :style="{ left: `${t.left}%` }">{{ t.label }}</span>
              </div>
            </div>
            <div class="wj-tl-mobile-list">
              <button
                v-for="a in rows"
                :key="a.id"
                type="button"
                class="wj-tl-mrow"
                :class="{ sel: selectedName === a.name, dim: isDim(a) }"
                :style="{ '--dyn': dynColor(a.dynasty) }"
                :aria-pressed="selectedName === a.name"
                @click="selectAuthor(a)"
              >
                <span class="wj-tl-mrow-top">
                  <b>{{ a.name }}</b>
                  <em>{{ lifeShort(a) }}</em>
                  <i>{{ a.dynasty }}</i>
                  <span class="wj-tl-mrow-w">{{ workCount(a.name) }} 篇</span>
                </span>
                <span class="wj-tl-mtrack">
                  <span
                    class="wj-tl-mbar"
                    :class="{ 'is-partial': a.birth == null || a.death == null }"
                    :style="mobileBarStyle(a)"
                  ></span>
                </span>
              </button>
            </div>
            <p class="wj-tl-chart-foot">点按作者查看作者卡与作品；再点「生卒待考」查看无年份作者。</p>
          </div>
        </template>

        <!-- ============ 朝代分组 ============ -->
        <template v-else-if="view === 'dynasty'">
          <p class="wj-tl-view-intro">
            按朝代归档全部 {{ AUTHORS.length }} 位作者；卡片显示字、生卒与本站收录作品数。点击卡片查看作者卡。
          </p>
          <div class="wj-tl-dynasties">
            <section
              v-for="g in dynastyGroups"
              :key="g.name"
              class="wj-tl-dynasty"
              :style="{ '--dyn': g.color }"
            >
              <header class="wj-tl-dynasty-head">
                <div>
                  <h2><i aria-hidden="true"></i>{{ g.name }}</h2>
                  <p>
                    {{ g.authors.length }} 位 · 生卒可考 {{ g.datedCount }} 位
                    <span v-if="g.range">· 可考年份 {{ g.range }}</span>
                  </p>
                </div>
                <span class="wj-tl-dynasty-bar" aria-hidden="true"></span>
              </header>
              <div class="wj-tl-author-grid">
                <button
                  v-for="a in g.authors"
                  :key="a.id"
                  type="button"
                  class="wj-tl-author-chip"
                  :class="{ on: selectedName === a.name, unknown: a.birth == null && a.death == null }"
                  :aria-pressed="selectedName === a.name"
                  @click="selectAuthor(a)"
                >
                  <span class="wj-tl-chip-name">{{ a.name }}</span>
                  <span class="wj-tl-chip-sub" v-if="a.courtesy">字{{ a.courtesy }}</span>
                  <span class="wj-tl-chip-life">{{ lifeText(a) }}</span>
                  <span class="wj-tl-chip-works">{{ workCount(a.name) }} 篇</span>
                </button>
              </div>
            </section>
          </div>
        </template>

        <!-- ============ 生卒待考 ============ -->
        <template v-else>
          <p class="wj-tl-view-intro">
            以下 <b>{{ unknownAuthors.length }} 位</b>作者生卒年待考。本页不为他们补写年份，只按朝代归档；
            作品仍可在作者卡中按体裁查看。
          </p>
          <div class="wj-tl-unknown">
            <section
              v-for="g in unknownGroups"
              :key="g.name"
              class="wj-tl-unknown-group"
              :style="{ '--dyn': g.color }"
            >
              <header>
                <h2>{{ g.name }}</h2>
                <span>{{ g.authors.length }} 位</span>
              </header>
              <div class="wj-tl-author-grid">
                <button
                  v-for="a in g.authors"
                  :key="a.id"
                  type="button"
                  class="wj-tl-author-chip unknown"
                  :class="{ on: selectedName === a.name }"
                  :aria-pressed="selectedName === a.name"
                  @click="selectAuthor(a)"
                >
                  <span class="wj-tl-chip-name">{{ a.name }}</span>
                  <span class="wj-tl-chip-sub" v-if="a.courtesy">字{{ a.courtesy }}</span>
                  <span class="wj-tl-chip-life">生卒待考</span>
                  <span class="wj-tl-chip-works">{{ workCount(a.name) }} 篇</span>
                </button>
              </div>
            </section>
          </div>
        </template>
      </div>

      <!-- ============ 作者卡 ============ -->
      <aside id="wj-tl-side" ref="sideRef" class="wj-tl-side" aria-live="polite" :class="{ empty: !selected }">
        <article v-if="selected" class="wj-tl-card" :style="{ '--dyn': dynColor(selected.dynasty) }">
          <div class="wj-tl-card-top">
            <span class="wj-tl-dyn-tag">{{ selected.dynasty }}</span>
            <button type="button" class="wj-tl-close" aria-label="关闭作者卡" @click="clearSelection">×</button>
          </div>
          <h2 class="wj-tl-card-name">{{ selected.name }}</h2>
          <p v-if="styleName(selected)" class="wj-tl-card-alias">{{ styleName(selected) }}</p>
          <p class="wj-tl-card-life">
            {{ lifeText(selected) }}
            <span class="wj-tl-card-works-n">{{ workCount(selected.name) }} 篇作品</span>
          </p>

          <dl class="wj-tl-meta">
            <div v-if="selected.school">
              <dt>流派</dt>
              <dd>{{ selected.school }}</dd>
            </div>
            <div v-if="selected.tags.length">
              <dt>标签</dt>
              <dd class="wj-tl-tags">
                <span v-for="tag in selected.tags" :key="tag">{{ tag }}</span>
              </dd>
            </div>
            <div v-if="selected.masters.length">
              <dt>师承</dt>
              <dd class="wj-tl-links">
                <template v-for="name in selected.masters" :key="`m-${name}`">
                  <a v-if="authorByName.get(name)" :href="authorHref(name)">{{ name }}</a>
                  <span v-else>{{ name }}</span>
                </template>
              </dd>
            </div>
            <div v-if="selected.friends.length">
              <dt>交游</dt>
              <dd class="wj-tl-links">
                <template v-for="name in selected.friends" :key="`f-${name}`">
                  <a v-if="authorByName.get(name)" :href="authorHref(name)">{{ name }}</a>
                  <span v-else>{{ name }}</span>
                </template>
              </dd>
            </div>
          </dl>

          <a class="wj-tl-author-link" :href="authorHref(selected.name)">查看作者页 <span aria-hidden="true">→</span></a>

          <section class="wj-tl-works">
            <h3>全部作品 <span>{{ selectedWorks.length }} 篇</span></h3>
            <p v-if="!selectedWorks.length" class="wj-tl-works-empty">本站暂未收录该作者作品。</p>
            <div v-for="g in workGroups" :key="g.form" class="wj-tl-work-group">
              <h4>{{ g.form }} <span>{{ g.items.length }}</span></h4>
              <ul>
                <li v-for="p in g.items" :key="p.id">
                  <a :href="poemHref(p)">{{ p.title }}</a>
                  <span class="wj-tl-work-genre">{{ p.genre }}</span>
                  <span v-if="stageText(p)" class="wj-tl-work-stage">{{ stageText(p) }}</span>
                </li>
              </ul>
            </div>
          </section>
        </article>

        <div v-else class="wj-tl-side-empty">
          <p class="wj-tl-side-kicker">作者卡</p>
          <h2>点开一条生命线</h2>
          <p>作者卡会显示姓名、字、号、生卒、朝代、流派、师承与交游，并把本站收录的作品按体裁分组列出。</p>
          <ul class="wj-tl-side-tips">
            <li><span>悬停</span>生命线查看速览</li>
            <li><span>点击</span>锁定作者并展开作品</li>
            <li><span>Tab</span>聚焦 / <span>Enter</span>选中</li>
          </ul>
        </div>
      </aside>
    </div>

    <p class="wj-tl-foot">
      数据来自 <code>/indexes/authors.json</code>（{{ AUTHORS.length }} 位）与
      <code>/indexes/poems.json</code>（{{ POEMS.length }} 篇）。生卒年只采用索引中的真实值，缺项不作推测；
      {{ linkedPoemCount }} 篇可归入作者卡，其余为《论语》等集体署名或尚未建作者页的作品。
    </p>

    <!-- 悬停浮层 -->
    <div
      v-if="hovered"
      class="wj-tl-tip"
      role="status"
      :style="{ left: `${tipPos.x}px`, top: `${tipPos.y}px`, '--dyn': dynColor(hovered.dynasty) }"
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide"
    >
      <div class="wj-tl-tip-head">
        <b>{{ hovered.name }}</b>
        <span>{{ hovered.dynasty }}</span>
      </div>
      <p v-if="styleName(hovered)" class="wj-tl-tip-alias">{{ styleName(hovered) }}</p>
      <p class="wj-tl-tip-life">{{ lifeText(hovered) }}</p>
      <p class="wj-tl-tip-works">收录作品 <b>{{ workCount(hovered.name) }}</b> 篇</p>
      <a :href="authorHref(hovered.name)" class="wj-tl-tip-link">查看作者页 <span aria-hidden="true">→</span></a>
    </div>
  </div>
</template>

<style scoped>
.wj-tl {
  box-sizing: border-box;
  width: 100%;
  max-width: 1320px;
  margin: 0 auto;
  padding: 14px clamp(14px, 2.6vw, 32px) 56px;
  color: var(--wj-ink);
  font-family: var(--wj-font-body);
}
.wj-tl *,
.wj-tl *::before,
.wj-tl *::after {
  box-sizing: border-box;
}

/* ---------- 顶部 ---------- */
.wj-tl-hero {
  padding: 10px 0 6px;
}
.wj-tl-kicker {
  margin: 0 0 8px;
  font-family: var(--wj-font-display);
  font-size: 11px;
  letter-spacing: var(--wj-label-tracking);
  color: var(--wj-accent);
}
.wj-tl-title {
  margin: 0;
  font-family: var(--wj-font-display);
  font-weight: var(--wj-display-weight);
  font-size: clamp(30px, 4.4vw, 52px);
  line-height: 1.12;
  letter-spacing: 0.01em;
}
.wj-tl-lead {
  max-width: 760px;
  margin: 14px 0 0;
  font-size: 15px;
  line-height: 1.85;
  color: var(--wj-ink-2);
}
.wj-tl-lead b {
  color: var(--wj-ink);
  font-weight: 600;
}
.wj-tl-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0;
  margin: 26px 0 0;
  border-top: 2px solid var(--wj-border-strong);
  border-bottom: 1px solid var(--wj-line);
}
.wj-tl-stat {
  padding: 14px 18px 15px 0;
}
.wj-tl-stat + .wj-tl-stat {
  padding-left: 18px;
  border-left: 1px solid var(--wj-line);
}
.wj-tl-stat dt {
  font-size: 11px;
  letter-spacing: 0.18em;
  color: var(--wj-ink-3);
}
.wj-tl-stat dd {
  margin: 5px 0 0;
  font-family: var(--wj-font-mono);
  font-size: clamp(26px, 3.2vw, 38px);
  font-weight: 600;
  line-height: 1;
  color: var(--wj-accent);
}
.wj-tl-unit {
  margin-left: 4px;
  font-family: var(--wj-font-body);
  font-size: 13px;
  font-weight: 400;
  color: var(--wj-ink-3);
}
.wj-tl-stat-note {
  margin: 10px 0 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--wj-ink-3);
}
.wj-tl-stat-note b {
  color: var(--wj-ink-2);
  font-weight: 600;
}

/* ---------- 视图切换 ---------- */
.wj-tl-switch {
  display: inline-flex;
  gap: 2px;
  margin: 22px 0 18px;
  padding: 3px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-bg-soft);
}
.wj-tl-tab {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 16px;
  border: 0;
  border-radius: var(--wj-radius-pill);
  background: transparent;
  color: var(--wj-ink-2);
  font-family: var(--wj-font-display);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}
.wj-tl-tab:hover {
  color: var(--wj-ink);
}
.wj-tl-tab.on {
  background: var(--wj-card);
  color: var(--wj-ink);
  box-shadow: var(--wj-shadow);
}
.wj-tl-tab-note {
  font-family: var(--wj-font-mono);
  font-size: 10.5px;
  color: var(--wj-ink-3);
}
.wj-tl-tab.on .wj-tl-tab-note {
  color: var(--wj-accent);
}

/* ---------- 两栏 ---------- */
.wj-tl-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
  gap: 22px;
  align-items: start;
}
.wj-tl-panel {
  min-width: 0;
}

/* ---------- 工具栏 ---------- */
.wj-tl-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  margin: 0 0 12px;
}
.wj-tl-zoom,
.wj-tl-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.wj-tl-tool-label {
  margin-right: 2px;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--wj-ink-3);
}
.wj-tl-zoom-btn {
  min-width: 42px;
  padding: 4px 9px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  font-family: var(--wj-font-mono);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.16s ease;
}
.wj-tl-zoom-btn:hover {
  color: var(--wj-ink);
  border-color: var(--wj-ink-3);
}
.wj-tl-zoom-btn.on {
  color: var(--wj-card);
  background: var(--wj-accent);
  border-color: var(--wj-accent);
}
.wj-tl-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px 3px 7px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  font-size: 11.5px;
  cursor: pointer;
  transition: all 0.16s ease;
}
.wj-tl-chip:hover {
  border-color: var(--dyn);
  color: var(--wj-ink);
}
.wj-tl-chip.on {
  border-color: var(--dyn);
  color: var(--wj-ink);
  background: color-mix(in srgb, var(--dyn) 12%, var(--wj-card));
}
.wj-tl-chip i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dyn);
}
.wj-tl-chip span {
  font-family: var(--wj-font-mono);
  font-size: 10px;
  color: var(--wj-ink-3);
}
.wj-tl-filter-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: var(--wj-ink-2);
}
.wj-tl-filter-note b {
  color: var(--wj-accent);
}
.wj-tl-clear {
  padding: 2px 8px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: transparent;
  color: var(--wj-ink-3);
  font-size: 11px;
  cursor: pointer;
}
.wj-tl-clear:hover {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
}

/* ---------- 甘特图 ---------- */
.wj-tl-chart {
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  overflow: hidden;
}
.wj-tl-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--wj-ink-3) var(--wj-bg-soft);
}
.wj-tl-scroll::-webkit-scrollbar {
  height: 10px;
}
.wj-tl-scroll::-webkit-scrollbar-track {
  background: var(--wj-bg-soft);
}
.wj-tl-scroll::-webkit-scrollbar-thumb {
  background: var(--wj-line-strong, var(--wj-ink-3));
  border: 2px solid var(--wj-bg-soft);
  border-radius: 10px;
}
.wj-tl-inner {
  position: relative;
}
.wj-tl-axis {
  display: flex;
  align-items: stretch;
  height: 64px;
  border-bottom: 1px solid var(--wj-line);
  background: var(--wj-card);
}
.wj-tl-corner {
  position: sticky;
  left: 0;
  z-index: 6;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  justify-content: flex-end;
  gap: 2px;
  width: 150px;
  padding: 0 10px 8px;
  border-right: 1px solid var(--wj-line);
  background: var(--wj-card);
  font-size: 10.5px;
  letter-spacing: 0.16em;
  color: var(--wj-ink-3);
}
.wj-tl-corner span:first-child {
  font-family: var(--wj-font-display);
  font-size: 12px;
  letter-spacing: 0.08em;
  color: var(--wj-ink);
}
.wj-tl-axis-track {
  position: relative;
  flex: 0 0 auto;
  height: 64px;
}
.wj-tl-band {
  position: absolute;
  inset: 4px 0 auto;
  height: 27px;
  background: var(--wj-bg-soft);
}
.wj-tl-era {
  position: absolute;
  top: 0;
  height: 27px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  overflow: hidden;
  border: 0;
  border-top: 3px solid var(--dyn);
  background: color-mix(in srgb, var(--dyn) 16%, var(--wj-card));
  color: var(--wj-ink);
  font-family: var(--wj-font-display);
  font-size: 10.5px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.16s ease, opacity 0.16s ease;
}
.wj-tl-era:hover {
  background: color-mix(in srgb, var(--dyn) 28%, var(--wj-card));
}
.wj-tl-era.on {
  background: color-mix(in srgb, var(--dyn) 34%, var(--wj-card));
  box-shadow: inset 0 -2px 0 var(--dyn);
}
.wj-tl-era.dim {
  opacity: 0.35;
}
.wj-tl-ticks {
  position: absolute;
  inset: 33px 0 0;
}
.wj-tl-tick {
  position: absolute;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--wj-ink-3);
}
.wj-tl-tick i {
  display: block;
  width: 1px;
  height: 6px;
  background: var(--wj-ink-3);
}
.wj-tl-tick b {
  margin-top: 3px;
  font-family: var(--wj-font-mono);
  font-size: 9.5px;
  font-weight: 400;
  line-height: 1;
  white-space: nowrap;
}
.wj-tl-tick.al-start {
  align-items: flex-start;
  transform: translateX(0);
}
.wj-tl-tick.al-center {
  transform: translateX(-50%);
}
.wj-tl-tick.al-end {
  align-items: flex-end;
  transform: translateX(-100%);
}

.wj-tl-body {
  position: relative;
}
.wj-tl-grid {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 0;
  pointer-events: none;
}
.wj-tl-grid span {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--wj-line-soft);
}
.wj-tl-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: stretch;
  height: 24px;
  border-bottom: 1px solid var(--wj-line-soft);
  transition: background 0.14s ease, opacity 0.18s ease;
}
.wj-tl-row:last-child {
  border-bottom: 0;
}
.wj-tl-row:hover {
  background: color-mix(in srgb, var(--wj-accent) 4%, transparent);
}
.wj-tl-row.sel {
  background: var(--wj-accent-tint);
}
.wj-tl-row.dim {
  opacity: 0.22;
}
.wj-tl-name {
  position: sticky;
  left: 0;
  z-index: 4;
  display: flex;
  flex: 0 0 auto;
  align-items: baseline;
  gap: 7px;
  width: 150px;
  padding: 0 10px;
  border-right: 1px solid var(--wj-line);
  background: var(--wj-card);
  overflow: hidden;
  white-space: nowrap;
}
.wj-tl-row:hover .wj-tl-name {
  background: color-mix(in srgb, var(--wj-accent) 4%, var(--wj-card));
}
.wj-tl-row.sel .wj-tl-name {
  background: color-mix(in srgb, var(--wj-accent) 10%, var(--wj-card));
}
.wj-tl-name-main {
  font-family: var(--wj-font-display);
  font-size: 12.5px;
  color: var(--wj-ink);
  overflow: hidden;
  text-overflow: ellipsis;
}
.wj-tl-name-date {
  margin-left: auto;
  flex: 0 0 auto;
  font-family: var(--wj-font-mono);
  font-size: 9.5px;
  color: var(--wj-ink-3);
}
.wj-tl-track {
  position: relative;
  flex: 0 0 auto;
  min-height: 1px;
}
.wj-tl-life {
  position: absolute;
  top: 50%;
  height: 9px;
  padding: 0;
  border: 0;
  border-radius: var(--wj-radius-pill);
  background: var(--dyn);
  color: var(--dyn);
  cursor: pointer;
  transform: translateY(-50%);
  transition: height 0.14s ease, box-shadow 0.14s ease, opacity 0.14s ease;
}
.wj-tl-life:hover,
.wj-tl-life:focus-visible {
  height: 12px;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dyn) 22%, transparent);
}
.wj-tl-life.is-selected {
  height: 13px;
  box-shadow: 0 0 0 2px var(--wj-card), 0 0 0 4px var(--dyn);
}
.wj-tl-life.is-partial {
  height: 6px;
  background: repeating-linear-gradient(90deg, var(--dyn) 0 4px, transparent 4px 7px);
  border-radius: 0;
}
.wj-tl-life.is-partial::before {
  content: '?';
  position: absolute;
  top: 50%;
  font-family: var(--wj-font-mono);
  font-size: 9px;
  line-height: 1;
  color: var(--dyn);
  opacity: 0.9;
  transform: translateY(-50%);
}
.wj-tl-life.partial-end::before {
  right: -8px;
}
.wj-tl-life.partial-start::before {
  left: -8px;
}
.wj-tl-life-year {
  position: absolute;
  top: 50%;
  left: 3px;
  font-family: var(--wj-font-mono);
  font-size: 8.5px;
  line-height: 1;
  color: var(--wj-card);
  opacity: 0;
  transform: translateY(-50%);
  pointer-events: none;
  white-space: nowrap;
  transition: opacity 0.14s ease;
}
.wj-tl-life-year.end {
  left: auto;
  right: 3px;
}
.wj-tl-life:hover .wj-tl-life-year,
.wj-tl-life.is-selected .wj-tl-life-year {
  opacity: 0.95;
}
.wj-tl-chart-foot {
  margin: 0;
  padding: 7px 12px 8px;
  border-top: 1px solid var(--wj-line);
  background: var(--wj-bg-soft);
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--wj-ink-3);
}

/* ---------- 朝代分组 ---------- */
.wj-tl-view-intro {
  margin: 0 0 16px;
  padding: 12px 15px;
  border-left: 3px solid var(--wj-accent);
  background: var(--wj-accent-tint);
  font-size: 13px;
  line-height: 1.75;
  color: var(--wj-ink-2);
}
.wj-tl-view-intro b {
  color: var(--wj-ink);
}
.wj-tl-dynasties,
.wj-tl-unknown {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.wj-tl-dynasty,
.wj-tl-unknown-group {
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  overflow: hidden;
}
.wj-tl-dynasty-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--wj-line);
  background: color-mix(in srgb, var(--dyn) 7%, var(--wj-card));
}
.wj-tl-dynasty-head h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: 19px;
  font-weight: var(--wj-display-weight);
  line-height: 1.2;
}
.wj-tl-dynasty-head h2 i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--dyn);
}
.wj-tl-dynasty-head p {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: var(--wj-ink-3);
}
.wj-tl-dynasty-bar {
  width: 58px;
  height: 5px;
  border-radius: var(--wj-radius-pill);
  background: var(--dyn);
  opacity: 0.7;
}
.wj-tl-author-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 1px;
  background: var(--wj-line-soft);
}
.wj-tl-author-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 12px 14px 13px;
  border: 0;
  border-left: 3px solid transparent;
  background: var(--wj-card);
  text-align: left;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease;
}
.wj-tl-author-chip:hover {
  background: color-mix(in srgb, var(--dyn) 7%, var(--wj-card));
  border-left-color: var(--dyn);
}
.wj-tl-author-chip.on {
  background: var(--wj-accent-tint);
  border-left-color: var(--wj-accent);
}
.wj-tl-chip-name {
  font-family: var(--wj-font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--wj-ink);
}
.wj-tl-chip-sub {
  font-size: 10.5px;
  color: var(--wj-ink-3);
}
.wj-tl-chip-life {
  font-family: var(--wj-font-mono);
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--wj-ink-2);
}
.wj-tl-author-chip.unknown .wj-tl-chip-life {
  color: var(--wj-ink-3);
  font-style: italic;
}
.wj-tl-chip-works {
  margin-top: 2px;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--wj-accent);
}

/* ---------- 生卒待考 ---------- */
.wj-tl-unknown-group header {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--wj-line);
  background: color-mix(in srgb, var(--dyn) 7%, var(--wj-card));
}
.wj-tl-unknown-group h2 {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: 17px;
  font-weight: var(--wj-display-weight);
}
.wj-tl-unknown-group header span {
  font-family: var(--wj-font-mono);
  font-size: 11px;
  color: var(--wj-ink-3);
}

/* ---------- 作者卡 ---------- */
.wj-tl-side {
  position: sticky;
  top: 88px;
  max-height: calc(100vh - 112px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--wj-ink-3) transparent;
}
.wj-tl-card {
  border: 1px solid var(--wj-line);
  border-top: 3px solid var(--dyn);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  padding: 15px 17px 18px;
}
.wj-tl-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.wj-tl-dyn-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border: 1px solid var(--dyn);
  border-radius: var(--wj-radius-pill);
  color: var(--dyn);
  font-size: 10.5px;
  letter-spacing: 0.12em;
}
.wj-tl-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--wj-line);
  border-radius: 50%;
  background: transparent;
  color: var(--wj-ink-3);
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.wj-tl-close:hover {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
}
.wj-tl-card-name {
  margin: 10px 0 0;
  font-family: var(--wj-font-display);
  font-size: 27px;
  font-weight: var(--wj-display-weight);
  line-height: 1.15;
}
.wj-tl-card-alias {
  margin: 4px 0 0;
  font-size: 12.5px;
  color: var(--wj-ink-2);
}
.wj-tl-card-life {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  margin: 8px 0 0;
  font-family: var(--wj-font-mono);
  font-size: 12px;
  color: var(--wj-ink-2);
}
.wj-tl-card-works-n {
  font-family: var(--wj-font-body);
  font-size: 10.5px;
  color: var(--wj-accent);
}
.wj-tl-meta {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 13px 0 0;
  padding: 11px 0;
  border-top: 1px solid var(--wj-line-soft);
  border-bottom: 1px solid var(--wj-line-soft);
}
.wj-tl-meta > div {
  display: flex;
  gap: 9px;
  font-size: 12px;
  line-height: 1.6;
}
.wj-tl-meta dt {
  flex: 0 0 auto;
  width: 34px;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--wj-ink-3);
}
.wj-tl-meta dd {
  margin: 0;
  color: var(--wj-ink-2);
}
.wj-tl-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.wj-tl-tags span {
  padding: 1px 7px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  font-size: 10.5px;
}
.wj-tl-links {
  display: flex;
  flex-wrap: wrap;
  gap: 3px 9px;
}
.wj-tl-links a {
  color: var(--wj-accent);
  text-decoration: none;
  border-bottom: 1px solid transparent;
}
.wj-tl-links a:hover {
  border-bottom-color: var(--wj-accent);
}
.wj-tl-author-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  padding: 5px 11px;
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-accent);
  font-size: 12px;
  text-decoration: none;
  transition: background 0.16s ease, color 0.16s ease;
}
.wj-tl-author-link:hover {
  background: var(--wj-accent);
  color: var(--wj-card);
}
.wj-tl-works {
  margin-top: 17px;
}
.wj-tl-works h3 {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0 0 9px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--wj-line);
  font-family: var(--wj-font-display);
  font-size: 14px;
  font-weight: 600;
}
.wj-tl-works h3 span {
  font-family: var(--wj-font-mono);
  font-size: 10px;
  font-weight: 400;
  color: var(--wj-ink-3);
}
.wj-tl-works-empty {
  margin: 0;
  font-size: 12px;
  color: var(--wj-ink-3);
}
.wj-tl-work-group {
  margin-top: 11px;
}
.wj-tl-work-group h4 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 4px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: var(--wj-ink-3);
}
.wj-tl-work-group h4 span {
  font-family: var(--wj-font-mono);
  font-weight: 400;
}
.wj-tl-work-group ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.wj-tl-work-group li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 3px 8px;
  padding: 3px 0;
  border-bottom: 1px dotted var(--wj-line-soft);
  font-size: 12.5px;
}
.wj-tl-work-group li:last-child {
  border-bottom: 0;
}
.wj-tl-work-group li a {
  color: var(--wj-ink);
  text-decoration: none;
  border-bottom: 1px solid transparent;
}
.wj-tl-work-group li a:hover {
  color: var(--wj-accent);
  border-bottom-color: var(--wj-accent);
}
.wj-tl-work-genre {
  font-size: 10px;
  color: var(--wj-ink-3);
}
.wj-tl-work-stage {
  margin-left: auto;
  font-family: var(--wj-font-mono);
  font-size: 9.5px;
  color: var(--wj-ink-3);
}
.wj-tl-side-empty {
  padding: 18px 17px 20px;
  border: 1px dashed var(--wj-line);
  border-radius: var(--wj-radius);
  background: color-mix(in srgb, var(--wj-bg-soft) 55%, transparent);
}
.wj-tl-side-kicker {
  margin: 0 0 6px;
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--wj-accent);
  text-transform: uppercase;
}
.wj-tl-side-empty h2 {
  margin: 0;
  font-family: var(--wj-font-display);
  font-size: 20px;
  font-weight: var(--wj-display-weight);
}
.wj-tl-side-empty > p {
  margin: 8px 0 0;
  font-size: 12.5px;
  line-height: 1.75;
  color: var(--wj-ink-2);
}
.wj-tl-side-tips {
  margin: 14px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--wj-line);
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11.5px;
  color: var(--wj-ink-3);
}
.wj-tl-side-tips span {
  display: inline-block;
  min-width: 38px;
  color: var(--wj-ink-2);
  font-family: var(--wj-font-mono);
  font-size: 10.5px;
}

/* ---------- 悬停浮层 ---------- */
.wj-tl-tip {
  position: fixed;
  z-index: 100;
  width: 282px;
  padding: 12px 14px 13px;
  border: 1px solid var(--wj-line);
  border-left: 3px solid var(--dyn);
  border-radius: var(--wj-radius-sm);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow), 0 14px 34px color-mix(in srgb, var(--wj-ink) 18%, transparent);
  color: var(--wj-ink);
  font-family: var(--wj-font-body);
  pointer-events: auto;
}
.wj-tl-tip-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.wj-tl-tip-head b {
  font-family: var(--wj-font-display);
  font-size: 19px;
  line-height: 1.2;
}
.wj-tl-tip-head span {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--dyn);
}
.wj-tl-tip-alias,
.wj-tl-tip-life,
.wj-tl-tip-works {
  margin: 5px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--wj-ink-2);
}
.wj-tl-tip-life {
  font-family: var(--wj-font-mono);
}
.wj-tl-tip-works b {
  color: var(--wj-accent);
}
.wj-tl-tip-link {
  display: inline-block;
  margin-top: 8px;
  color: var(--wj-accent);
  font-size: 11.5px;
  text-decoration: none;
  border-bottom: 1px solid transparent;
}
.wj-tl-tip-link:hover {
  border-bottom-color: var(--wj-accent);
}

/* ---------- 页脚 ---------- */
.wj-tl-foot {
  margin: 26px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--wj-line);
  font-size: 11px;
  line-height: 1.7;
  color: var(--wj-ink-3);
}
.wj-tl-foot code {
  padding: 1px 4px;
  border: 1px solid var(--wj-line-soft);
  border-radius: 2px;
  background: var(--wj-bg-soft);
  font-family: var(--wj-font-mono);
  font-size: 10px;
}

/* ---------- 窄屏 ---------- */
.wj-tl-mobile {
  display: none;
}

@media (max-width: 1080px) {
  .wj-tl-main {
    grid-template-columns: minmax(0, 1fr);
  }
  .wj-tl-side {
    position: static;
    max-height: none;
    scroll-margin-top: 84px;
  }
}

@media (max-width: 759px) {
  .wj-tl {
    padding: 10px 14px 44px;
  }
  .wj-tl-title {
    font-size: 32px;
  }
  .wj-tl-lead {
    font-size: 13.5px;
  }
  .wj-tl-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .wj-tl-stat {
    padding: 11px 8px 12px 0;
  }
  .wj-tl-stat + .wj-tl-stat {
    padding-left: 8px;
  }
  .wj-tl-stat dd {
    font-size: 24px;
  }
  .wj-tl-switch {
    display: flex;
    width: 100%;
  }
  .wj-tl-tab {
    flex: 1 1 0;
    justify-content: center;
    padding: 7px 6px;
    gap: 4px;
    font-size: 12.5px;
  }
  .wj-tl-tab-note {
    display: none;
  }
  .wj-tl-desktop {
    display: none;
  }
  .wj-tl-mobile {
    display: block;
  }
  .wj-tl-zoom {
    display: none;
  }
  .wj-tl-tip {
    display: none;
  }
  .wj-tl-author-grid {
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  }
  .wj-tl-author-chip {
    padding: 10px 11px;
  }
  .wj-tl-chip-name {
    font-size: 14px;
  }
  .wj-tl-close {
    width: 30px;
    height: 30px;
  }
}

/* 窄屏纵向列表 */
.wj-tl-mobile-head {
  padding: 11px 13px 9px;
  border: 1px solid var(--wj-line);
  border-bottom: 0;
  border-radius: var(--wj-radius) var(--wj-radius) 0 0;
  background: var(--wj-card);
}
.wj-tl-mobile-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.wj-tl-mobile-title b {
  font-size: 12px;
  letter-spacing: 0.08em;
}
.wj-tl-mobile-title span {
  font-family: var(--wj-font-mono);
  font-size: 10px;
  color: var(--wj-ink-3);
}
.wj-tl-mobile-scale {
  position: relative;
  height: 20px;
  margin-top: 7px;
  border-bottom: 1px solid var(--wj-line);
}
.wj-tl-mobile-scale span {
  position: absolute;
  bottom: 3px;
  font-family: var(--wj-font-mono);
  font-size: 8.5px;
  color: var(--wj-ink-3);
  transform: translateX(-50%);
  white-space: nowrap;
}
.wj-tl-mobile-scale span:first-child {
  transform: translateX(0);
}
.wj-tl-mobile-scale span:last-child {
  transform: translateX(-100%);
}
.wj-tl-mobile-list {
  border: 1px solid var(--wj-line);
  border-radius: 0 0 var(--wj-radius) var(--wj-radius);
  background: var(--wj-card);
  overflow: hidden;
}
.wj-tl-mrow {
  display: block;
  width: 100%;
  padding: 9px 13px 10px;
  border: 0;
  border-bottom: 1px solid var(--wj-line-soft);
  border-left: 3px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.18s ease;
}
.wj-tl-mrow:last-child {
  border-bottom: 0;
}
.wj-tl-mrow:hover,
.wj-tl-mrow:focus-visible {
  background: color-mix(in srgb, var(--wj-accent) 5%, transparent);
}
.wj-tl-mrow.sel {
  background: var(--wj-accent-tint);
  border-left-color: var(--wj-accent);
}
.wj-tl-mrow.dim {
  opacity: 0.24;
}
.wj-tl-mrow-top {
  display: flex;
  align-items: baseline;
  gap: 7px;
}
.wj-tl-mrow-top b {
  font-family: var(--wj-font-display);
  font-size: 14px;
  color: var(--wj-ink);
}
.wj-tl-mrow-top em {
  font-family: var(--wj-font-mono);
  font-size: 9.5px;
  font-style: normal;
  color: var(--wj-ink-3);
}
.wj-tl-mrow-top i {
  font-style: normal;
  font-size: 9.5px;
  color: var(--dyn);
}
.wj-tl-mrow-w {
  margin-left: auto;
  font-size: 9.5px;
  color: var(--wj-ink-3);
}
.wj-tl-mtrack {
  position: relative;
  display: block;
  height: 8px;
  margin-top: 6px;
  border-radius: var(--wj-radius-pill);
  background: var(--wj-bg-soft);
  overflow: hidden;
}
.wj-tl-mbar {
  position: absolute;
  top: 50%;
  height: 6px;
  border-radius: var(--wj-radius-pill);
  background: var(--dyn);
  transform: translateY(-50%);
}
.wj-tl-mbar.is-partial {
  background: repeating-linear-gradient(90deg, var(--dyn) 0 3px, transparent 3px 5px);
  border-radius: 0;
}

@media (prefers-reduced-motion: reduce) {
  .wj-tl *,
  .wj-tl *::before,
  .wj-tl *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
</style>