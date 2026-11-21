<script setup lang="ts">
// 万卷 · 高级检索（自建匹配：汉字子串 + 全拼 + 首字母）
// 数据源：/indexes/search.json（含 tokens / pinyin / pinyinFirst / srcPath）
import { computed, onMounted, ref } from 'vue'

type SearchItem = {
  type: 'poem' | 'idiom' | 'quote' | 'author' | 'imagery'
  id: string
  title: string
  subtitle: string
  tokens: string[]
  pinyin: string
  pinyinFirst: string
  excerpt: string
  srcPath: string
}
type Result = SearchItem & { score: number; matched: string }

const TYPE_LABEL: Record<string, string> = {
  poem: '作品', idiom: '成语', quote: '名句', author: '作者', imagery: '意象',
}
const TYPE_ROUTE: Record<string, string> = {
  poem: '/poems/', idiom: '/idioms/', quote: '/quotes/', author: '/authors/', imagery: '/imagery/',
}

const query = ref('')
const items = ref<SearchItem[]>([])
// 空态推荐词：混合汉字与拼音示例，帮助用户发现三种检索通道
const SUGGEST = ['静夜思', 'jys', '李白', '月', '青梅竹马', '但愿人长久']
const failed = ref('')
const activeType = ref<string>('all')

onMounted(async () => {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}indexes/search.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    items.value = data.items ?? []
  } catch (err: any) {
    failed.value = err?.message ?? String(err)
  }
})

/** srcPath → 站点路由（与 config.mts 的 rewrite 规则一致） */
function toRoute(item: SearchItem) {
  const clean = item.srcPath.replace(/^content\//, '').replace(/\.md$/, '')
  return encodeURI(`${import.meta.env.BASE_URL}${clean}`)
}

function match(item: SearchItem, qRaw: string): Result | null {
  const q = qRaw.trim().toLowerCase()
  if (!q) return null
  const pyCompact = item.pinyin.replace(/\s+/g, '').toLowerCase()
  const pyFirst = (item.pinyinFirst || '').toLowerCase()
  const syllables = item.pinyin.toLowerCase().split(/\s+/)
  const title = item.title.toLowerCase()
  const subtitle = item.subtitle.toLowerCase()

  // 纯 ASCII：按拼音检索（首字母前缀 / 全拼包含 / 音节前缀）
  if (/^[a-z]+$/.test(q)) {
    if (pyFirst.startsWith(q)) return { ...item, score: 100, matched: `首字母 ${pyFirst}` }
    if (pyCompact.includes(q)) return { ...item, score: 85, matched: `全拼 ${pyCompact}` }
    if (syllables.some((s) => s.startsWith(q))) return { ...item, score: 70, matched: `音节 ${q}` }
    return null
  }
  // 汉字：标题 > 分词精确 > 副题 > 摘要
  if (title.includes(q)) return { ...item, score: 100, matched: item.title }
  if (item.tokens.some((t) => t === q)) return { ...item, score: 90, matched: q }
  if (subtitle.includes(q)) return { ...item, score: 75, matched: item.subtitle }
  if (item.excerpt && item.excerpt.toLowerCase().includes(q)) return { ...item, score: 60, matched: item.excerpt }
  if (item.tokens.some((t) => t.startsWith(q))) return { ...item, score: 50, matched: q }
  return null
}

const results = computed<Result[]>(() => {
  if (!query.value.trim()) return []
  return items.value
    .map((it) => match(it, query.value))
    .filter((r): r is Result => r !== null)
    .filter((r) => activeType.value === 'all' || r.type === activeType.value)
    .sort((a, b) => b.score - a.score)
    .slice(0, 100)
})

const typeCounts = computed(() => {
  if (!query.value.trim()) return {}
  const counts: Record<string, number> = {}
  for (const it of items.value) {
    const m = match(it, query.value)
    if (m) counts[it.type] = (counts[it.type] ?? 0) + 1
  }
  return counts
})
</script>

<template>
  <div class="wj-search">
    <input
      v-model="query"
      class="wj-input"
      type="search"
      placeholder="输入汉字、全拼或首字母，如：静夜 / jingye / jys / ss"
      autocomplete="off"
      spellcheck="false"
    />

    <div v-if="failed" class="wj-note">
      检索索引加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code> 生成 <code>search.json</code>。
    </div>

    <div v-if="query.trim()" class="wj-toolbar">
      <button :class="{ active: activeType === 'all' }" @click="activeType = 'all'">
        全部（{{ Object.values(typeCounts).reduce((a, b) => a + b, 0) }}）
      </button>
      <button
        v-for="(label, type) in TYPE_LABEL"
        :key="type"
        :class="{ active: activeType === type }"
        :disabled="!typeCounts[type]"
        @click="activeType = type"
      >
        {{ label }}（{{ typeCounts[type] ?? 0 }}）
      </button>
    </div>

    <p v-if="query.trim() && results.length === 0" class="wj-note">未找到匹配「{{ query }}」的条目。试试全拼（jingyesi）或首字母（jys）。</p>

    <ul v-if="results.length" class="wj-results">
      <li v-for="r in results" :key="r.type + r.id" class="wj-result">
        <span class="wj-chip" :data-type="r.type">{{ TYPE_LABEL[r.type] }}</span>
        <a :href="toRoute(r)">{{ r.title }}</a>
        <span class="wj-sub">{{ r.subtitle }}</span>
        <span v-if="r.excerpt" class="wj-excerpt">{{ r.excerpt }}</span>
        <code class="wj-src">{{ r.srcPath }}</code>
      </li>
    </ul>

    <div v-else-if="!query.trim()" class="wj-search-empty">
      <p class="wj-note">库内 {{ items.length }} 条索引可直接检索：汉字、全拼或首字母皆可。</p>
      <div class="wj-suggest">
        <span class="wj-suggest-label">试试：</span>
        <button v-for="kw in SUGGEST" :key="kw" class="wj-suggest-chip" @click="query = kw">{{ kw }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wj-input {
  width: 100%;
  padding: 10px 14px;
  font-size: 15px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  outline: none;
}
.wj-input:focus {
  border-color: var(--vp-c-brand-1);
}
.wj-results {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}
.wj-result {
  padding: 10px 4px;
  border-bottom: 1px dashed var(--vp-c-divider);
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}
.wj-chip {
  padding: 1px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-2);
  white-space: nowrap;
}
.wj-sub {
  color: var(--vp-c-text-2);
  font-size: 13px;
}
.wj-excerpt {
  flex-basis: 100%;
  color: var(--vp-c-text-3);
  font-size: 13px;
}
.wj-src {
  font-size: 12px;
  color: var(--vp-c-text-3);
}
</style>
