<script setup lang="ts">
// 万卷 · 成语语义场（同场近义对比）
// 数据源：/indexes/idioms.json（semantic_field 分组；无语义场归「待归类」）
// 检索：汉字子串（词/释义/出处）+ 无声调全拼 + 首字母（参照 AdvancedSearch 的三通道做法）。
// 感情色彩列：当前索引未携带该字段，frontmatter（connotation 等）补齐后自动出现。
import { computed, onMounted, ref } from 'vue'

type Idiom = {
  id: string
  word: string
  pinyin: string
  pinyinPlain: string
  meaning: string
  origin: string
  originLink?: string | null
  semanticField?: string | null
  synonyms: string[]
  antonyms: string[]
  [key: string]: unknown
}

const BASE = import.meta.env.BASE_URL
const UNCATEGORIZED = '待归类'

const idioms = ref<Idiom[]>([])
const loading = ref(true)
const failed = ref('')
const query = ref('')
const activeField = ref('all')

/** frontmatter 中可能的感情色彩字段名（补齐数据后自动展示该列） */
const TONE_KEYS = ['connotation', 'emotion', 'color', 'sentiment', '感情色彩']

const hasTone = computed(() =>
  idioms.value.some((i) => TONE_KEYS.some((k) => typeof i[k] === 'string' && (i[k] as string).trim())),
)

