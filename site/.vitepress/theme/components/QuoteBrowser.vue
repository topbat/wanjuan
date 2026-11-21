<script setup lang="ts">
// 万卷 · 名句库浏览页
//
// 数据源：
//   /indexes/quotes.json —— 名句（text/author/work/theme/dynasty/curriculum/srcPath）
//   /indexes/poems.json  —— 作品标题与词条路由（work → 篇名/链接）
// 交互：
//   搜索（汉字/作者/篇名/全拼/首字母）· 主题/朝代/学段多维筛选（同维 OR、跨维 AND）
//   卡片点击展开「语境」（按需拉取名句词条页并解析）· 一键复制引用格式 · 分页 24/页 · URL 同步
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { pinyin } from 'pinyin-pro'
import WjFilterBar from './WjFilterBar.vue'
import WjPager from './WjPager.vue'
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
  scene: string
  pinyin: string
  initials: string
  stageLabel: string
}

const BASE = import.meta.env.BASE_URL

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

const quotes = ref<Quote[]>([])
const poems = ref<Poem[]>([])
const details = ref<Detail[]>([])
const loading = ref(true)
const failed = ref('')
const pageSize = ref(24)

const expanded = ref<Set<string>>(new Set())
const contextCache = reactive<Record<string, string>>({})
const contextLoading = reactive<Record<string, boolean>>({})
const contextError = reactive<Record<string, string>>({})
const copiedId = ref('')

const { state } = useUrlState({
  q: '',
  theme: [] as string[],
  dynasty: [] as string[],
  stage: [] as string[],
  page: 1,
})

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
  return /^《.*》/.test(title) ? title : `《${title}》`
}

