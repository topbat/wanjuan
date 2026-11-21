<script setup lang="ts">
// 万卷 · 成语库浏览页
// 数据源：/indexes/idioms.json（build-index 产物）
// 复用：WjFilterBar（多维胶囊 + 计数）/ WjPager（分页）/ useUrlState（URL 同步）
// 交互规范：docs/ui-patterns.md
import { computed, onMounted, ref, watch } from 'vue'
import WjFilterBar from './WjFilterBar.vue'
import WjPager from './WjPager.vue'
import { useUrlState } from '../composables/useUrlState'

type Idiom = {
  id: string
  word: string
  pinyin: string
  pinyinPlain: string
  first: string
  last: string
  meaning: string
  origin: string | null
  originLink: string | null
  semanticField: string | null
  synonyms: string[]
  antonyms: string[]
  tags: string[]
  curriculum: { stage: string; grade: number; recitation?: boolean }
  srcPath: string
}

const BASE = import.meta.env.BASE_URL

/** 固定语义场枚举（与 scripts/expand-idioms.mjs 保持一致） */
const FIELDS = [
  '勤奋励志', '品德修养', '诚信正直', '智慧谋略', '勇气毅力', '学习求知',
  '团结协作', '惜时进取', '家国情怀', '友情交往', '处世哲理', '景物描写', '其他',
]

/** 既有 20 条词条保留了人工语义场（如「志向」「谋略」），浏览时归一到固定枚举。 */
const LEGACY_FIELD: Record<string, string> = {
  志向: '勤奋励志',
  勤奋: '勤奋励志',
  勇气: '勇气毅力',
  谋略: '智慧谋略',
  才学: '学习求知',
  诚信: '诚信正直',
  哲理: '处世哲理',
  '爱情·童年': '友情交往',
}

const STAGE_ORDER = ['primary', 'junior', 'senior']
const STAGE_LABEL: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中' }

function normField(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim()
  if (!s) return '其他'
  if (FIELDS.includes(s)) return s
  return LEGACY_FIELD[s] ?? '其他'
}

function initialOf(it: Idiom): string {
  const py = String(it.pinyinPlain ?? '').trim().toLowerCase()
  const ch = py[0] ?? ''
  return /[a-z]/.test(ch) ? ch : ''
}

const idioms = ref<Idiom[]>([])
const loading = ref(true)
const failed = ref('')
const size = ref(24)
const animateIn = ref(true)

const url = useUrlState({
  q: '',
  field: [] as string[],
  initial: [] as string[],
  stage: [] as string[],
  page: 1,
})
const state = url.state

const selected = computed<Record<string, string[]>>({
  get: () => ({
    field: state.value.field,
    initial: state.value.initial,
    stage: state.value.stage,
  }),
  set: (v) => {
    state.value.field = v.field ?? []
    state.value.initial = v.initial ?? []
    state.value.stage = v.stage ?? []
  },
})

const pageModel = computed<number>({
  get: () => state.value.page,
  set: (v) => {
    state.value.page = v
  },
})

/** 汉字 / 全拼 / 首字母三通道检索 */
function matchSearch(it: Idiom, raw: string): boolean {
  const q = raw.trim().toLowerCase()
  if (!q) return true
  if (/^[a-z]+$/.test(q)) {
    const py = String(it.pinyinPlain ?? '').toLowerCase()
    const compact = py.replace(/\s+/g, '')
    const initials = py.split(/\s+/).map((s) => s[0] ?? '').join('')
    return compact.includes(q) || initials.includes(q) || py.includes(q)
  }
  return (
    it.word.includes(q) ||
    (it.meaning ?? '').includes(q) ||
    (it.origin ?? '').includes(q) ||
    normField(it.semanticField).includes(q) ||
    (it.synonyms ?? []).some((s) => s.includes(q)) ||
    (it.antonyms ?? []).some((a) => a.includes(q))
  )
}

function matchDim(it: Idiom, key: string, value: string): boolean {
  if (key === 'field') return normField(it.semanticField) === value
  if (key === 'initial') return initialOf(it) === value
  if (key === 'stage') return it.curriculum?.stage === value
  return true
}

/** 跨维度 AND；同维度内部 OR。excludeKey 用于计算某一维度的选项计数。 */
function matchesFilters(it: Idiom, excludeKey = ''): boolean {
  for (const key of ['field', 'initial', 'stage']) {
    if (key === excludeKey) continue
    const values = (selected.value as Record<string, string[]>)[key] ?? []
    if (values.length && !values.some((v) => matchDim(it, key, v))) return false
  }
  return true
}

const filtered = computed(() =>
  idioms.value.filter((it) => matchSearch(it, state.value.q) && matchesFilters(it)),
)

function countOption(key: string, value: string): number {
  return idioms.value.filter(
    (it) => matchSearch(it, state.value.q) && matchesFilters(it, key) && matchDim(it, key, value),
  ).length
}

const fieldOptions = computed(() =>
  FIELDS.filter((f) => idioms.value.some((it) => normField(it.semanticField) === f)).map((f) => ({
    value: f,
    label: f,
    count: countOption('field', f),
  })),
)