const fields = computed(() => {
  const counts = new Map<string, number>()
  for (const it of idioms.value) {
    const f = it.semanticField?.trim() || UNCATEGORIZED
    counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
})

function matchQuery(it: Idiom, qRaw: string): boolean {
  const q = qRaw.trim().toLowerCase()
  if (!q) return true
  if (/^[a-z]+$/.test(q)) {
    const pyCompact = (it.pinyinPlain || '').replace(/\s+/g, '').toLowerCase()
    const initials = (it.pinyinPlain || '')
      .toLowerCase()
      .split(/\s+/)
      .map((s) => s[0] ?? '')
      .join('')
    if (pyCompact.includes(q) || initials.startsWith(q) || pyCompact.startsWith(q)) return true
    return (it.pinyin || '').toLowerCase().replace(/\s+/g, '').includes(q)
  }
  return (
    it.word.includes(q) ||
    it.meaning.includes(q) ||
    it.origin.includes(q) ||
    it.synonyms?.some((s) => s.includes(q)) ||
    it.antonyms?.some((s) => s.includes(q))
  )
}

const shown = computed(() => {
  let list = idioms.value
  if (activeField.value !== 'all') {
    list = list.filter((it) => (it.semanticField?.trim() || UNCATEGORIZED) === activeField.value)
  }
  if (query.value.trim()) list = list.filter((it) => matchQuery(it, query.value))
  return list
})

const shownTone = (it: Idiom): string => {
  for (const k of TONE_KEYS) {
    const v = it[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/** 感情色彩 → pill 样式（褒义=主题强调色 / 贬义=沉墨 / 中性=灰） */
function toneClass(tone: string): string {
  if (tone.includes('褒')) return 'pos'
  if (tone.includes('贬') || tone.includes('讥') || tone.includes('刺')) return 'neg'
  return 'mid'
}

/** 出处摘要：截断展示，title 悬浮看全文 */
function originBrief(origin: string): string {
  const max = 46
  return origin.length > max ? origin.slice(0, max) + '…' : origin
}

function toRoute(srcPath: string) {
  return encodeURI(`${BASE}${srcPath.replace(/^content\//, '').replace(/\.md$/, '')}`)
}

onMounted(async () => {
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
})
</script>

<template>
  <div class="wj-field">
    <p v-if="loading" class="wj-note">正在加载成语数据（/indexes/idioms.json）…</p>
    <p v-else-if="failed" class="wj-note">
      成语数据加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成索引。
    </p>
    <template v-else>
      <!-- 语义场切换 -->
      <div class="wj-toolbar">
        <button :class="{ active: activeField === 'all' }" @click="activeField = 'all'">
          全部（{{ idioms.length }}）
        </button>
        <button
          v-for="f in fields"
          :key="f.name"
          :class="{ active: activeField === f.name }"
          @click="activeField = f.name"
        >
          {{ f.name }}（{{ f.count }}）
        </button>
      </div>

      <!-- 搜索过滤（汉字 / 全拼 / 首字母） -->
      <input
        v-model="query"
        class="wj-input"
        type="search"
        placeholder="在当前语义场内过滤：汉字（志）/ 全拼（zhixin）/ 首字母（zx）"
        autocomplete="off"
        spellcheck="false"
      />

      <!-- 同场近义对比表 -->
      <p v-if="!shown.length" class="wj-note">
        {{ query.trim() ? `未找到匹配「${query.trim()}」的成语，试试全拼或首字母。` : '数据整理中：该语义场暂无成语。' }}
      </p>
      <div v-else class="wj-table-wrap">
        <table class="wj-table">
          <thead>
            <tr>
              <th>成语</th>
              <th>释义</th>
              <th>出处摘要</th>
              <th>近义</th>
              <th>反义</th>
              <th v-if="hasTone">感情色彩</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="it in shown" :key="it.id">
              <td class="wj-td-word">
                <a :href="toRoute(it.srcPath)">{{ it.word }}</a>
                <span class="wj-py">{{ it.pinyin }}</span>
              </td>
              <td class="wj-td-meaning">{{ it.meaning }}</td>
              <td class="wj-td-origin" :title="it.origin">{{ originBrief(it.origin) }}</td>
              <td class="wj-td-rel">
                <span v-for="s in it.synonyms" :key="'s' + s" class="wj-pill syn">{{ s }}</span>
                <span v-if="!it.synonyms?.length" class="wj-empty">—</span>
              </td>
              <td class="wj-td-rel">
                <span v-for="a in it.antonyms" :key="'a' + a" class="wj-pill ant">{{ a }}</span>
                <span v-if="!it.antonyms?.length" class="wj-empty">—</span>
              </td>
              <td v-if="hasTone" class="wj-td-tone">
                <span v-if="shownTone(it)" class="wj-pill" :class="toneClass(shownTone(it))">{{ shownTone(it) }}</span>
                <span v-else class="wj-empty">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="wj-note">
        同场成语互为近义候选，对比释义与出处置换使用；感情色彩列在数据补齐 connotation 字段后自动亮出。
      </p>
    </template>
  </div>
</template>

<style scoped>
.wj-input {
  width: 100%;
  padding: 10px 14px;
  font-size: 15px;
  border: 1px solid var(--vp-c-divider);
  border-radius: var(--wj-radius);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
  font-family: var(--wj-font-display);
}
.wj-input:focus {
  border-color: var(--wj-accent);
}

.wj-table-wrap {
  margin-top: 14px;
  overflow-x: auto;
  border: 1px solid var(--wj-line);
  border-radius: var(--wj-radius);
  background: var(--wj-card);
}
.wj-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.wj-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 12px;
  letter-spacing: var(--wj-label-tracking);
  color: var(--wj-ink-2);
  border-bottom: 1px solid var(--wj-line);
  background: var(--wj-bg-soft);
  white-space: nowrap;
}
.wj-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--wj-line-soft);
  vertical-align: top;
  color: var(--wj-ink);
}
.wj-table tbody tr:last-child td {
  border-bottom: none;
}
.wj-table tbody tr:hover {
  background: var(--wj-accent-tint);
}

.wj-td-word {
  white-space: nowrap;
}
.wj-td-word a {
  color: var(--wj-accent);
  font-weight: 600;
  font-size: 15px;
  text-decoration: none;
}
.wj-td-word a:hover {
  text-decoration: underline;
}
.wj-py {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: var(--wj-ink-3);
  font-family: var(--wj-font-mono);
}
.wj-td-meaning {
  min-width: 14em;
  max-width: 22em;
}
.wj-td-origin {
  max-width: 18em;
  font-size: 13px;
  color: var(--wj-ink-2);
}
.wj-td-rel {
  max-width: 12em;
}
.wj-empty {
  color: var(--wj-ink-3);
}

.wj-pill {
  display: inline-block;
  margin: 1px 4px 1px 0;
  padding: 1px 9px;
  border-radius: var(--wj-radius-pill);
  font-size: 12px;
  border: 1px solid var(--wj-line);
  color: var(--wj-ink-2);
  white-space: nowrap;
}
.wj-pill.syn {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
.wj-pill.ant {
  border-style: dashed;
}
.wj-pill.pos {
  border-color: var(--wj-accent);
  color: var(--wj-accent);
  background: var(--wj-accent-tint);
}
.wj-pill.neg {
  border-color: var(--wj-ink-2);
  color: var(--wj-ink);
  background: var(--wj-bg-soft);
}
.wj-pill.mid {
  color: var(--wj-ink-3);
}
</style>
