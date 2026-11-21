<script setup lang="ts">
// 万卷 · 题材标注校对台
// 数据源：/indexes/poems.json（基础元数据）+ 词条 frontmatter（genre_source/confidence/rule）
// 交互：逐条确认/改判 → localStorage('wj-genre-corrections') → 导出 Markdown frontmatter 片段
// 说明：只展示 genre_source: auto 的条目；人工标注（manual）与「待归类」不在此页重复校对。
import { computed, onMounted, ref } from 'vue'

type Poem = {
  id: string
  title: string
  author: string
  dynasty: string
  form: string
  tune?: string | null
  genre: string
  tags?: string[]
  curriculum?: { stage?: string; grade?: number; semester?: string }
  srcPath: string
}

type Annotation = {
  id: string
  genre: string
  source: string
  confidence: string
  rule: string
}

type Correction = { genre: string; at: string }

type ReviewItem = Poem & {
  autoGenre: string
  confidence: 'high' | 'medium' | 'low' | ''
  rule: string
}

const BASE = import.meta.env.BASE_URL
const STORAGE_KEY = 'wj-genre-corrections'

const POETRY_GENRES = [
  '思乡', '送别', '边塞', '山水', '田园', '咏物', '咏史怀古', '哲理', '家国',
  '爱情', '闺怨', '悼亡', '励志', '讽喻', '叙事', '闲适', '四时', '干谒',
]
const PROSE_GENRES = ['论说', '史传', '书序', '游记', '奏议', '寓言', '辞赋']
const GENRES = [...POETRY_GENRES, ...PROSE_GENRES]

// 读取词条 frontmatter（构建期打包，仅用于补充 poems.json 未输出的标注字段）
const rawFiles = import.meta.glob('../../../../content/poems/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function unquote(value: string): string {
  const text = String(value ?? '').trim()
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  return text
}

function parseAnnotation(raw: string): Annotation | null {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
  if (!fm) return null
  const fields: Record<string, string> = {}
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (m) fields[m[1]] = unquote(m[2])
  }
  if (!fields.id) return null
  return {
    id: fields.id,
    genre: fields.genre ?? '',
    source: fields.genre_source ?? '',
    confidence: fields.genre_confidence ?? '',
    rule: fields.genre_rule ?? '',
  }
}

const annotations = new Map<string, Annotation>()
for (const raw of Object.values(rawFiles)) {
  const ann = parseAnnotation(raw)
  if (ann) annotations.set(ann.id, ann)
}

const poems = ref<Poem[]>([])
const loading = ref(true)
const failed = ref('')
const corrections = ref<Record<string, Correction>>({})
const drafts = ref<Record<string, string>>({})

/** 自动标注条目（人工与待归类不进入校对池） */
const autoItems = computed<ReviewItem[]>(() =>
  poems.value
    .map((poem) => {
      const ann = annotations.get(poem.id)
      if (!ann || ann.source !== 'auto' || !ann.genre) return null
      return {
        ...poem,
        autoGenre: ann.genre,
        confidence: (ann.confidence || 'medium') as ReviewItem['confidence'],
        rule: ann.rule,
      }
    })
    .filter((item): item is ReviewItem => Boolean(item)),
)

const mediumItems = computed(() =>
  autoItems.value
    .filter((item) => item.confidence !== 'high')
    .sort((a, b) => a.title.localeCompare(b.title, 'zh')),
)
const highItems = computed(() =>
  autoItems.value
    .filter((item) => item.confidence === 'high')
    .sort((a, b) => a.title.localeCompare(b.title, 'zh')),
)

const autoTotal = computed(() => autoItems.value.length)
const correctedCount = computed(() =>
  autoItems.value.filter((item) => Boolean(corrections.value[item.id])).length,
)
const pendingCount = computed(() => Math.max(0, autoTotal.value - correctedCount.value))
const mediumPending = computed(() =>
  mediumItems.value.filter((item) => !corrections.value[item.id]).length,
)

