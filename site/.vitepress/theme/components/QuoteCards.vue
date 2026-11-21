<script setup lang="ts">
// 万卷 · 名句引用卡 / 素材包
// 数据源：/indexes/quotes.json（theme 分组）+ /indexes/poems.json（出处反查）+ /indexes/idioms.json（主题关联成语）
// 功能：主题筛选、卡片复制（「名句」——作者《出处》）、按主题导出 markdown 素材包（浏览器下载 .md）。
import { computed, onMounted, ref } from 'vue'

type Quote = {
  id: string
  text: string
  author: string
  work?: string | null
  theme: string[]
  dynasty?: string
  curriculum?: { stage?: string; grade?: number }
  srcPath: string
}
type Poem = { id: string; title: string }
type Idiom = { id: string; word: string; pinyin: string; meaning: string; origin: string; semanticField?: string | null; tags: string[] }

const BASE = import.meta.env.BASE_URL
const ALL = '全部'
const STAGE_LABEL: Record<string, string> = { primary: '小学', junior: '初中', senior: '高中' }

const quotes = ref<Quote[]>([])
const poems = ref<Poem[]>([])
const idioms = ref<Idiom[]>([])
const loading = ref(true)
const failed = ref('')
const activeTheme = ref(ALL)
const copiedId = ref('')

const titleByWork = computed(() => new Map(poems.value.map((p) => [p.id, p.title])))

/** 主题分组（计数降序） */
const themes = computed(() => {
  const counts = new Map<string, number>()
  for (const q of quotes.value) for (const t of q.theme ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
})

const cards = computed(() =>
  activeTheme.value === ALL ? quotes.value : quotes.value.filter((q) => (q.theme ?? []).includes(activeTheme.value)),
)

function workTitle(q: Quote): string {
  return q.work ? (titleByWork.value.get(q.work) ?? '') : ''
}

/** 复制格式：「名句」——作者《出处》（无出处则省书名） */
function citeText(q: Quote): string {
  const t = workTitle(q)
  return t ? `「${q.text}」——${q.author}《${t}》` : `「${q.text}」——${q.author}`
}

async function copyQuote(q: Quote) {
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
    setTimeout(() => {
      if (copiedId.value === q.id) copiedId.value = ''
    }, 1600)
  } catch {
    window.prompt('复制失败，请手动复制：', text)
  }
}

/** 主题关联成语：semantic_field 同名 或 tags 含该主题 */
function relatedIdioms(theme: string): Idiom[] {
  return idioms.value.filter(
    (i) => i.semanticField === theme || (i.tags ?? []).includes(theme),
  )
}

function stageText(q: Quote): string {
  const st = q.curriculum?.stage
  return st ? STAGE_LABEL[st] ?? st : ''
}