const initialOptions = computed(() => {
  const present = new Set<string>()
  for (const it of idioms.value) {
    const ch = initialOf(it)
    if (ch) present.add(ch)
  }
  return [...present]
    .sort((a, b) => a.localeCompare(b))
    .map((ch) => ({ value: ch, label: ch.toUpperCase(), count: countOption('initial', ch) }))
})

const stageOptions = computed(() =>
  STAGE_ORDER.filter((s) => idioms.value.some((it) => it.curriculum?.stage === s)).map((s) => ({
    value: s,
    label: STAGE_LABEL[s] ?? s,
    count: countOption('stage', s),
  })),
)

const groups = computed(() => [
  { key: 'field', label: '语义场', options: fieldOptions.value },
  { key: 'initial', label: '首字拼音', options: initialOptions.value },
  { key: 'stage', label: '学段', options: stageOptions.value },
])

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / size.value)))
const paged = computed(() => {
  const p = Math.min(Math.max(1, state.value.page), pageCount.value)
  const start = (p - 1) * size.value
  return filtered.value.slice(start, start + size.value)
})

function onSearch(e: Event) {
  state.value.q = (e.target as HTMLInputElement).value
  state.value.page = 1
}

function onFilterChange() {
  state.value.page = 1
}

function clearAll() {
  url.reset()
}

function toRoute(srcPath: string): string {
  return encodeURI(`${BASE}${srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}

async function load() {
  loading.value = true
  failed.value = ''
  try {
    const res = await fetch(`${BASE}indexes/idioms.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    idioms.value = data.items ?? []
  } catch (err: any) {
    failed.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
}

watch(
  () => filtered.value.length,
  (n) => {
    const max = Math.max(1, Math.ceil(n / size.value))
    if (state.value.page > max) state.value.page = max
  },
)

onMounted(() => {
  load()
  // 首屏卡片 40ms 阶梯淡入；切页/筛选不重放
  window.setTimeout(() => {
    animateIn.value = false
  }, 900)
})
</script>

<template>
  <div class="wj-idiom-browser">
    <!-- 搜索：汉字 / 全拼 / 首字母 -->
    <div class="wj-idiom-searchbar">
      <label class="wj-idiom-search">
        <span class="wj-idiom-search-ico" aria-hidden="true">⌕</span>
        <input
          type="search"
          :value="state.q"
          class="wj-idiom-input"
          placeholder="搜索成语：汉字（锲而不舍）/ 全拼（qieerbushe）/ 首字母（qebs）"
          aria-label="搜索成语，支持汉字、全拼、首字母"
          autocomplete="off"
          spellcheck="false"
          @input="onSearch"
        />
      </label>
      <span class="wj-idiom-hint">输入即筛 · 支持全拼与首字母</span>
    </div>

    <WjFilterBar
      v-model="selected"
      :groups="groups"
      :total="filtered.length"
      unit="条"
      @change="onFilterChange"
    />

    <!-- 加载骨架 -->
    <div v-if="loading" class="wj-grid" aria-busy="true" aria-label="成语数据加载中">
      <div v-for="i in 12" :key="i" class="wj-panel wj-skel-card">
        <div class="wj-skel-bar w40" />
        <div class="wj-skel-bar w25" />
        <div class="wj-skel-bar w90" />
        <div class="wj-skel-bar w75" />
        <div class="wj-skel-bar w50" />
      </div>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="failed" class="wj-empty">
      <p>成语数据加载失败（{{ failed }}）。</p>
      <p>请先运行 <code>npm run build:index</code> 生成索引，或检查 <code>/indexes/idioms.json</code>。</p>
      <button type="button" class="wj-idiom-clear" @click="load">重新加载</button>
    </div>

    <!-- 空态 -->
    <div v-else-if="!filtered.length" class="wj-empty" role="status">
      <p>没有找到符合条件的成语。</p>
      <p class="wj-idiom-empty-hint">
        试试减少筛选条件，或改用全拼 / 首字母搜索。
      </p>
      <button type="button" class="wj-idiom-clear" aria-label="清除全部筛选与搜索" @click="clearAll">
        清除筛选
      </button>
    </div>

    <!-- 卡片网格 -->
    <template v-else>
      <div class="wj-grid">
        <a
          v-for="(it, i) in paged"
          :key="it.id"
          :href="toRoute(it.srcPath)"
          class="wj-panel wj-idiom-card"
          :class="{ 'wj-enter': animateIn }"
          :style="animateIn ? { animationDelay: `${i * 40}ms` } : undefined"
          :title="it.meaning"
        >
          <div class="wj-idiom-head">
            <span class="wj-idiom-word">{{ it.word }}</span>
            <span class="wj-idiom-py">{{ it.pinyin }}</span>
          </div>
          <p class="wj-idiom-meaning">{{ it.meaning || '释义整理中' }}</p>
          <div class="wj-idiom-chips">
            <span
              class="wj-chip wj-id-chip field"
              :title="it.semanticField && it.semanticField !== normField(it.semanticField) ? `原始分类：${it.semanticField}` : undefined"
            >{{ normField(it.semanticField) }}</span>
            <span
              v-for="s in (it.synonyms ?? []).slice(0, 3)"
              :key="s"
              class="wj-chip wj-id-chip syn"
            >{{ s }}</span>
          </div>
        </a>
      </div>

      <WjPager
        v-model:page="pageModel"
        v-model:size="size"
        :total="filtered.length"
        unit="条"
      />
    </template>
  </div>
</template>

<style scoped>
.wj-idiom-browser {
  margin-top: 8px;
}

.wj-idiom-searchbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin: 16px 0 6px;
}