/** 作者·篇名（作者本身是书名时省略重复书名） */
function sourceLabel(q: Enriched): string {
  const title = workLabel(q.workTitle)
  if (q.author && title.startsWith(q.author)) return title
  return `${q.author}${title}`
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

const enriched = computed<Enriched[]>(() => {
  const list = quotes.value.map((q) => {
    const poem = q.work ? poemById.value.get(q.work) : undefined
    const workTitle = poem?.title ?? ''
    const workRoute = poem ? toRoute(poem.srcPath) : ''
    const stage = q.curriculum?.stage ?? ''
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
    return {
      ...q,
      workTitle,
      workRoute,
      scene: detailById.value.get(q.id)?.scene ?? sceneFor(q.theme ?? []),
      pinyin: searchPinyin,
      initials: searchInitials,
      stageLabel: STAGE_LABEL[stage] ?? stage,
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

function dimensionMatch(q: Enriched, key: 'theme' | 'dynasty' | 'stage'): boolean {
  const selected = state.value[key]
  if (!selected.length) return true
  if (key === 'theme') return (q.theme ?? []).some((t) => selected.includes(t))
  if (key === 'dynasty') return selected.includes(q.dynasty)
  return selected.includes(q.curriculum?.stage ?? '')
}

function matchesExcept(q: Enriched, skip?: 'theme' | 'dynasty' | 'stage'): boolean {
  if (!searchMatch(q, state.value.q)) return false
  for (const key of ['theme', 'dynasty', 'stage'] as const) {
    if (key !== skip && !dimensionMatch(q, key)) return false
  }
  return true
}

const filtered = computed(() =>
  enriched.value.filter((q) => matchesExcept(q)),
)

const filters = computed<Record<string, string[]>>({
  get: () => ({
    theme: state.value.theme,
    dynasty: state.value.dynasty,
    stage: state.value.stage,
  }),
  set: (v) => {
    state.value = {
      ...state.value,
      theme: v.theme ?? [],
      dynasty: v.dynasty ?? [],
      stage: v.stage ?? [],
      page: 1,
    }
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

const groups = computed(() => [
  { key: 'theme', label: '主题', options: themeOptions.value },
  { key: 'dynasty', label: '朝代', options: dynastyOptions.value },
  { key: 'stage', label: '学段', options: stageOptions.value },
])

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
  },
})

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))

const pageItems = computed(() => {
  const p = Math.min(Math.max(1, state.value.page), pageCount.value)
  return filtered.value.slice((p - 1) * pageSize.value, p * pageSize.value)
})

watch(
  () => [filtered.value.length, pageCount.value] as const,
  () => {
    if (state.value.page > pageCount.value) state.value.page = pageCount.value
    if (state.value.page < 1) state.value.page = 1
  },
)

function clearAll() {
  state.value = { q: '', theme: [], dynasty: [], stage: [], page: 1 }
}

// ── 展开语境 ────────────────────────────────────────────────

function replaceBreaks(el: Element): string {
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  return (clone.textContent ?? '').trim()
}

async function loadContext(q: Enriched) {
  if (contextCache[q.id] || contextLoading[q.id]) return
  contextLoading[q.id] = true
  contextError[q.id] = ''
  try {
    const cached = detailById.value.get(q.id)
    if (cached?.context) {
      contextCache[q.id] = cached.context
      return
    }
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

function toggle(q: Enriched) {
  const next = new Set(expanded.value)
  if (next.has(q.id)) next.delete(q.id)
  else {
    next.add(q.id)
    loadContext(q)
  }
  expanded.value = next
}

// ── 复制 ────────────────────────────────────────────────────

function citeText(q: Enriched): string {
  return q.workTitle
    ? `「${q.text}」——${sourceLabel(q)}`
    : `「${q.text}」——${q.author}`
}

async function copyQuote(q: Enriched) {
  const text = citeText(q)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    copiedId.value = q.id
    window.setTimeout(() => {
      if (copiedId.value === q.id) copiedId.value = ''
    }, 1600)
  } catch {
    window.prompt('复制失败，请手动复制：', text)
  }
}

// ── 数据加载 ────────────────────────────────────────────────

onMounted(async () => {
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
</script>

<template>
  <section class="wj-qb">
    <header class="wj-qb-hero">
      <p class="wj-qb-kicker">QUOTES · 名句库</p>
      <h1 class="wj-qb-title">名句库</h1>
      <p class="wj-qb-lead">
        共 <b>{{ quotes.length }}</b> 句，按主题、朝代、学段筛选；点击卡片展开原诗语境，一键复制引用格式。
      </p>
    </header>

    <div class="wj-qb-searchrow">
      <input
        v-model="query"
        class="wj-qb-search"
        type="search"
        autocomplete="off"
        spellcheck="false"
        placeholder="搜索名句、作者、篇名，或输入全拼/首字母（如 sushi / changfeng / ss）"
        aria-label="搜索名句"
      />
    </div>

    <WjFilterBar
      v-if="!loading && !failed"
      v-model="filters"
      :groups="groups"
      :total="filtered.length"
      unit="句"
      @change="state.page = 1"
    />

    <div v-if="loading" class="wj-qb-grid" aria-busy="true">
      <div v-for="i in 6" :key="i" class="wj-qb-skeleton">
        <div class="wj-qb-sk-line" />
        <div class="wj-qb-sk-line short" />
        <div class="wj-qb-sk-line meta" />
      </div>
    </div>

    <p v-else-if="failed" class="wj-note">
      名句数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成索引后再访问。
    </p>

    <div v-else-if="!filtered.length" class="wj-qb-empty">
      <p>没有符合当前条件的名句。</p>
      <button type="button" class="wj-qb-btn" @click="clearAll">清除全部筛选</button>
    </div>

    <div v-else class="wj-qb-grid">
      <article
        v-for="q in pageItems"
        :key="q.id"
        class="wj-qb-card"
        :class="{ open: expanded.has(q.id) }"
        @click="toggle(q)"
      >
        <p class="wj-qb-text">{{ q.text }}</p>

        <div class="wj-qb-meta">
          <a v-if="q.workRoute" class="wj-qb-source" :href="q.workRoute" @click.stop>
            {{ sourceLabel(q) }}
          </a>
          <span v-else class="wj-qb-source">{{ q.author }}</span>
          <span class="wj-qb-badges">
            <i class="wj-qb-pill">{{ q.dynasty }}</i>
            <i v-if="q.stageLabel" class="wj-qb-pill">{{ q.stageLabel }}</i>
          </span>
        </div>

        <div class="wj-qb-themes">
          <i v-for="t in q.theme" :key="t" class="wj-qb-theme">{{ t }}</i>
        </div>

        <p class="wj-qb-scene">{{ q.scene }}</p>

        <div class="wj-qb-actions">
          <button
            type="button"
            class="wj-qb-btn"
            :aria-expanded="expanded.has(q.id)"
            @click.stop="toggle(q)"
          >
            {{ expanded.has(q.id) ? '收起语境' : '展开语境' }}
          </button>
          <button
            type="button"
            class="wj-qb-btn copy"
            :class="{ done: copiedId === q.id }"
            :aria-label="`复制名句：${q.text}`"
            @click.stop="copyQuote(q)"
          >
            {{ copiedId === q.id ? '已复制' : '复制' }}
          </button>
        </div>

        <div v-if="expanded.has(q.id)" class="wj-qb-context" @click.stop>
          <span class="wj-qb-context-label">语境</span>
          <p v-if="contextLoading[q.id]" class="wj-qb-context-text">正在加载语境…</p>
          <p v-else-if="contextError[q.id]" class="wj-qb-context-text error">
            语境加载失败（{{ contextError[q.id] }}）
          </p>
          <p v-else class="wj-qb-context-text">{{ contextCache[q.id] }}</p>
        </div>
      </article>
    </div>

    <WjPager
      v-if="!loading && !failed && filtered.length"
      v-model:page="page"
      :total="filtered.length"
      :size="pageSize"
      :sizes="[24]"
      unit="句"
    />
  </section>
</template>

<style scoped>
/* 少年主题的装饰光斑伪元素会超出视口，导致本页出现横向滚动条；仅在本页裁切横向溢出 */
:global(body:has(.wj-qb)) {
  overflow-x: clip;
}

.wj-qb {
  max-width: 1200px;
  margin: 0 auto;
  padding: 8px 0 32px;
}

.wj-qb-hero {
  padding: 8px 2px 16px;
  border-bottom: 2px solid var(--wj-line);
  margin-bottom: 18px;
}
.wj-qb-kicker {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: var(--wj-label-tracking);
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
}
.wj-qb-title {
  margin: 0;
  font-family: var(--wj-font-display);
  font-weight: var(--wj-display-weight, 700);
  color: var(--wj-ink);
  letter-spacing: 0.04em;
  font-size: clamp(28px, 4vw, 42px);
  line-height: 1.2;
}
.wj-qb-lead {
  margin: 8px 0 0;
  color: var(--wj-ink-2);
  font-size: 14px;
  line-height: 1.7;
}
.wj-qb-lead b {
  color: var(--wj-accent);
}

.wj-qb-searchrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0;
}.wj-qb-search {
  flex: 1 1 auto;
  min-width: 0;
  height: 42px;
  padding: 0 16px;
  font-size: 14px;
  color: var(--wj-ink);
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  outline: none;
  font-family: var(--wj-font-body);
  transition: border-color 0.16s, box-shadow 0.16s;
}
.wj-qb-search::placeholder {
  color: var(--wj-ink-3);
}
.wj-qb-search:focus {
  border-color: var(--wj-accent);
  box-shadow: 0 0 0 3px var(--wj-accent-tint);
}

.wj-qb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
  margin-top: 14px;
}

.wj-qb-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px 20px 14px;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-top: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.wj-qb-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--wj-shadow-hover);
}
.wj-qb-card.open {
  box-shadow: var(--wj-shadow-hover);
}

.wj-qb-text {
  margin: 0;
  padding: 2px 4px 0;
  font-family: var(--wj-font-poem);
  font-size: clamp(20px, 2.2vw, 26px);
  line-height: 1.7;
  color: var(--wj-ink);
  text-align: center;
  text-wrap: balance;
}
.wj-qb-text::before {
  content: '「';
  color: var(--wj-accent);
}
.wj-qb-text::after {
  content: '」';
  color: var(--wj-accent);
}

.wj-qb-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.wj-qb-source {
  color: var(--wj-ink-2);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: color 0.16s, border-color 0.16s;
}
a.wj-qb-source:hover {
  color: var(--wj-accent);
  border-bottom-color: var(--wj-accent);
}
.wj-qb-badges {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.wj-qb-pill {
  font-style: normal;
  padding: 0 9px;
  line-height: 22px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-ink-3);
  font-size: 12px;
  white-space: nowrap;
}

.wj-qb-themes {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.wj-qb-theme {
  font-style: normal;
  padding: 1px 10px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
  font-size: 12px;
  white-space: nowrap;
}

.wj-qb-scene {
  margin: 0;
  color: var(--wj-ink-2);
  font-size: 13px;
  line-height: 1.65;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wj-qb-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed var(--wj-line);
}
.wj-qb-btn {
  padding: 4px 13px;
  font-size: 12px;
  font-family: var(--wj-font-display);
  color: var(--wj-ink-2);
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  cursor: pointer;
  transition: color 0.16s, border-color 0.16s, background 0.16s;
}
.wj-qb-btn:hover {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
}
.wj-qb-btn.copy {
  margin-left: auto;
}
.wj-qb-btn.done {
  color: var(--wj-accent);
  border-color: var(--wj-accent);
  background: var(--wj-accent-tint);
}

.wj-qb-context {
  padding: 10px 13px 11px;
  background: var(--wj-accent-tint);
  border-left: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius-sm);
}
.wj-qb-context-label {
  display: block;
  margin-bottom: 4px;
  font-size: 11px;
  letter-spacing: var(--wj-label-tracking);
  color: var(--wj-accent);
  font-family: var(--wj-font-display);
}
.wj-qb-context-text {
  margin: 0;
  white-space: pre-line;
  font-family: var(--wj-font-poem);
  font-size: 15px;
  line-height: 1.8;
  color: var(--wj-ink);
}
.wj-qb-context-text.error {
  font-family: var(--wj-font-body);
  font-size: 13px;
  color: var(--wj-ink-2);
}

.wj-qb-empty {
  margin: 26px 0;
  padding: 28px 20px;
  text-align: center;
  color: var(--wj-ink-2);
  border: 1px dashed var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
}
.wj-qb-empty p {
  margin: 0 0 12px;
}

.wj-qb-skeleton {
  min-height: 210px;
  padding: 22px 20px;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  box-shadow: var(--wj-shadow);
}
.wj-qb-sk-line {
  height: 18px;
  margin: 10px 0;
  border-radius: var(--wj-radius-sm);
  background: linear-gradient(90deg, var(--wj-bg-soft), var(--wj-line-soft), var(--wj-bg-soft));
  background-size: 200% 100%;
  animation: wj-qb-shimmer 1.4s linear infinite;
}
.wj-qb-sk-line.short {
  width: 62%;
  margin-left: auto;
  margin-right: auto;
}
.wj-qb-sk-line.meta {
  width: 38%;
  height: 12px;
  margin-top: 28px;
}

@keyframes wj-qb-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

@media (max-width: 760px) {
  .wj-qb-searchrow {
    align-items: stretch;
    flex-direction: column;
    gap: 6px;
  }
  .wj-qb-grid {
    grid-template-columns: 1fr;
  }
  .wj-qb-card {
    padding: 16px 16px 12px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wj-qb-card,
  .wj-qb-btn,
  .wj-qb-search,
  .wj-qb-source {
    transition: none;
  }
  .wj-qb-card:hover {
    transform: none;
  }
  .wj-qb-sk-line {
    animation: none;
  }
}
</style>