function toRoute(srcPath: string) {
  return encodeURI(`${BASE}${srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}

function stageText(item: Poem) {
  const stage = item.curriculum?.stage
  if (!stage) return ''
  const label = stage === 'primary' ? '小学' : stage === 'junior' ? '初中' : stage === 'senior' ? '高中' : stage
  return item.curriculum?.grade ? `${label} ${item.curriculum.grade} 年级` : label
}

function currentGenre(item: ReviewItem): string {
  return corrections.value[item.id]?.genre ?? item.autoGenre
}

/** 已改判（校正值与原判不同）；仅确认不改判时不显示「原判」 */
function isChanged(item: ReviewItem): boolean {
  const correction = corrections.value[item.id]
  return Boolean(correction && correction.genre !== item.autoGenre)
}

function draftGenre(item: ReviewItem): string {
  return drafts.value[item.id] ?? currentGenre(item)
}

function selectGenre(item: ReviewItem, value: string) {
  drafts.value = { ...drafts.value, [item.id]: value }
}

function onSelectChange(item: ReviewItem, event: Event) {
  const value = (event.target as HTMLSelectElement)?.value
  if (value) selectGenre(item, value)
}

function save(item: ReviewItem) {
  const genre = draftGenre(item)
  if (!GENRES.includes(genre)) return
  corrections.value = {
    ...corrections.value,
    [item.id]: { genre, at: new Date().toISOString() },
  }
  persist()
}

function undo(item: ReviewItem) {
  const next = { ...corrections.value }
  delete next[item.id]
  corrections.value = next
  const nextDrafts = { ...drafts.value }
  delete nextDrafts[item.id]
  drafts.value = nextDrafts
  persist()
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(corrections.value))
  } catch {
    // QuotaExceeded / 隐私模式：静默降级，页面仍可校对与导出
  }
}

function loadCorrections() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    const clean: Record<string, Correction> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<Correction> | null
      if (v && typeof v.genre === 'string' && GENRES.includes(v.genre)) {
        clean[id] = { genre: v.genre, at: typeof v.at === 'string' ? v.at : '' }
      }
    }
    corrections.value = clean
  } catch {
    // 损坏数据不阻塞页面
  }
}

function stamp(date: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`
}

/** 导出：Markdown + 可批量回写的 frontmatter 片段 */
function exportCorrections() {
  const rows = autoItems.value
    .filter((item) => corrections.value[item.id])
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  if (!rows.length) return

  const now = new Date()
  const lines: string[] = [
    '# 题材校对结果',
    '',
    `> 导出时间：${now.toLocaleString('zh-CN', { hour12: false })}　·　共 ${rows.length} 条`,
    '>',
    '> 回写方式：按每条的「文件」定位词条，将 yaml 片段中的 genre 改为校对值，',
    '> 并保留 genre_source: manual；建议同时删除旧的 genre_confidence / genre_rule，',
    '> 或运行 `node scripts/tag-genre.mjs` 由工具统一维护。',
    '',
  ]

  for (const item of rows) {
    const correction = corrections.value[item.id]
    lines.push(`## ${item.title}`)
    lines.push('')
    lines.push('```yaml')
    lines.push(`id: ${item.id}`)
    lines.push(`genre: ${correction.genre}`)
    lines.push('genre_source: manual')
    lines.push('```')
    lines.push('')
    lines.push(`- 文件：\`${item.srcPath}\``)
    lines.push(`- 自动判定：${item.autoGenre}（${item.confidence || 'medium'}）`)
    lines.push(`- 判定依据：${item.rule || '—'}`)
    lines.push(`- 校对时间：${correction.at ? new Date(correction.at).toLocaleString('zh-CN', { hour12: false }) : '—'}`)
    lines.push('')
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `genre-corrections-${stamp(now)}.md`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

onMounted(async () => {
  loadCorrections()
  try {
    const res = await fetch(`${BASE}indexes/poems.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    poems.value = data.items ?? []
  } catch (err: any) {
    failed.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="wj-gr">
    <p v-if="loading" class="wj-note">正在加载作品与标注数据（/indexes/poems.json）…</p>
    <p v-else-if="failed" class="wj-note">
      数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成索引。
    </p>

    <template v-else>
      <!-- 统计条 -->
      <section class="wj-gr-stats" aria-label="校对统计">
        <div class="wj-gr-stat">
          <span>待校对</span>
          <b>{{ pendingCount }}</b>
        </div>
        <div class="wj-gr-stat">
          <span>已校对</span>
          <b>{{ correctedCount }}</b>
        </div>
        <div class="wj-gr-stat">
          <span>自动标注总数</span>
          <b>{{ autoTotal }}</b>
        </div>
        <button class="wj-chip wj-gr-export" :disabled="!correctedCount" @click="exportCorrections">
          导出校对结果
        </button>
      </section>

      <p class="wj-gr-hint">
        本页只列出 <code>genre_source: auto</code> 的自动标注；人工标注与「待归类」不在此重复校对。
        改动保存在浏览器 localStorage（<code>wj-genre-corrections</code>），点「导出校对结果」可下载 Markdown，
        按文件路径批量回写 frontmatter。
      </p>

      <!-- medium：优先展示 -->
      <section class="wj-gr-section">
        <h3>
          <span class="wj-gr-section-title">medium 置信度</span>
          <span class="wj-gr-section-meta">{{ mediumPending }} 条待校对 / 共 {{ mediumItems.length }} 条</span>
        </h3>
        <div v-if="mediumItems.length" class="wj-gr-grid">
          <article
            v-for="item in mediumItems"
            :key="item.id"
            class="wj-panel wj-gr-card"
            :class="{ 'is-corrected': corrections[item.id] }"
          >
            <div class="wj-gr-card-head">
              <a :href="toRoute(item.srcPath)" class="wj-gr-title">{{ item.title }}</a>
              <span v-if="corrections[item.id]" class="wj-gr-badge">已校对</span>
            </div>
            <p class="wj-gr-meta">
              {{ item.author }} · {{ item.dynasty }} · {{ item.form }}
              <template v-if="stageText(item)"> · {{ stageText(item) }}</template>
            </p>
            <div class="wj-gr-genre">
              <span class="wj-gr-label">当前题材</span>
              <b>{{ currentGenre(item) }}</b>
              <span
                v-if="isChanged(item)"
                class="wj-gr-original"
              >原判 {{ item.autoGenre }}</span>
            </div>
            <p class="wj-gr-rule">
              <span class="wj-gr-label">判定依据</span>
              <span>{{ item.rule || '—' }}</span>
            </p>
            <div class="wj-gr-actions">
              <select
                class="wj-gr-select"
                :value="draftGenre(item)"
                :aria-label="`为《${item.title}》选择题材`"
                @change="onSelectChange(item, $event)"
              >
                <option v-for="genre in GENRES" :key="genre" :value="genre">{{ genre }}</option>
              </select>
              <button
                class="wj-chip wj-gr-submit"
                :class="{ on: draftGenre(item) !== currentGenre(item) }"
                @click="save(item)"
              >
                {{ draftGenre(item) === currentGenre(item) ? '确认' : '改判' }}
              </button>
              <button v-if="corrections[item.id]" class="wj-chip wj-gr-undo" @click="undo(item)">
                撤销
              </button>
            </div>
          </article>
        </div>
        <p v-else class="wj-note">暂无 medium 置信度的自动标注。</p>
      </section>

      <!-- high：默认折叠 -->
      <details class="wj-gr-high">
        <summary>
          <span class="wj-gr-section-title">high 置信度</span>
          <span class="wj-gr-section-meta">{{ highItems.length }} 条 · 默认折叠</span>
        </summary>
        <div v-if="highItems.length" class="wj-gr-grid">
          <article
            v-for="item in highItems"
            :key="item.id"
            class="wj-panel wj-gr-card"
            :class="{ 'is-corrected': corrections[item.id] }"
          >
            <div class="wj-gr-card-head">
              <a :href="toRoute(item.srcPath)" class="wj-gr-title">{{ item.title }}</a>
              <span v-if="corrections[item.id]" class="wj-gr-badge">已校对</span>
            </div>
            <p class="wj-gr-meta">
              {{ item.author }} · {{ item.dynasty }} · {{ item.form }}
              <template v-if="stageText(item)"> · {{ stageText(item) }}</template>
            </p>
            <div class="wj-gr-genre">
              <span class="wj-gr-label">当前题材</span>
              <b>{{ currentGenre(item) }}</b>
              <span
                v-if="isChanged(item)"
                class="wj-gr-original"
              >原判 {{ item.autoGenre }}</span>
            </div>
            <p class="wj-gr-rule">
              <span class="wj-gr-label">判定依据</span>
              <span>{{ item.rule || '—' }}</span>
            </p>
            <div class="wj-gr-actions">
              <select
                class="wj-gr-select"
                :value="draftGenre(item)"
                :aria-label="`为《${item.title}》选择题材`"
                @change="onSelectChange(item, $event)"
              >
                <option v-for="genre in GENRES" :key="genre" :value="genre">{{ genre }}</option>
              </select>
              <button
                class="wj-chip wj-gr-submit"
                :class="{ on: draftGenre(item) !== currentGenre(item) }"
                @click="save(item)"
              >
                {{ draftGenre(item) === currentGenre(item) ? '确认' : '改判' }}
              </button>
              <button v-if="corrections[item.id]" class="wj-chip wj-gr-undo" @click="undo(item)">
                撤销
              </button>
            </div>
          </article>
        </div>
        <p v-else class="wj-note">暂无 high 置信度的自动标注。</p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.wj-gr {
  margin-top: 8px;
}

/* 统计条 */
.wj-gr-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0;
  margin: 14px 0 10px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
}
.wj-gr-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 120px;
  padding: 12px 18px;
  border-right: 1px solid var(--wj-line);
}
.wj-gr-stat span {
  font-size: 11px;
  color: var(--wj-ink-3);
  letter-spacing: var(--wj-label-tracking);
}
.wj-gr-stat b {
  font-family: var(--wj-font-display);
  font-size: 26px;
  line-height: 1.1;
  color: var(--wj-ink);
  font-weight: var(--wj-display-weight);
}
.wj-gr-export {
  margin: auto 14px auto auto;
  font-weight: 600;
}
.wj-gr-export:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

.wj-gr-hint {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--wj-ink-2);
}
.wj-gr-hint code {
  font-size: 12px;
}

/* 分组 */
.wj-gr-section {
  margin-top: 18px;
}
.wj-gr-section h3,
.wj-gr-high summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--wj-line);
  font-size: 15px;
  font-weight: 600;
  color: var(--wj-ink);
}
.wj-gr-section-title {
  letter-spacing: var(--wj-label-tracking);
  text-transform: uppercase;
  font-size: 12px;
  color: var(--wj-ink-2);
}
.wj-gr-section-meta {
  font-size: 12px;
  font-weight: 400;
  color: var(--wj-ink-3);
  letter-spacing: normal;
}
.wj-gr-high {
  margin-top: 22px;
}
.wj-gr-high summary {
  cursor: pointer;
  user-select: none;
  list-style: none;
}
.wj-gr-high summary::-webkit-details-marker {
  display: none;
}
.wj-gr-high summary::after {
  content: '展开';
  margin-left: auto;
  font-size: 12px;
  font-weight: 400;
  color: var(--wj-accent);
}
.wj-gr-high[open] summary::after {
  content: '收起';
}

/* 卡片 */
.wj-gr-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}
.wj-gr-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}
.wj-gr-card:hover {
  transform: none;
  border-color: var(--wj-ink-3);
  box-shadow: var(--wj-shadow);
}
.wj-gr-card.is-corrected {
  border-color: var(--wj-accent);
  box-shadow: inset 0 0 0 1px var(--wj-accent);
}
.wj-gr-card-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.wj-gr-title {
  font-family: var(--wj-font-display);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--wj-ink);
  text-decoration: none;
  border-bottom: 1px solid transparent;
}
.wj-gr-title:hover {
  color: var(--wj-accent);
  border-bottom-color: var(--wj-accent);
}
.wj-gr-badge {
  margin-left: auto;
  flex: none;
  padding: 1px 8px;
  font-size: 11px;
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
  border: 1px solid var(--wj-accent);
  border-radius: var(--wj-radius-pill);
  white-space: nowrap;
}
.wj-gr-meta {
  margin: 0;
  font-size: 12px;
  color: var(--wj-ink-3);
}
.wj-gr-genre {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  font-size: 14px;
}
.wj-gr-genre b {
  font-family: var(--wj-font-display);
  font-size: 17px;
  color: var(--wj-accent);
}
.wj-gr-original {
  font-size: 11px;
  color: var(--wj-ink-3);
  text-decoration: line-through;
}
.wj-gr-label {
  flex: none;
  font-size: 11px;
  color: var(--wj-ink-3);
  letter-spacing: var(--wj-label-tracking);
}
.wj-gr-rule {
  display: flex;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--wj-ink-2);
}
.wj-gr-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  padding-top: 6px;
  border-top: 1px dashed var(--wj-line-soft);
}
.wj-gr-select {
  min-width: 120px;
  padding: 5px 8px;
  font-family: var(--wj-font-body);
  font-size: 13px;
  color: var(--wj-ink);
  background: var(--wj-bg);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-sm);
  outline: none;
}
.wj-gr-select:focus {
  border-color: var(--wj-accent);
}
.wj-gr-submit {
  font-weight: 600;
}
.wj-gr-undo {
  color: var(--wj-ink-3);
}

@media (max-width: 640px) {
  .wj-gr-stat {
    min-width: 96px;
    padding: 10px 14px;
  }
  .wj-gr-stat b {
    font-size: 22px;
  }
  .wj-gr-export {
    width: 100%;
    justify-content: center;
    margin: 0;
    border-radius: 0;
    border-top: 1px solid var(--wj-line);
  }
  .wj-gr-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wj-gr-card,
  .wj-gr-card:hover {
    transition: none;
  }
}
</style>

<style>
/* 校对台需要横向空间：与图表页一致加宽版心，让卡片形成 2-3 列 */
.VPDoc:has(.wj-gr) .content-container,
.VPDoc:has(.wj-gr) .content {
  max-width: 1100px !important;
}
.VPDoc:has(.wj-gr) .container {
  max-width: 1440px !important;
}
/* youth 主题的右下柔光斑会以 right:-180px 溢出；本页单独裁掉横向滚动 */
html:has(.wj-gr),
body:has(.wj-gr) {
  overflow-x: clip;
}
@media (min-width: 960px) {
  /* 校对台以卡片为主，不需要右侧页面目录；释放宽度给卡片网格 */
  .VPDoc:has(.wj-gr) .main {
    width: 100% !important;
  }
  .VPDoc:has(.wj-gr) .aside {
    display: none;
  }
}
</style>