/** 生成主题素材包 markdown 并触发下载 */
function exportPack(theme: string) {
  const list = quotes.value.filter((q) => (q.theme ?? []).includes(theme))
  if (!list.length) return
  const rel = relatedIdioms(theme)
  const lines: string[] = []
  lines.push(`# 「${theme}」主题素材包`)
  lines.push('')
  lines.push(`> 由万卷知识库生成 · 共 ${list.length} 条名句${rel.length ? `、${rel.length} 条关联成语` : ''}`)
  lines.push('')
  lines.push('## 名句')
  lines.push('')
  for (const q of list) {
    const t = workTitle(q)
    const bits = [q.dynasty, stageText(q)].filter(Boolean).join(' · ')
    lines.push(`- ${citeText(q)}${bits ? `（${bits}）` : ''}`)
  }
  lines.push('')
  lines.push('## 关联成语')
  lines.push('')
  if (rel.length) {
    for (const i of rel) {
      const origin = i.origin.length > 60 ? i.origin.slice(0, 60) + '…' : i.origin
      lines.push(`- **${i.word}**（${i.pinyin}）：${i.meaning}（${origin}）`)
    }
  } else {
    lines.push('（该主题的关联成语整理中）')
  }
  lines.push('')

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `素材包-${theme}.md`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

onMounted(async () => {
  try {
    const [q1, q2, q3] = await Promise.all([
      fetch(`${BASE}indexes/quotes.json`),
      fetch(`${BASE}indexes/poems.json`),
      fetch(`${BASE}indexes/idioms.json`),
    ])
    if (!q1.ok) throw new Error(`quotes.json HTTP ${q1.status}`)
    quotes.value = (await q1.json()).items ?? []
    if (q2.ok) poems.value = (await q2.json()).items ?? []
    if (q3.ok) idioms.value = (await q3.json()).items ?? []
  } catch (err: any) {
    failed.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="wj-cards">
    <p v-if="loading" class="wj-note">正在加载名句数据（/indexes/quotes.json）…</p>
    <p v-else-if="failed" class="wj-note">
      名句数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成索引。
    </p>
    <template v-else>
      <!-- 主题分组 -->
      <div class="wj-toolbar">
        <button :class="{ active: activeTheme === ALL }" @click="activeTheme = ALL">
          全部（{{ quotes.length }}）
        </button>
        <button
          v-for="t in themes"
          :key="t.name"
          :class="{ active: activeTheme === t.name }"
          @click="activeTheme = t.name"
        >
          {{ t.name }}（{{ t.count }}）
        </button>
        <button
          v-if="activeTheme !== ALL"
          class="wj-export"
          @click="exportPack(activeTheme)"
        >
          ↓ 导出「{{ activeTheme }}」素材包 .md
        </button>
      </div>

      <!-- 引用卡 -->
      <div v-if="cards.length" class="wj-card-grid">
        <figure v-for="q in cards" :key="q.id" class="wj-qcard">
          <blockquote class="wj-qtext">{{ q.text }}</blockquote>
          <figcaption class="wj-qmeta">
            <span class="wj-qsrc">
              ——{{ q.author }}<template v-if="workTitle(q)">《{{ workTitle(q) }}》</template>
              <i v-if="q.dynasty" class="wj-qdyn">{{ q.dynasty }}</i>
              <i v-if="stageText(q)" class="wj-qdyn">{{ stageText(q) }}</i>
            </span>
            <span class="wj-qthemes">
              <i v-for="t in q.theme" :key="t" class="wj-pill" :class="{ on: t === activeTheme }">{{ t }}</i>
            </span>
          </figcaption>
          <button class="wj-copy" :class="{ done: copiedId === q.id }" @click="copyQuote(q)">
            {{ copiedId === q.id ? '已复制 ✓' : '复制' }}
          </button>
        </figure>
      </div>
      <p v-else class="wj-note">数据整理中：该主题暂无名句。</p>

      <!-- 关联成语提示（选中主题时） -->
      <p v-if="activeTheme !== ALL" class="wj-note">
        关联成语：{{
          relatedIdioms(activeTheme).length
            ? relatedIdioms(activeTheme).map((i) => i.word).join('、')
            : '整理中（成语的 semantic_field 与主题同名或打同名标签即自动关联）'
        }}
      </p>
    </template>
  </div>
</template>

<style scoped>
.wj-export {
  font-weight: 600;
  border-color: var(--wj-accent);
  color: var(--wj-accent);
}
.wj-export:hover {
  background: var(--wj-accent-tint);
}

.wj-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  margin-top: 14px;
}

/* 引用卡：名句大字（诗体）+ 出处 + 主题 pill + 复制 */
.wj-qcard {
  position: relative;
  margin: 0;
  padding: 20px 20px 14px;
  border: 1px solid var(--wj-line);
  border-top: 3px solid var(--wj-accent);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
  box-shadow: var(--wj-shadow);
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: box-shadow 0.18s, transform 0.18s;
}
.wj-qcard:hover {
  box-shadow: var(--wj-shadow-hover);
  transform: translateY(-2px);
}
.wj-qtext {
  margin: 0;
  font-family: var(--wj-font-poem);
  font-size: 21px;
  line-height: 1.7;
  color: var(--wj-ink);
  text-align: center;
}
.wj-qtext::before {
  content: '「';
  color: var(--wj-accent);
}
.wj-qtext::after {
  content: '」';
  color: var(--wj-accent);
}
.wj-qmeta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}
.wj-qsrc {
  color: var(--wj-ink-2);
}
.wj-qdyn {
  font-style: normal;
  margin-left: 8px;
  padding: 0 8px;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  color: var(--wj-ink-3);
  font-size: 12px;
}
.wj-qthemes {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.wj-pill {
  font-style: normal;
  padding: 1px 10px;
  border-radius: var(--wj-radius-pill);
  border: 1px solid var(--wj-line);
  color: var(--wj-ink-2);
  font-size: 12px;
  white-space: nowrap;
}
.wj-pill.on {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
.wj-copy {
  align-self: flex-end;
  padding: 3px 14px;
  font-size: 12px;
  font-family: var(--wj-font-display);
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius-pill);
  background: var(--wj-card);
  color: var(--wj-ink-2);
  cursor: pointer;
  transition: all 0.16s;
}
.wj-copy:hover {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
}
.wj-copy.done {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
</style>
