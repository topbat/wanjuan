<script setup lang="ts">
/**
 * 万卷 · 全局搜索（统一入口）
 *
 * 替代 VitePress 内置搜索，解决两个问题：
 *   1. 内置搜索不支持拼音/首字母（输入 jys 找不到《静夜思》）
 *   2. 站内同时存在「顶栏搜索」与「高级检索」两套入口，行为不一致
 *
 * 数据源：/indexes/search.json（构建期生成，含 tokens / pinyin / pinyinFirst / srcPath）
 * 交互：Ctrl/⌘+K 或点击顶栏按钮打开；↑↓ 选择、Enter 打开、Esc 关闭；
 *      底部提供「在高级检索中查看全部结果」跳转（带 q 参数）。
 * 规范见 docs/ui-patterns.md。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, withBase } from 'vitepress'

type Item = {
  type: 'poem' | 'idiom' | 'quote' | 'author' | 'imagery'
  id: string
  title: string
  subtitle?: string
  tokens?: string[]
  pinyin?: string
  pinyinFirst?: string
  excerpt?: string
  srcPath: string
}
type Result = Item & { score: number }

const TYPE_LABEL: Record<string, string> = {
  poem: '作品', idiom: '成语', quote: '名句', author: '作者', imagery: '意象',
}
const TYPE_ROUTE: Record<string, string> = {
  poem: '/poems/', idiom: '/idioms/', quote: '/quotes/', author: '/authors/', imagery: '/imagery/',
}
const MAX_RESULTS = 20

const router = useRouter()
const open = ref(false)
const query = ref('')
const active = ref(0)
const loading = ref(false)
const failed = ref('')
const items = ref<Item[]>([])
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

const compact = (s: string) => String(s ?? '').toLowerCase().replace(/\s+/g, '')

async function ensureData() {
  if (items.value.length || loading.value) return
  loading.value = true
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}indexes/search.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    items.value = (data.items ?? data ?? []).map((x: Item) => ({
      ...x,
      pinyin: compact(x.pinyin ?? ''),
      pinyinFirst: compact(x.pinyinFirst ?? ''),
    }))
  } catch (e: any) {
    failed.value = e?.message ?? String(e)
  } finally {
    loading.value = false
  }
}

const results = computed<Result[]>(() => {
  const q = compact(query.value)
  if (!q) return []
  const out: Result[] = []
  for (const it of items.value) {
    const title = compact(it.title)
    const tokens = (it.tokens ?? []).map(compact)
    let score = 0
    if (title === q) score += 100
    else if (title.startsWith(q)) score += 70
    else if (title.includes(q)) score += 50
    if (it.pinyin?.includes(q)) score += 40
    if (it.pinyinFirst?.startsWith(q)) score += 30
    if (!score && tokens.some((t) => t.includes(q))) score += 20
    if (!score && compact(it.subtitle ?? '').includes(q)) score += 10
    if (score) out.push({ ...it, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
})

watch(query, () => { active.value = 0 })

function openSearch() {
  open.value = true
  ensureData()
  nextTick(() => inputEl.value?.focus())
}

function closeSearch() {
  open.value = false
  query.value = ''
  active.value = 0
}

function toRoute(it: Item) {
  return withBase(it.srcPath.replace(/^content\//, '').replace(/\.md$/, ''))
}

function go(it: Result) {
  closeSearch()
  router.go(toRoute(it))
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (results.value.length) active.value = (active.value + 1) % results.value.length
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (results.value.length) active.value = (active.value - 1 + results.value.length) % results.value.length
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const r = results.value[active.value]
    if (r) go(r)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeSearch()
  }
}

function viewAll() {
  const q = query.value.trim()
  closeSearch()
  router.go(withBase(`/explore/search${q ? `?q=${encodeURIComponent(q)}` : ''}`))
}

function globalKey(e: KeyboardEvent) {
  const isK = e.key.toLowerCase() === 'k'
  if ((e.metaKey || e.ctrlKey) && isK) {
    e.preventDefault()
    open.value ? closeSearch() : openSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', globalKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', globalKey))

defineExpose({ openSearch })
</script>

<template>
  <button type="button" class="wj-gs-trigger" aria-label="全局搜索（Ctrl+K）" @click="openSearch">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
    <span class="wj-gs-trigger-text">搜索</span>
    <kbd>Ctrl K</kbd>
  </button>

  <Teleport to="body">
    <div v-if="open" class="wj-gs-mask" role="presentation" @mousedown.self="closeSearch">
      <div class="wj-gs" role="dialog" aria-modal="true" aria-label="全局搜索">
        <div class="wj-gs-inputrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref="inputEl"
            v-model="query"
            class="wj-gs-input"
            type="search"
            placeholder="搜索作品、成语、名句、作者、意象…（支持 jys / libai）"
            autocomplete="off"
            @keydown="onKey"
          />
          <kbd class="wj-gs-esc">Esc</kbd>
        </div>

        <p v-if="loading" class="wj-gs-hint">正在加载索引…</p>
        <p v-else-if="failed" class="wj-gs-hint">
          索引加载失败（{{ failed }}）。请先运行 <code>npm run build:index</code>。
        </p>
        <p v-else-if="!query.trim()" class="wj-gs-hint">
          输入汉字、全拼或首字母开始检索；<kbd>↑</kbd><kbd>↓</kbd> 选择，<kbd>Enter</kbd> 打开。
        </p>
        <p v-else-if="!results.length" class="wj-gs-hint">
          没有匹配「{{ query }}」的条目，试试更短的关键词。
        </p>

        <ul v-else ref="listEl" class="wj-gs-list">
          <li
            v-for="(r, i) in results"
            :key="r.type + r.id"
            class="wj-gs-item"
            :class="{ on: i === active }"
            @mouseenter="active = i"
            @click="go(r)"
          >
            <span class="wj-gs-type" :data-type="r.type">{{ TYPE_LABEL[r.type] }}</span>
            <span class="wj-gs-title">{{ r.title }}</span>
            <span class="wj-gs-sub">{{ r.subtitle }}</span>
          </li>
        </ul>

        <div v-if="results.length" class="wj-gs-foot">
          <span>{{ results.length }} 条结果{{ results.length >= MAX_RESULTS ? '（已截断）' : '' }}</span>
          <button type="button" class="wj-gs-all" @click="viewAll">在高级检索中查看全部 →</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wj-gs-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  font-size: 13px;
  color: var(--wj-ink-2);
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: 999px;
  cursor: pointer;
  transition: border-color .15s ease, color .15s ease;
}
.wj-gs-trigger:hover { border-color: var(--wj-accent); color: var(--wj-accent); }
.wj-gs-trigger svg { width: 14px; height: 14px; }
.wj-gs-trigger kbd,
.wj-gs-esc,
.wj-gs-hint kbd {
  padding: 1px 5px;
  font-size: 11px;
  font-family: var(--wj-font-mono);
  color: var(--wj-ink-3);
  background: var(--wj-bg-soft);
  border: 1px solid var(--wj-line);
  border-radius: 4px;
}
@media (max-width: 860px) {
  .wj-gs-trigger-text, .wj-gs-trigger kbd { display: none; }
}

.wj-gs-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 12vh 16px 16px;
  background: rgba(0, 0, 0, .38);
  backdrop-filter: blur(2px);
}
.wj-gs {
  width: min(680px, 100%);
  max-height: 68vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--wj-card);
  border: 1px solid var(--wj-line);
  border-radius: calc(var(--wj-radius) * 1.4);
  box-shadow: 0 24px 60px rgba(0, 0, 0, .28);
}
.wj-gs-inputrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--wj-line);
}
.wj-gs-inputrow svg { width: 17px; height: 17px; color: var(--wj-ink-3); flex: 0 0 auto; }
.wj-gs-input {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  color: var(--wj-ink);
  background: transparent;
  border: 0;
  outline: none;
}
.wj-gs-hint {
  margin: 0;
  padding: 18px 16px 22px;
  font-size: 13.5px;
  color: var(--wj-ink-2);
}
.wj-gs-list {
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow-y: auto;
  overflow-x: hidden;
}
.wj-gs-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 9px 10px;
  border-radius: calc(var(--wj-radius) * 0.8);
  cursor: pointer;
}
.wj-gs-item.on { background: var(--wj-accent-tint); }
.wj-gs-type {
  flex: 0 0 auto;
  padding: 1px 7px;
  font-size: 11px;
  color: var(--wj-ink-2);
  border: 1px solid var(--wj-line);
  border-radius: 999px;
}
.wj-gs-title {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--wj-ink);
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wj-gs-sub {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--wj-ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.wj-gs-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--wj-ink-3);
  border-top: 1px solid var(--wj-line);
}
.wj-gs-all {
  font-size: 12.5px;
  color: var(--wj-accent);
  background: none;
  border: 0;
  cursor: pointer;
}
</style>