.wj-idiom-search {
  position: relative;
  flex: 1 1 320px;
  display: flex;
  align-items: center;
}

.wj-idiom-search-ico {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 18px;
  line-height: 1;
  color: var(--wj-ink-3);
  pointer-events: none;
}

.wj-idiom-input {
  width: 100%;
  min-height: 44px;
  padding: 10px 14px 10px 38px;
  font-size: 15px;
  font-family: var(--wj-font-display);
  color: var(--wj-ink);
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.wj-idiom-input:focus {
  border-color: var(--wj-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wj-accent) 16%, transparent);
}
.wj-idiom-input::placeholder {
  color: var(--wj-ink-3);
}

.wj-idiom-hint {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--wj-ink-3);
}

/* 卡片 */
.wj-idiom-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 170px;
  text-decoration: none;
  color: inherit;
}
.wj-idiom-card:hover {
  text-decoration: none;
}
.wj-idiom-card:focus-visible {
  outline: 2px solid var(--wj-accent);
  outline-offset: 2px;
}

.wj-idiom-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.wj-idiom-word {
  font-family: var(--wj-font-display);
  font-size: 25px;
  font-weight: var(--wj-display-weight, 600);
  letter-spacing: 0.05em;
  line-height: 1.25;
  color: var(--wj-ink);
}
.wj-idiom-py {
  font-family: var(--wj-font-mono);
  font-size: 12px;
  color: var(--wj-ink-3);
  white-space: nowrap;
}

.wj-idiom-meaning {
  margin: 0;
  font-size: 14px;
  line-height: 1.65;
  color: var(--wj-ink-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.wj-idiom-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: auto;
}
.wj-id-chip {
  min-height: 24px;
  padding: 2px 9px;
  font-size: 12px;
  line-height: 1.3;
  pointer-events: none;
  cursor: default;
}
.wj-id-chip.field {
  color: var(--wj-ink-2);
  background: var(--wj-bg-soft);
  border-color: var(--wj-line);
}
.wj-id-chip.syn {
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
  border-color: color-mix(in srgb, var(--wj-accent) 45%, var(--wj-line));
}

/* 空态按钮 */
.wj-idiom-clear {
  margin-top: 6px;
  padding: 7px 18px;
  font-size: 13px;
  font-family: var(--wj-font-display);
  color: var(--wj-accent);
  background: var(--wj-card);
  border: 1px solid var(--wj-accent);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.wj-idiom-clear:hover {
  color: var(--wj-card);
  background: var(--wj-accent);
}
.wj-idiom-empty-hint {
  font-size: 13px;
  color: var(--wj-ink-3);
}

/* 骨架屏 */
.wj-skel-card {
  min-height: 170px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}
.wj-skel-bar {
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--wj-bg-soft) 0%,
    var(--wj-line-soft) 45%,
    var(--wj-bg-soft) 100%
  );
  background-size: 220% 100%;
  animation: wj-skel-shimmer 1.4s ease-in-out infinite;
}
.wj-skel-bar.w40 { width: 40%; height: 22px; }
.wj-skel-bar.w25 { width: 25%; }
.wj-skel-bar.w90 { width: 90%; }
.wj-skel-bar.w75 { width: 75%; }
.wj-skel-bar.w50 { width: 50%; }

@keyframes wj-skel-shimmer {
  0% { background-position: 120% 0; }
  100% { background-position: -120% 0; }
}

/* 首屏阶梯淡入 */
.wj-enter {
  animation: wj-idiom-fade 0.32s ease both;
}
@keyframes wj-idiom-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (max-width: 640px) {
  .wj-idiom-hint { display: none; }
  .wj-idiom-word { font-size: 22px; }
  .wj-idiom-card { min-height: 150px; }
}

@media (prefers-reduced-motion: reduce) {
  .wj-enter { animation: none; }
  .wj-skel-bar { animation: none; }
  .wj-idiom-card { transition: none; }
}
</style>

<!-- 数据视图页加宽版心（与 custom.css 中 .wj-chart 的做法一致，仅作用于本页） -->
<style>
.VPDoc:has(.wj-idiom-browser) .content-container,
.VPDoc:has(.wj-idiom-browser) .content {
  max-width: 1080px !important;
}
.VPDoc:has(.wj-idiom-browser) .container { max-width: 1440px !important; }
/* 少年主题的装饰性背景伪元素会向右溢出 180px，导致全站横向滚动条；本页单独裁掉。 */
body:has(.wj-idiom-browser) { overflow-x: hidden; }
</style>
